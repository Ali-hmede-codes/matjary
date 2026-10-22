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
} from '@app/database';
import {
  QueueService,
  MEDIA_PROCESSING_QUEUE,
  PROCESS_MEDIA_JOB,
  type MediaProcessingJob,
} from '@app/queue';
import { StorageService } from '@app/storage';
import {
  encodeImage,
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
  }

  isRunning(): boolean {
    return this.worker?.isRunning() ?? false;
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
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
        const storageKey = `media/${asset.showcaseId}/${asset.id}/${path.basename(variant.file)}`;
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
        if (result.affected)
          await manager.increment(
            Showcase,
            { id: asset.showcaseId },
            'mediaCount',
            1,
          );
        await manager.delete(MediaProcessingOutbox, { assetId: asset.id });
      });
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
}
