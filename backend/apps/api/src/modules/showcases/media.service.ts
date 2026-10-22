import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { AppEnvironment } from '@app/config';
import {
  Showcase,
  Store,
  MediaAsset,
  MediaKind,
  MediaStatus,
  MediaVariant,
  MediaProcessingOutbox,
  User,
  ShowcaseStatus,
  effectiveLimits,
  boundedLimit,
  assertQuota,
} from '@app/database';
import { QueueService } from '@app/queue';
import { StorageService } from '@app/storage';
import { PresignedUrlDto } from './dto/presigned-url.dto';
import { MediaCompleteDto } from './dto/media-complete.dto';
import { randomUUID } from 'node:crypto';

@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(Showcase)
    private readonly showcases: Repository<Showcase>,
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    @InjectRepository(MediaAsset)
    private readonly mediaAssets: Repository<MediaAsset>,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  /**
   * Negotiate an upload with the selected local or S3 provider.
   * Validates ownership, subscription limits, and file constraints before
   * creating a pending MediaAsset record.
   */
  async presignedUrl(
    dto: PresignedUrlDto,
    slug: string,
    ownerId: string,
  ): Promise<{ url: string; mediaId: string; key: string }> {
    try {
      return await this.mediaAssets.manager.transaction(async (manager) => {
      await manager.findOneOrFail(User, { where: { id: ownerId }, lock: { mode: 'pessimistic_write' } });
      const showcase = await manager.findOneBy(Showcase, { slug });
      if (!showcase) throw new NotFoundException('Post not found');
      if (showcase.ownerId !== ownerId) throw new ForbiddenException('You do not own this post');
      if (dto.storeId && showcase.storeId !== dto.storeId) throw new BadRequestException('Store must match the post');
      const limits = await effectiveLimits(manager, ownerId);
      if (dto.kind === MediaKind.IMAGE) {
        const count = await manager.getRepository(MediaAsset).createQueryBuilder('asset').where('asset.showcaseId = :id AND asset.kind = :kind AND asset.status != :failed', { id: showcase.id, kind: MediaKind.IMAGE, failed: MediaStatus.FAILED }).getCount();
        assertQuota(count, limits.maxImageCount, 'Image');
      }
      if (limits.maxStorageBytes != null) {
        const usage = await manager.query(`SELECT COALESCE(SUM(a.size_bytes), 0) AS used FROM media_assets a JOIN showcases s ON s.id = a.showcase_id WHERE s.owner_id = ? AND a.status IN ('pending', 'processing', 'ready') AND a.original_key IS NOT NULL`, [ownerId]) as Array<{ used: string }>;
        const variants = await manager.query(`SELECT COALESCE(SUM(v.size_bytes), 0) AS used FROM media_variants v JOIN media_assets a ON a.id = v.asset_id JOIN showcases s ON s.id = a.showcase_id WHERE s.owner_id = ? AND a.status != 'failed'`, [ownerId]) as Array<{ used: string }>;
        if (BigInt(usage[0]?.used ?? '0') + BigInt(variants[0]?.used ?? '0') + BigInt(dto.fileSize) > BigInt(limits.maxStorageBytes)) throw new ConflictException('Storage limit reached for your subscription');
      }

      // Validate MIME type prefix matches the declared kind.
      const isImage = dto.fileType.startsWith('image/');
      const isVideo = dto.fileType.startsWith('video/');
      if (
        (dto.kind === MediaKind.IMAGE && !isImage) ||
        (dto.kind === MediaKind.VIDEO && !isVideo)
      ) {
        throw new BadRequestException(
          'File type does not match the specified media kind',
        );
      }

      // Validate file size against the configured limit for the media kind.
      const maxImageSize = this.config.get('MEDIA_MAX_IMAGE_SIZE_BYTES', {
        infer: true,
      });
      const maxVideoSize = this.config.get('MEDIA_MAX_VIDEO_SIZE_BYTES', {
        infer: true,
      });
      const maxSize = dto.kind === MediaKind.IMAGE ? boundedLimit(maxImageSize, limits.maxImageSizeBytes) : boundedLimit(maxVideoSize, limits.maxVideoSizeBytes);
      if (dto.fileSize > maxSize) {
        throw new BadRequestException(
          'File exceeds the size limit for the specified media kind',
        );
      }

      const mediaId = randomUUID();
      const originalKey = `originals/${showcase.id}/${mediaId}/source`;
      const qualityHeights: Record<string, number> = { '480p': 480, '720p': 720, '1080p': 1080, '4k': 2160, '8k': 4320 };
      const videoHeight = Math.min(this.config.get('MEDIA_MAX_VIDEO_HEIGHT', { infer: true }), qualityHeights[limits.maxVideoQuality ?? '1080p'] ?? 1080);
      const mediaAsset = manager.create(MediaAsset, {
        processingLimits: {
          maxBytes: maxSize,
          maxDurationSeconds: boundedLimit(this.config.get('MEDIA_MAX_VIDEO_DURATION_SECONDS', { infer: true }), limits.maxVideoDurationSeconds),
          maxWidth: dto.kind === MediaKind.IMAGE ? boundedLimit(20000, limits.maxImageWidth) : Math.ceil(videoHeight * 16 / 9),
          maxHeight: dto.kind === MediaKind.IMAGE ? boundedLimit(20000, limits.maxImageHeight) : videoHeight,
          maxPixels: this.config.get('MEDIA_MAX_IMAGE_PIXELS', { infer: true }),
        },
        uploadExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        id: mediaId,
        showcaseId: showcase.id,
        kind: dto.kind,
        status: MediaStatus.PENDING,
        originalKey,
        mimeType: dto.fileType,
        sizeBytes: String(dto.fileSize),
      });

      await manager.save(mediaAsset);
      const { url } = await this.storage.presignedPutUrl(originalKey, dto.fileType, dto.fileSize);
      return { url, mediaId, key: originalKey };
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  /**
   * Atomically mark completion and retain durable dispatch intent. Redis
   * outages cannot strand an upload between the database and the queue.
   */
  async mediaComplete(
    dto: MediaCompleteDto,
    slug: string,
    ownerId: string,
  ): Promise<void> {
    try {
      const showcase = await this.showcases.findOneBy({ slug });
      if (!showcase) {
        throw new NotFoundException('Post not found');
      }

      if (showcase.ownerId !== ownerId) {
        throw new ForbiddenException('You do not own this post');
      }

      const mediaAsset = await this.mediaAssets.findOneBy({ id: dto.mediaId });
      if (!mediaAsset) {
        throw new NotFoundException('Media asset not found');
      }

      if (mediaAsset.showcaseId !== showcase.id) {
        throw new NotFoundException('Media asset not found');
      }

      if ([MediaStatus.PROCESSING, MediaStatus.READY].includes(mediaAsset.status)) return;
      if (mediaAsset.status !== MediaStatus.PENDING || !mediaAsset.originalKey || !mediaAsset.uploadExpiresAt || mediaAsset.uploadExpiresAt <= new Date()) throw new ConflictException('Upload is no longer pending');
      const stored = await this.storage.statObject(mediaAsset.originalKey);
      if (stored.size !== Number(mediaAsset.sizeBytes) || stored.size > (mediaAsset.processingLimits?.maxBytes ?? 0)) throw new BadRequestException('Uploaded media size is invalid');
      await this.mediaAssets.manager.transaction(async (manager) => {
        const current = await manager.findOneOrFail(MediaAsset, { where: { id: mediaAsset.id }, lock: { mode: 'pessimistic_write' } });
        if ([MediaStatus.PROCESSING, MediaStatus.READY].includes(current.status)) return;
        if (current.status !== MediaStatus.PENDING) throw new ConflictException('Upload is no longer pending');
        current.status = MediaStatus.PROCESSING;
        await manager.save(current);
        await manager.insert(MediaProcessingOutbox, { assetId: current.id });
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  async authorizeUpload(key: string, ownerId: string): Promise<MediaAsset> {
    this.requireLocal();
    const asset = await this.mediaAssets.findOne({ where: { originalKey: key }, relations: ['showcase'] });
    if (!asset || asset.showcase.ownerId !== ownerId) throw new NotFoundException('Media asset not found');
    if (asset.status !== MediaStatus.PENDING || !asset.uploadExpiresAt || asset.uploadExpiresAt <= new Date()) throw new ConflictException('Upload is no longer pending');
    return asset;
  }

  async authorizeDownload(key: string, ownerId?: string): Promise<{ mimeType: string; public: boolean }> {
    this.requireLocal();
    const variant = await this.mediaAssets.manager.getRepository(MediaVariant).findOne({ where: { storageKey: key }, relations: ['asset', 'asset.showcase'] });
    if (variant) {
      const visible = variant.asset.status === MediaStatus.READY && variant.asset.showcase.status === ShowcaseStatus.PUBLISHED;
      if (visible || variant.asset.showcase.ownerId === ownerId) return { mimeType: variant.mimeType, public: visible };
    }
    const original = await this.mediaAssets.findOne({ where: { originalKey: key }, relations: ['showcase'] });
    if (original && original.showcase.ownerId === ownerId) return { mimeType: original.mimeType, public: false };
    throw new NotFoundException('Media asset not found');
  }

  requireLocal(): void {
    if (this.config.get('STORAGE_PROVIDER', { infer: true }) !== 'local') throw new NotFoundException('Media route not found');
  }

  private sanitize(error: unknown): never {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(
      'Media storage is temporarily unavailable',
    );
  }
}
