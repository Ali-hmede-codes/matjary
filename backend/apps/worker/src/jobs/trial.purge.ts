import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { AppEnvironment } from '@app/config';
import {
  Store,
  StoreStatus,
  isTrialOnlyOwner,
  purgeStoreRecords,
  trialShopsDueForDeletion,
} from '@app/database';
import {
  MediaArchiveService,
  StorageService,
  mediaAssetIdFromKey,
  storeBrandCardKey,
  storeBrandCardVersion,
  storeShareCardKey,
} from '@app/storage';

const SWEEP_INTERVAL_MS = 15 * 60_000;
const BOOT_DELAY_MS = 30_000;
const SHOP_BATCH = 5;

/**
 * Removes shops abandoned at the end of the one-time free trial. A shop is
 * eligible only when its whole subscription history is the trial, it has been
 * locked for `TRIAL_SHOP_DELETE_AFTER_HOURS`, the owner is active, and no
 * administrator archived it. Paid-plan shops are never deleted here: they keep
 * the lock + lossless archive design.
 *
 * Rows are removed transactionally under the store lock; bytes are removed
 * after commit so a storage failure never resurrects a deleted row. The check
 * is repeated inside the transaction, so a plan assigned at the last moment
 * always wins.
 */
@Injectable()
export class TrialShopPurger
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(TrialShopPurger.name);
  private timer?: NodeJS.Timeout;
  private bootTimer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService<AppEnvironment, true>,
    private readonly storage: StorageService,
    private readonly archive: MediaArchiveService,
  ) {}

  onApplicationBootstrap(): void {
    const tick = () => {
      if (this.running) return;
      this.running = this.sweep()
        .then(() => undefined)
        .catch(() => this.logger.warn('Trial shop cleanup will retry'))
        .finally(() => {
          this.running = undefined;
        });
    };
    this.timer = setInterval(tick, SWEEP_INTERVAL_MS);
    this.timer.unref();
    this.bootTimer = setTimeout(tick, BOOT_DELAY_MS);
    this.bootTimer.unref();
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    await this.running;
  }

  async sweep(now = new Date()): Promise<number> {
    const hours = this.config.get('TRIAL_SHOP_DELETE_AFTER_HOURS', {
      infer: true,
    });
    if (!hours) return 0;
    const cutoff = new Date(now.getTime() - hours * 3_600_000);
    let deleted = 0;
    const shops = await trialShopsDueForDeletion(
      this.database.manager,
      cutoff,
      SHOP_BATCH,
    );
    for (const shop of shops) {
      try {
        const keys = await this.database.transaction(async (manager) => {
          const store = await manager.findOne(Store, {
            where: { id: shop.id },
            lock: { mode: 'pessimistic_write' },
            select: {
              id: true,
              ownerId: true,
              status: true,
              subscriptionLockedAt: true,
              name: true,
              brandColor: true,
              logoKey: true,
            },
          });
          // A renewal unlocks the shop in the same transaction that extends the
          // plan, so this re-check is the final guard before an irreversible
          // delete.
          if (
            !store ||
            store.status !== StoreStatus.LOCKED ||
            !store.subscriptionLockedAt ||
            !(await isTrialOnlyOwner(manager, store.ownerId))
          )
            return null;
          const keys = new Set(await purgeStoreRecords(manager, store.id));
          // Derived link-preview cards live outside the media tree; they carry
          // the shop name and must go with it.
          const logoAssetId = mediaAssetIdFromKey(store.logoKey);
          if (logoAssetId) keys.add(storeShareCardKey(store.id, logoAssetId));
          keys.add(
            storeBrandCardKey(
              store.id,
              storeBrandCardVersion(store.name, store.brandColor),
            ),
          );
          return [...keys];
        });
        if (!keys) continue;
        for (const key of keys) {
          await this.storage
            .deleteObject(key)
            .catch(() =>
              this.logger.warn('Could not remove an abandoned shop object'),
            );
        }
        await this.archive
          .deleteStore(shop.id)
          .catch(() =>
            this.logger.warn('Could not remove an abandoned shop archive'),
          );
        deleted += 1;
      } catch {
        this.logger.warn(`Trial shop cleanup deferred for ${shop.id}`);
      }
    }
    return deleted;
  }
}
