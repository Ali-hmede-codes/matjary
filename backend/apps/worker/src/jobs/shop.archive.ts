import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  Store,
  StoreMediaArchiveState,
  StoreStatus,
  storeMediaKeys,
} from '@app/database';
import { MediaArchiveService, StorageService } from '@app/storage';

const SWEEP_INTERVAL_MS = 5 * 60_000;
const SHOP_BATCH = 3;

/**
 * Moves the bytes of locked shops into the lossless archive tier and puts them
 * back after a renewal. Nothing is re-encoded or dropped: files are copied,
 * size- and SHA-256-verified, and only then removed from the live root, so a
 * renewed shop returns with exactly the files it had.
 *
 * The passes are idempotent and run on one worker process (the documented
 * deployment). The in-process `active` set keeps an archive pass from racing a
 * restore pass for the same shop.
 */
@Injectable()
export class ShopMediaArchiver
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(ShopMediaArchiver.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private readonly active = new Set<string>();

  constructor(
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    private readonly archive: MediaArchiveService,
    private readonly storage: StorageService,
  ) {}

  onApplicationBootstrap(): void {
    const tick = () => {
      if (this.running) return;
      this.running = this.sweep()
        .catch(() => this.logger.warn('Shop media archive will retry'))
        .finally(() => {
          this.running = undefined;
        });
    };
    this.timer = setInterval(tick, SWEEP_INTERVAL_MS);
    this.timer.unref();
    tick();
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  async sweep(): Promise<void> {
    await this.clearStatesWithoutArchiveRoot();
    if (!this.archive.isConfigured()) return;
    await this.archiveLockedShops();
    await this.restoreRenewedShops();
  }

  /**
   * Without an archive volume nothing moves, so a queued pass must not stay
   * `pending` forever. States that already hold archived bytes are left alone.
   */
  private async clearStatesWithoutArchiveRoot(): Promise<void> {
    if (this.archive.isConfigured()) return;
    await this.stores.manager.query(
      `UPDATE stores
          SET media_archive_state = 'none'
        WHERE media_archive_state = 'pending'
          AND media_archived_at IS NULL`,
    );
    await this.stores.manager.query(
      `UPDATE stores
          SET media_archive_state = 'none'
        WHERE media_archive_state = 'restoring'
          AND media_archived_at IS NULL`,
    );
  }

  private async archiveLockedShops(): Promise<void> {
    const shops = await this.stores.find({
      where: {
        status: StoreStatus.LOCKED,
        mediaArchiveState: In([
          StoreMediaArchiveState.NONE,
          StoreMediaArchiveState.PENDING,
          StoreMediaArchiveState.FAILED,
        ]),
      },
      order: { updatedAt: 'ASC' },
      take: SHOP_BATCH,
    });
    for (const shop of shops)
      await this.run(shop.id, () => this.archiveShop(shop.id));
  }

  private async restoreRenewedShops(): Promise<void> {
    const shops = await this.stores.find({
      where: {
        subscriptionLockedAt: IsNull(),
        mediaArchiveState: In([
          StoreMediaArchiveState.RESTORING,
          StoreMediaArchiveState.FAILED,
        ]),
      },
      order: { updatedAt: 'ASC' },
      take: SHOP_BATCH,
    });
    for (const shop of shops)
      await this.run(shop.id, () => this.restoreShop(shop.id));
  }

  private async run(id: string, work: () => Promise<void>): Promise<void> {
    if (this.active.has(id)) return;
    this.active.add(id);
    try {
      await work();
    } catch {
      this.logger.warn(`Shop media pass deferred for ${id}`);
    } finally {
      this.active.delete(id);
    }
  }

  private async archiveShop(id: string): Promise<void> {
    const keys = await storeMediaKeys(this.stores.manager, id);
    const previous = await this.archive.readManifest(id);
    const entries = new Map(
      (previous?.entries ?? []).map((entry) => [entry.key, entry]),
    );
    let failures = 0;
    for (const key of keys) {
      try {
        const entry = await this.archive.archiveObject(id, key);
        // A missing live object was already archived by an earlier pass; if the
        // archive does not hold it either, the bytes are actually gone.
        if (entry) entries.set(key, entry);
        else if (!(await this.existsInArchive(id, key))) failures += 1;
      } catch {
        failures += 1;
      }
    }
    if (entries.size)
      await this.archive.writeManifest(id, [...entries.values()]);
    // The shop may have been renewed during the copy. Under the row lock the
    // renewal wins and the pass becomes a restore instead of an archive.
    await this.stores.manager.transaction(async (manager) => {
      const current = await manager.findOne(Store, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
        select: {
          id: true,
          status: true,
          subscriptionLockedAt: true,
        },
      });
      if (!current) return;
      if (
        current.status !== StoreStatus.LOCKED ||
        !current.subscriptionLockedAt
      ) {
        await manager.query(
          `UPDATE stores SET media_archive_state = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?`,
          [StoreMediaArchiveState.RESTORING, id],
        );
        return;
      }
      await manager.query(
        `UPDATE stores SET media_archive_state = ?, media_archived_at = UTC_TIMESTAMP(6), updated_at = UTC_TIMESTAMP(6) WHERE id = ?`,
        [
          failures
            ? StoreMediaArchiveState.FAILED
            : StoreMediaArchiveState.ARCHIVED,
          id,
        ],
      );
    });
  }

  private async existsInArchive(id: string, key: string): Promise<boolean> {
    return this.archive
      .statObject(id, key)
      .then(() => true)
      .catch(() => false);
  }

  private async existsLive(key: string): Promise<boolean> {
    return this.storage
      .statObject(key)
      .then(() => true)
      .catch(() => false);
  }

  private async restoreShop(id: string): Promise<void> {
    const store = await this.stores.findOne({
      where: { id },
      select: { id: true, status: true, subscriptionLockedAt: true },
    });
    if (!store) return;
    // Locked again (or trashed) before the restore started: hand the shop back
    // to the archive pass so the states keep moving instead of sticking at
    // `restoring`.
    if (store.subscriptionLockedAt) {
      await this.stores.manager.query(
        `UPDATE stores SET media_archive_state = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?`,
        [StoreMediaArchiveState.PENDING, id],
      );
      return;
    }
    if (store.status === StoreStatus.TRASHED) {
      await this.stores.manager.query(
        `UPDATE stores SET media_archive_state = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?`,
        [StoreMediaArchiveState.NONE, id],
      );
      return;
    }
    const keys = await storeMediaKeys(this.stores.manager, id);
    const manifest = await this.archive.readManifest(id);
    const expected = new Map(
      (manifest?.entries ?? []).map((entry) => [entry.key, entry]),
    );
    let failures = 0;
    for (const key of keys) {
      try {
        const archived = await this.existsInArchive(id, key);
        if (!archived) {
          // Neither copy means the bytes are gone; report it instead of
          // pretending the restore was complete.
          if (!(await this.existsLive(key))) failures += 1;
          continue;
        }
        const result = await this.archive.restoreObject(
          id,
          key,
          expected.get(key),
        );
        if (result.outcome !== 'restored' && result.outcome !== 'missing')
          failures += 1;
      } catch {
        failures += 1;
      }
    }
    if (failures) {
      await this.stores.manager.query(
        `UPDATE stores SET media_archive_state = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?`,
        [StoreMediaArchiveState.FAILED, id],
      );
      return;
    }
    await this.archive.deleteManifest(id);
    await this.stores.manager.query(
      `UPDATE stores SET media_archive_state = ?, media_archived_at = NULL, updated_at = UTC_TIMESTAMP(6) WHERE id = ?`,
      [StoreMediaArchiveState.NONE, id],
    );
  }
}
