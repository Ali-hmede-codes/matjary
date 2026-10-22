import { Injectable, Logger, type OnApplicationBootstrap, type BeforeApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, type Repository } from 'typeorm';
import { MediaAsset, MediaStatus, MediaProcessingOutbox, MediaVariant } from '@app/database';
import { QueueService } from '@app/queue';
import { StorageService } from '@app/storage';
import type { AppEnvironment } from '@app/config';

@Injectable()
export class MediaRecovery implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(MediaRecovery.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private cursor = '';
  constructor(
    @InjectRepository(MediaAsset) private readonly assets: Repository<MediaAsset>,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  onApplicationBootstrap(): void {
    const tick = () => {
      if (this.running) return;
      this.running = this.sweep().catch(() => this.logger.warn('Media recovery will retry')).finally(() => { this.running = undefined; });
    };
    this.timer = setInterval(tick, 10000);
    this.timer.unref();
    tick();
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  async sweep(): Promise<void> {
    const assets = await this.assets.createQueryBuilder('asset')
      .where('asset.id > :cursor', { cursor: this.cursor })
      .andWhere(new Brackets((query) => query.where('asset.status = :processing', { processing: MediaStatus.PROCESSING }).orWhere('asset.originalKey IS NOT NULL')))
      .orderBy('asset.id', 'ASC').take(100).getMany();
    this.cursor = assets.length === 100 ? assets[assets.length - 1]!.id : '';
    for (const candidate of assets) {
      try { await this.reconcile(candidate.id); }
      catch { this.logger.warn(`Media recovery deferred for ${candidate.id}`); }
    }
  }

  private async reconcile(id: string): Promise<void> {
    await this.assets.manager.transaction(async (manager) => {
      const asset = await manager.findOne(MediaAsset, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!asset) return;
      const job = await this.queue.getQueue().getJob(`media-${id}`);
      const state = await job?.getState();
      if (state === 'active') return;
      if (asset.status === MediaStatus.PROCESSING) {
        if (state === 'failed') {
          asset.status = MediaStatus.FAILED;
          await manager.save(asset);
          await manager.delete(MediaProcessingOutbox, { assetId: id });
          return;
        }
        if (!job || state === 'completed') {
          if (job) await job.remove();
          if (!asset.originalKey) throw new Error('Missing original');
          // Keep the outbox until a terminal DB state, so Redis loss is repaired.
          await manager.upsert(MediaProcessingOutbox, { assetId: id }, ['assetId']);
          await this.queue.enqueueMediaProcessing({ mediaId: id, originalKey: asset.originalKey, kind: asset.kind, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes });
        }
        return;
      }
      const now = Date.now();
      if (asset.status === MediaStatus.PENDING && (!asset.uploadExpiresAt || asset.uploadExpiresAt.getTime() <= now)) {
        asset.status = MediaStatus.FAILED;
        await manager.save(asset);
      }
      const retention = this.config.get('MEDIA_ORIGINAL_RETENTION_HOURS', { infer: true }) * 3600000;
      const expired = asset.status === MediaStatus.FAILED && asset.updatedAt.getTime() + retention <= now;
      if (!asset.originalKey || (asset.status !== MediaStatus.READY && !expired)) return;
      if (job && !['completed', 'failed', 'unknown'].includes(state ?? '')) return;
      if (expired) {
        const variants = await manager.findBy(MediaVariant, { assetId: id });
        const keys = new Set(variants.map((variant) => variant.storageKey));
        // Include files whose upload succeeded immediately before a DB failure.
        for (const width of [480, 1080, 1600]) for (const format of ['avif', 'webp', 'jpeg']) keys.add(`media/${asset.showcaseId}/${id}/${format}-${width}.${format === 'jpeg' ? 'jpg' : format}`);
        keys.add(`media/${asset.showcaseId}/${id}/mp4-720.mp4`);
        keys.add(`media/${asset.showcaseId}/${id}/poster-jpeg.jpg`);
        for (const key of keys) await this.storage.deleteObject(key);
        await manager.delete(MediaVariant, { assetId: id });
      }
      await this.storage.deleteObject(asset.originalKey);
      // If deletion fails, the transaction preserves the retry marker.
      asset.originalKey = null;
      await manager.save(asset);
      await manager.delete(MediaProcessingOutbox, { assetId: id });
    });
  }
}
