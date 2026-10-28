import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, type Repository } from 'typeorm';
import {
  MediaAsset,
  MediaStatus,
  StoreStory,
  purgeDetachedStoryAsset,
  purgeStoryRecords,
} from '@app/database';
import { StorageService } from '@app/storage';

const SWEEP_INTERVAL_MS = 5 * 60_000;
const EXPIRED_BATCH = 50;
const ORPHAN_BATCH = 20;
// A composer that closed right after processing leaves a ready asset behind.
// One hour is long enough that a slow publish never loses its upload.
const ORPHAN_AGE_MS = 60 * 60_000;

// Stories disappear on their own after 24 hours. Reads and media serving
// already ignore an expired row, so this sweep exists to release the bytes and
// the plan slot without ever blocking a request.
@Injectable()
export class StorySweeper
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(StorySweeper.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    @InjectRepository(StoreStory)
    private readonly stories: Repository<StoreStory>,
    @InjectRepository(MediaAsset)
    private readonly assets: Repository<MediaAsset>,
    private readonly storage: StorageService,
  ) {}

  onApplicationBootstrap(): void {
    const tick = () => {
      if (this.running) return;
      this.running = this.sweep()
        .catch(() => this.logger.warn('Story sweep will retry'))
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
    await this.purgeExpired();
    await this.purgeDetachedUploads();
  }

  private async purgeExpired(): Promise<void> {
    const expired = await this.stories.find({
      where: { expiresAt: LessThanOrEqual(new Date()) },
      order: { expiresAt: 'ASC' },
      take: EXPIRED_BATCH,
    });
    for (const candidate of expired) {
      try {
        const keys = await this.stories.manager.transaction(async (manager) => {
          const story = await manager.findOne(StoreStory, {
            where: { id: candidate.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!story) return [];
          return purgeStoryRecords(manager, story);
        });
        // Rows are already gone; a storage hiccup only leaves bytes behind.
        for (const key of keys)
          await this.storage
            .deleteObject(key)
            .catch(() =>
              this.logger.warn(`Could not remove expired story object ${key}`),
            );
      } catch {
        this.logger.warn(`Expired story cleanup deferred for ${candidate.id}`);
      }
    }
  }

  private async purgeDetachedUploads(): Promise<void> {
    const cutoff = new Date(Date.now() - ORPHAN_AGE_MS);
    const assets = await this.assets
      .createQueryBuilder('asset')
      .where('asset.purpose = :purpose', { purpose: 'store_story' })
      .andWhere('asset.status = :ready', { ready: MediaStatus.READY })
      .andWhere('asset.updatedAt < :cutoff', { cutoff })
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM store_stories story WHERE story.media_asset_id = asset.id)`,
      )
      .orderBy('asset.updatedAt', 'ASC')
      .take(ORPHAN_BATCH)
      .getMany();
    for (const asset of assets) {
      // Every story asset is shop-scoped; a row without a shop cannot be
      // keyed correctly and is left for manual inspection.
      if (!asset.storeId) continue;
      try {
        const keys = await this.assets.manager.transaction(async (manager) =>
          purgeDetachedStoryAsset(manager, asset.storeId!, asset.id),
        );
        for (const key of keys)
          await this.storage
            .deleteObject(key)
            .catch(() =>
              this.logger.warn(`Could not remove unused story object ${key}`),
            );
      } catch {
        this.logger.warn(
          `Unused story upload cleanup deferred for ${asset.id}`,
        );
      }
    }
  }
}
