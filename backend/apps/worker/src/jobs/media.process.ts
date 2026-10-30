import {
  Injectable,
  Logger,
  BeforeApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { AppEnvironment } from '@app/config';
import {
  MediaAsset,
  MediaVariant,
  MediaKind,
  MediaStatus,
  MediaProcessingOutbox,
  Showcase,
  Store,
} from '@app/database';
import {
  QueueService,
  MEDIA_PROCESSING_QUEUE,
  PROCESS_MEDIA_JOB,
  type MediaProcessingJob,
} from '@app/queue';
import {
  StorageService,
  storeBrandCardKey,
  storeBrandCardVersion,
  storeShareCardKey,
  mediaAssetIdFromKey,
} from '@app/storage';
import {
  encodeImage,
  encodeShareCard,
  encodeStoreNameCard,
  encodeVideo,
  validateSignature,
  InvalidMediaError,
} from '@app/media-processing';
import { Worker, UnrecoverableError, type Job } from 'bullmq';
import { promises as fs } from 'node:fs';
import path from 'node:path';

@Injectable()
export class MediaProcessor implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(MediaProcessor.name);
  private worker: Worker | null = null;
  private stopping = false;
  private shareCardTimer?: NodeJS.Timeout;
  private shareCardBackfill?: Promise<void>;

  private retryShareCards(): void {
    if (this.stopping || this.shareCardBackfill) return;
    this.shareCardBackfill = this.backfillShareCards()
      .catch(() => this.logger.warn('Share card backfill failed'))
      .finally(() => {
        this.shareCardBackfill = undefined;
      });
  }

  constructor(
    @InjectRepository(MediaAsset)
    private readonly mediaAssets: Repository<MediaAsset>,
    @InjectRepository(MediaVariant)
    private readonly mediaVariants: Repository<MediaVariant>,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.config.get('MEDIA_TEMP_DIR', { infer: true }), {
      recursive: true,
    });
    // BullMQ v5 uses Worker instead of Queue.process() to consume jobs.
    this.worker = new Worker(
      MEDIA_PROCESSING_QUEUE,
      async (job: Job<MediaProcessingJob>) => this.processJob(job),
      {
        connection: this.queue.createWorkerConnection(),
        concurrency: this.config.get('MEDIA_WORKER_CONCURRENCY', {
          infer: true,
        }),
      },
    );
    this.worker.on('error', () => this.logger.warn('Media queue unavailable'));
    // Shops uploaded before the share-card feature get one after a deploy;
    // the backfill runs in the background so readiness is never delayed.
    this.retryShareCards();
    // A transient failure or a logo attached after boot must recover without
    // requiring another worker restart. Keep the sweep single-flight.
    this.shareCardTimer = setInterval(() => this.retryShareCards(), 300_000);
    this.shareCardTimer.unref();
  }

  isRunning(): boolean {
    return this.worker?.isRunning() ?? false;
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.shareCardTimer) clearInterval(this.shareCardTimer);
    if (this.worker) {
      await this.worker.close();
    }
    await this.shareCardBackfill;
  }

  async processJob(job: Job<MediaProcessingJob>): Promise<void> {
    const asset = await this.mediaAssets.findOneBy({ id: job.data.mediaId });
    if (!asset || asset.status !== MediaStatus.PROCESSING) return;
    const timeout = this.config.get('MEDIA_JOB_TIMEOUT_MS', { infer: true });
    const signal = AbortSignal.timeout(timeout);
    const deadline = Date.now() + timeout;
    let directory: string | undefined;
    try {
      if (!asset.originalKey || !asset.processingLimits)
        throw new InvalidMediaError('Missing upload metadata');
      const hardBytes = this.config.get(
        asset.kind === MediaKind.IMAGE
          ? 'MEDIA_MAX_IMAGE_SIZE_BYTES'
          : 'MEDIA_MAX_VIDEO_SIZE_BYTES',
        { infer: true },
      );
      const maximum = Math.min(asset.processingLimits.maxBytes, hardBytes);
      const stored = await this.storage.statObject(asset.originalKey);
      if (
        stored.size <= 0 ||
        stored.size > maximum ||
        stored.size !== Number(asset.sizeBytes)
      )
        throw new InvalidMediaError('Invalid stored size');
      directory = await fs.mkdtemp(
        path.join(
          this.config.get('MEDIA_TEMP_DIR', { infer: true }),
          'attempt-',
        ),
      );
      const input = path.join(directory, 'source');
      await this.storage.downloadToFile(
        asset.originalKey,
        input,
        maximum,
        signal,
      );
      if ((await fs.stat(input)).size !== stored.size)
        throw new InvalidMediaError('Stored size changed');
      await validateSignature(input, asset.mimeType);
      const options = {
        limits: {
          ...asset.processingLimits,
          maxBytes: maximum,
          maxDurationSeconds: Math.min(
            asset.processingLimits.maxDurationSeconds,
            this.config.get('MEDIA_MAX_VIDEO_DURATION_SECONDS', {
              infer: true,
            }),
          ),
          maxPixels: Math.min(
            asset.processingLimits.maxPixels,
            this.config.get('MEDIA_MAX_IMAGE_PIXELS', { infer: true }),
          ),
          ...(asset.kind === MediaKind.VIDEO
            ? {
                maxHeight: Math.min(
                  asset.processingLimits.maxHeight,
                  this.config.get('MEDIA_MAX_VIDEO_HEIGHT', { infer: true }),
                ),
                maxWidth: Math.min(asset.processingLimits.maxWidth, 1920),
              }
            : {}),
        },
        signal,
        deadline,
        ffmpeg: this.config.get('FFMPEG_PATH', { infer: true }),
        ffprobe: this.config.get('FFPROBE_PATH', { infer: true }),
      };
      const encoded =
        asset.kind === MediaKind.IMAGE
          ? await encodeImage(input, directory, options)
          : await encodeVideo(input, directory, options);
      for (const variant of encoded.variants) {
        const parentId = asset.showcaseId ?? asset.storeId ?? asset.productId;
        if (!parentId) throw new InvalidMediaError('Missing media parent');
        const storageKey = `media/${parentId}/${asset.id}/${path.basename(variant.file)}`;
        await this.storage.uploadFile(
          storageKey,
          variant.file,
          variant.mimeType,
          signal,
        );
        const { file: _file, ...metadata } = variant;
        await this.mediaVariants.upsert(
          { ...metadata, assetId: asset.id, storageKey },
          ['assetId', 'label'],
        );
      }
      await this.mediaAssets.manager.transaction(async (manager) => {
        const result = await manager.update(
          MediaAsset,
          { id: asset.id, status: MediaStatus.PROCESSING },
          {
            status: MediaStatus.READY,
            width: encoded.width,
            height: encoded.height,
            durationMs: encoded.durationMs,
          },
        );
        if (result.affected && asset.showcaseId)
          await manager.increment(
            Showcase,
            { id: asset.showcaseId },
            'mediaCount',
            1,
          );
        await manager.delete(MediaProcessingOutbox, { assetId: asset.id });
      });
      // A logo-derived card powers link previews. Prefer the wide JPEG variant
      // so the card is not built from a small file; failures never fail the job.
      if (
        asset.purpose === 'store_logo' &&
        asset.storeId &&
        asset.kind === MediaKind.IMAGE
      ) {
        const source =
          [...encoded.variants]
            .filter((variant) => variant.mimeType === 'image/jpeg')
            .sort((a, b) => b.width - a.width)[0] ?? encoded.variants[0];
        if (source)
          await this.generateShareCard(
            asset.storeId,
            asset.id,
            source.file,
            directory,
            signal,
            deadline,
          );
      }
      // OriginalKey is a durable cleanup marker. A separate sweep removes it
      // only after readiness commits, and retries storage failures.
    } catch (error) {
      const permanent = error instanceof InvalidMediaError;
      if (permanent || job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await this.mediaAssets.manager.transaction(async (manager) => {
          await manager.update(
            MediaAsset,
            { id: asset.id, status: MediaStatus.PROCESSING },
            { status: MediaStatus.FAILED },
          );
          await manager.delete(MediaProcessingOutbox, { assetId: asset.id });
        });
      }
      this.logger.warn(`Media processing attempt failed for ${asset.id}`);
      if (permanent) throw new UnrecoverableError('Invalid media upload');
      throw new Error('Media processing temporarily failed');
    } finally {
      if (directory) await fs.rm(directory, { recursive: true, force: true });
    }
  }

  private async generateShareCard(
    storeId: string,
    assetId: string,
    input: string,
    directory: string,
    signal: AbortSignal,
    deadline: number,
  ): Promise<void> {
    try {
      const store = await this.mediaAssets.manager.findOneBy(Store, {
        id: storeId,
      });
      if (!store) return;
      const card = await encodeShareCard(input, directory, {
        background: store.brandColor ?? '',
        signal,
        deadline,
      });
      await this.storage.uploadFile(
        storeShareCardKey(store.id, assetId),
        card.file,
        card.mimeType,
        signal,
      );
      // The API's shell fingerprint watches media timestamps. READY was
      // committed before this file existed, so signal its availability now.
      await this.mediaAssets.update({ id: assetId }, { updatedAt: new Date() });
    } catch {
      // The API falls back to the logo variant when the card is missing.
      this.logger.warn(`Share card generation failed for asset ${assetId}`);
    }
  }

  /**
   * Builds the generated cards for every shop, including shops that never had
   * a logo. Logo cards are derived from the logo asset; shops without one get
   * a name card on their brand color, so no shared shop link is text-only.
   */
  private async backfillShareCards(): Promise<void> {
    const batch = 50;
    for (let skip = 0; ; skip += batch) {
      const stores = await this.mediaAssets.manager.find(Store, {
        order: { createdAt: 'DESC' },
        take: batch,
        skip,
      });
      for (const store of stores) {
        if (this.stopping) return;
        await this.backfillShareCard(store).catch(() =>
          this.logger.warn('Share card backfill item failed'),
        );
        await this.backfillNameCard(store).catch(() =>
          this.logger.warn('Store name card backfill item failed'),
        );
      }
      if (stores.length < batch) return;
    }
  }

  /**
   * The logo asset behind the card. A saved key that no longer encodes an
   * asset id (older rows) falls back to the shop's newest ready logo.
   */
  private async storeLogoAssetId(store: Store): Promise<string | null> {
    const fromKey = mediaAssetIdFromKey(store.logoKey);
    if (fromKey) return fromKey;
    const asset = await this.mediaAssets.manager.findOne(MediaAsset, {
      where: {
        storeId: store.id,
        purpose: 'store_logo',
        status: MediaStatus.READY,
      },
      order: { createdAt: 'DESC' },
    });
    return asset?.id ?? null;
  }

  private async backfillShareCard(store: Store): Promise<void> {
    const assetId = await this.storeLogoAssetId(store);
    if (!assetId) return;
    try {
      await this.storage.statObject(storeShareCardKey(store.id, assetId));
      return;
    } catch {
      /* No card yet; build one below. */
    }
    const variant =
      (await this.mediaVariants.findOne({
        where: { assetId, mimeType: 'image/jpeg' },
        order: { width: 'DESC' },
      })) ??
      (await this.mediaVariants.findOne({
        where: { assetId },
        order: { width: 'DESC' },
      }));
    if (!variant) return;
    const directory = await fs.mkdtemp(
      path.join(this.config.get('MEDIA_TEMP_DIR', { infer: true }), 'share-'),
    );
    try {
      const input = path.join(directory, 'logo');
      await this.storage.downloadToFile(
        variant.storageKey,
        input,
        20 * 1024 * 1024,
        AbortSignal.timeout(30_000),
      );
      await this.generateShareCard(
        store.id,
        assetId,
        input,
        directory,
        AbortSignal.timeout(30_000),
        Date.now() + 30_000,
      );
    } catch {
      /* A missing card falls back to the logo variant in the API. */
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }

  private async backfillNameCard(store: Store): Promise<void> {
    const version = storeBrandCardVersion(store.name, store.brandColor);
    const key = storeBrandCardKey(store.id, version);
    try {
      await this.storage.statObject(key);
      return;
    } catch {
      /* No current name card; build one below. */
    }
    const directory = await fs.mkdtemp(
      path.join(this.config.get('MEDIA_TEMP_DIR', { infer: true }), 'name-'),
    );
    try {
      const card = await encodeStoreNameCard(
        store.name,
        store.brandColor,
        directory,
        {
          signal: AbortSignal.timeout(30_000),
          deadline: Date.now() + 30_000,
        },
      );
      await this.storage.uploadFile(
        key,
        card.file,
        card.mimeType,
        AbortSignal.timeout(30_000),
      );
      // The shell fingerprint watches store timestamps; a card that appears
      // after a share was previewed must trigger a fresh shell.
      await this.mediaAssets.manager.update(
        Store,
        { id: store.id },
        { updatedAt: new Date() },
      );
    } catch {
      this.logger.warn(`Store name card generation failed for ${store.id}`);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
}
