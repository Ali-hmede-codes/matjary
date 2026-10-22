import {
  Injectable,
  Logger,
  OnModuleDestroy,
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
} from '@app/database';
import {
  QueueService,
  MEDIA_PROCESSING_QUEUE,
  PROCESS_MEDIA_JOB,
  type MediaProcessingJob,
} from '@app/queue';
import { S3StorageProvider } from '@app/storage';
import { Worker } from 'bullmq';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

const TMP_DIR = path.join(os.tmpdir(), 'matjary-media');

// Image variants produced by the worker: AVIF and WebP at 480/1080/1600px.
// `as const` narrows format to 'avif' | 'webp' so sharp's toFormat accepts it.
const IMAGE_VARIANTS = [
  { label: 'avif-480', width: 480, format: 'avif' },
  { label: 'avif-1080', width: 1080, format: 'avif' },
  { label: 'avif-1600', width: 1600, format: 'avif' },
  { label: 'webp-480', width: 480, format: 'webp' },
  { label: 'webp-1080', width: 1080, format: 'webp' },
  { label: 'webp-1600', width: 1600, format: 'webp' },
] as const;

@Injectable()
export class MediaProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaProcessor.name);
  private worker: Worker | null = null;

  constructor(
    @InjectRepository(MediaAsset)
    private readonly mediaAssets: Repository<MediaAsset>,
    @InjectRepository(MediaVariant)
    private readonly mediaVariants: Repository<MediaVariant>,
    private readonly queue: QueueService,
    private readonly s3: S3StorageProvider,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    await fs.mkdir(TMP_DIR, { recursive: true });
    // BullMQ v5 uses Worker instead of Queue.process() to consume jobs.
    this.worker = new Worker(
      MEDIA_PROCESSING_QUEUE,
      async (job) => {
        const data = job.data as MediaProcessingJob;
        await this.processJob(data);
      },
      { connection: this.queue.getRedis() },
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }

  private async processJob(data: MediaProcessingJob): Promise<void> {
    const asset = await this.mediaAssets.findOneBy({ id: data.mediaId });
    if (!asset) {
      this.logger.warn(`Media asset ${data.mediaId} not found`);
      return;
    }

    try {
      if (data.kind === MediaKind.IMAGE) {
        await this.processImage(asset, data);
      } else {
        await this.processVideo(asset, data);
      }
      asset.status = MediaStatus.READY;
      await this.mediaAssets.save(asset);
    } catch (error) {
      asset.status = MediaStatus.FAILED;
      await this.mediaAssets.save(asset);
      this.logger.error(`Media processing failed for ${data.mediaId}`, error);
    }
  }

  private async processImage(
    asset: MediaAsset,
    data: MediaProcessingJob,
  ): Promise<void> {
    const original = await this.s3.getObject(data.originalKey);
    const metadata = await sharp(original).metadata();

    asset.width = metadata.width ?? null;
    asset.height = metadata.height ?? null;

    const baseKey = `media/${asset.showcaseId}/${data.mediaId}`;

    for (const variant of IMAGE_VARIANTS) {
      const buffer = await sharp(original)
        .resize(variant.width)
        .withMetadata({})
        .toFormat(variant.format, { quality: 85 })
        .toBuffer();

      const key = `${baseKey}-${variant.label}.${variant.format}`;
      await this.s3.putObject(key, buffer, `image/${variant.format}`);

      const variantHeight =
        metadata.width && metadata.height
          ? Math.round((metadata.height * variant.width) / metadata.width)
          : 0;

      await this.mediaVariants.save(
        this.mediaVariants.create({
          assetId: asset.id,
          label: variant.label,
          storageKey: key,
          mimeType: `image/${variant.format}`,
          sizeBytes: String(buffer.length),
          width: variant.width,
          height: variantHeight,
        }),
      );
    }

    // Remove the original upload after variants are stored.
    await this.s3.deleteObject(data.originalKey);
    asset.originalKey = null;
  }

  private async processVideo(
    asset: MediaAsset,
    data: MediaProcessingJob,
  ): Promise<void> {
    const original = await this.s3.getObject(data.originalKey);
    const inputPath = path.join(TMP_DIR, `${data.mediaId}-original`);
    const outputPath = path.join(TMP_DIR, `${data.mediaId}-720p.mp4`);
    const posterPath = path.join(TMP_DIR, `${data.mediaId}-poster.jpg`);

    await fs.writeFile(inputPath, original);

    try {
      // Probe the source for dimensions and duration.
      const probe = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height,duration',
        '-of',
        'json',
        inputPath,
      ]);
      const streamInfo = JSON.parse(probe.stdout);
      const stream = streamInfo.streams?.[0] ?? {};
      asset.width = stream.width ?? null;
      asset.height = stream.height ?? null;
      asset.durationMs = stream.duration
        ? Math.round(parseFloat(String(stream.duration)) * 1000)
        : null;

      // Transcode to 720p H.264 MP4.
      await execFileAsync('ffmpeg', [
        '-i',
        inputPath,
        '-vf',
        'scale=-2:720',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        '-y',
        outputPath,
      ]);

      // Extract a poster frame from the first second.
      await execFileAsync('ffmpeg', [
        '-i',
        inputPath,
        '-ss',
        '00:00:01',
        '-vframes',
        '1',
        '-y',
        posterPath,
      ]);

      const baseKey = `media/${asset.showcaseId}/${data.mediaId}`;

      // Upload MP4 variant.
      const mp4Buffer = await fs.readFile(outputPath);
      const mp4Key = `${baseKey}-mp4-720.mp4`;
      await this.s3.putObject(mp4Key, mp4Buffer, 'video/mp4');
      await this.mediaVariants.save(
        this.mediaVariants.create({
          assetId: asset.id,
          label: 'mp4-720',
          storageKey: mp4Key,
          mimeType: 'video/mp4',
          sizeBytes: String(mp4Buffer.length),
          width: asset.width ?? 0,
          height: asset.height ?? 0,
          durationMs: asset.durationMs,
        }),
      );

      // Upload poster variant.
      const posterBuffer = await fs.readFile(posterPath);
      const posterKey = `${baseKey}-poster-jpeg`;
      await this.s3.putObject(posterKey, posterBuffer, 'image/jpeg');
      await this.mediaVariants.save(
        this.mediaVariants.create({
          assetId: asset.id,
          label: 'poster-jpeg',
          storageKey: posterKey,
          mimeType: 'image/jpeg',
          sizeBytes: String(posterBuffer.length),
          width: 0,
          height: 0,
        }),
      );
    } finally {
      // Clean up temp files regardless of outcome.
      for (const file of [inputPath, outputPath, posterPath]) {
        try {
          await fs.unlink(file);
        } catch {
          // ignore
        }
      }
    }

    // Remove the original upload after variants are stored.
    await this.s3.deleteObject(data.originalKey);
    asset.originalKey = null;
  }
}
