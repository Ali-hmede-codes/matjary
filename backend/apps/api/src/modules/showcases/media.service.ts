import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
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
} from '@app/database';
import { getMaxPostsPerMonth, isUnlimited } from '@app/config';
import { QueueService } from '@app/queue';
import { StorageService } from '@app/storage';
import { PresignedUrlDto } from './dto/presigned-url.dto';
import { MediaCompleteDto } from './dto/media-complete.dto';

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
   * Generate a presigned PUT URL for direct client-to-object-storage upload.
   * Validates ownership, subscription limits, and file constraints before
   * creating a pending MediaAsset record.
   */
  async presignedUrl(
    dto: PresignedUrlDto,
    slug: string,
    ownerId: string,
  ): Promise<{ url: string; mediaId: string; key: string }> {
    try {
      const showcase = await this.showcases.findOneBy({ slug });
      if (!showcase) {
        throw new NotFoundException('Post not found');
      }

      if (showcase.ownerId !== ownerId) {
        throw new ForbiddenException('You do not own this post');
      }

      // If a store is specified, verify ownership and enforce subscription limits.
      if (dto.storeId) {
        const store = await this.stores.findOneBy({ id: dto.storeId });
        if (!store) {
          throw new NotFoundException('Store not found');
        }
        if (store.ownerId !== ownerId) {
          throw new ForbiddenException('You do not own this store');
        }

        // A post can only belong to one store. Don't let the caller repoint it.
        if (showcase.storeId && showcase.storeId !== dto.storeId) {
          throw new ForbiddenException(
            'This post already belongs to a different store',
          );
        }

        const maxPosts = getMaxPostsPerMonth(store.subscriptionTier);
        if (!isUnlimited(store.subscriptionTier)) {
          if (store.postsCountThisMonth >= maxPosts!) {
            throw new ConflictException(
              'Post limit reached for your subscription tier',
            );
          }
        }

        // Associate the showcase with the store on first media upload and count it.
        if (!showcase.storeId) {
          showcase.storeId = dto.storeId;
          await this.showcases.save(showcase);
          await this.stores.increment(
            { id: store.id },
            'postsCountThisMonth',
            1,
          );
        }
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
      const maxSize =
        dto.kind === MediaKind.IMAGE ? maxImageSize : maxVideoSize;
      if (dto.fileSize > maxSize) {
        throw new BadRequestException(
          'File exceeds the size limit for the specified media kind',
        );
      }

      const mediaId = crypto.randomUUID();
      const safeFileName = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const originalKey = `media/${showcase.id}/${mediaId}/${safeFileName}`;

      const mediaAsset = this.mediaAssets.create({
        id: mediaId,
        showcaseId: showcase.id,
        kind: dto.kind,
        status: MediaStatus.PENDING,
        originalKey,
        mimeType: dto.fileType,
        sizeBytes: String(dto.fileSize),
      });

      await this.mediaAssets.save(mediaAsset);

      const { url } = await this.storage.presignedPutUrl(
        originalKey,
        dto.fileType,
      );

      return { url, mediaId, key: originalKey };
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
   * Mark an upload as complete: flip the asset to processing and enqueue a
   * BullMQ job for the worker to encode variants and update metadata.
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

      if (mediaAsset.status !== MediaStatus.PENDING) {
        throw new ConflictException('Media upload is not in a pending state');
      }

      mediaAsset.status = MediaStatus.PROCESSING;
      await this.mediaAssets.save(mediaAsset);

      await this.queue.enqueueMediaProcessing({
        mediaId: mediaAsset.id,
        originalKey: mediaAsset.originalKey!,
        kind: mediaAsset.kind,
        mimeType: mediaAsset.mimeType,
        sizeBytes: mediaAsset.sizeBytes,
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

  private sanitize(error: unknown): never {
    throw new ServiceUnavailableException(
      'Media storage is temporarily unavailable',
    );
  }
}
