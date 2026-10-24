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
  effectiveLimits,
  assertSubscriptionActive,
  boundedLimit,
  assertQuota,
  ownerWhere,
  StoreStatus,
  requireAdmin,
  mediaParent,
  MEDIA_OWNER_JOINS,
  MEDIA_OWNER_ID,
  type AdminActor,
} from '@app/database';
import { QueueService } from '@app/queue';
import { StorageService } from '@app/storage';
import { PresignedUrlDto, OwnerUploadDto } from './dto/presigned-url.dto';
import { MediaCompleteDto } from './dto/media-complete.dto';
import { randomUUID } from 'node:crypto';

@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(Showcase)
    private readonly showcases: Repository<Showcase>,
    @InjectRepository(Store) private readonly stores: Repository<Store>,
    @InjectRepository(MediaAsset)
    private readonly mediaAssets: Repository<MediaAsset>,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  async presignedUrl(dto: PresignedUrlDto, slug: string, ownerId: string) {
    const post = await this.showcases.findOneBy({
      slug,
      ...ownerWhere('post'),
    });
    if (!post) throw new NotFoundException('Post not found');
    if (dto.storeId && dto.storeId !== post.storeId)
      throw new BadRequestException('Store must match the post');
    return this.negotiate(
      { ...dto, targetId: post.id, purpose: 'post' },
      ownerId,
    );
  }

  async negotiate(
    dto: OwnerUploadDto,
    ownerId: string,
  ): Promise<{ url: string; mediaId: string; key: string }> {
    try {
      return await this.mediaAssets.manager.transaction(async (manager) => {
        const user = await manager.findOneOrFail(User, {
          where: { id: ownerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (user.suspendedAt)
          throw new ForbiddenException('Account unavailable');
        const target = {
          showcaseId: dto.purpose === 'post' ? dto.targetId : null,
          storeId:
            dto.purpose === 'store_logo' || dto.purpose === 'store_banner'
              ? dto.targetId
              : null,
          productId: dto.purpose === 'product_image' ? dto.targetId : null,
        };
        const parent = await mediaParent(manager, target);
        if (parent.ownerId !== ownerId)
          throw new ForbiddenException('You do not own this content');
        // Trial-expired owners cannot start new uploads. Completions of
        // uploads negotiated during the trial still succeed.
        await assertSubscriptionActive(manager, ownerId);
        if (dto.purpose !== 'post' && dto.kind !== MediaKind.IMAGE)
          throw new BadRequestException('Choose an image');
        if (!dto.fileType.startsWith(`${dto.kind}/`))
          throw new BadRequestException('File type does not match media kind');
        const limits = await effectiveLimits(manager, ownerId);
        const assets = manager
          .getRepository(MediaAsset)
          .createQueryBuilder('asset');
        if (target.showcaseId)
          assets.where('asset.showcaseId = :id', { id: target.showcaseId });
        else if (target.productId)
          assets.where('asset.productId = :id', { id: target.productId });
        else
          assets.where('asset.storeId = :id AND asset.purpose = :purpose', {
            id: target.storeId,
            purpose: dto.purpose,
          });
        assets.andWhere('asset.kind = :kind AND asset.status != :failed', {
          kind: dto.kind,
          failed: MediaStatus.FAILED,
        });
        if (!target.showcaseId)
          assets.andWhere('asset.status != :ready', {
            ready: MediaStatus.READY,
          });
        const count = await assets.getCount();
        if (dto.kind === MediaKind.IMAGE) {
          const attached = parent.product?.imageKeys?.length ?? 0;
          const limit = target.storeId
            ? 1
            : target.productId
              ? boundedLimit(20, limits.maxImageCount)
              : limits.maxImageCount;
          assertQuota(count + attached, limit, 'Image');
        }
        if (limits.maxStorageBytes != null) {
          const usage = (await manager.query(
            `SELECT COALESCE(SUM(a.size_bytes), 0) AS used FROM media_assets a ${MEDIA_OWNER_JOINS} WHERE ${MEDIA_OWNER_ID} = ? AND a.original_key IS NOT NULL`,
            [ownerId],
          )) as Array<{ used: string }>;
          const variants = (await manager.query(
            `SELECT COALESCE(SUM(v.size_bytes), 0) AS used FROM media_variants v JOIN media_assets a ON a.id = v.asset_id ${MEDIA_OWNER_JOINS} WHERE ${MEDIA_OWNER_ID} = ?`,
            [ownerId],
          )) as Array<{ used: string }>;
          if (
            BigInt(usage[0]?.used ?? '0') +
              BigInt(variants[0]?.used ?? '0') +
              BigInt(dto.fileSize) >
            BigInt(limits.maxStorageBytes)
          )
            throw new ConflictException(
              'Storage limit reached for your subscription',
            );
        }
        const maxBytes =
          dto.kind === MediaKind.IMAGE
            ? boundedLimit(
                this.config.get('MEDIA_MAX_IMAGE_SIZE_BYTES', { infer: true }),
                limits.maxImageSizeBytes,
              )
            : boundedLimit(
                this.config.get('MEDIA_MAX_VIDEO_SIZE_BYTES', { infer: true }),
                limits.maxVideoSizeBytes,
              );
        if (dto.fileSize > maxBytes)
          throw new BadRequestException('File exceeds the size limit');
        const heights: Record<string, number> = {
          '480p': 480,
          '720p': 720,
          '1080p': 1080,
          '4k': 2160,
          '8k': 4320,
        };
        const videoHeight = Math.min(
          this.config.get('MEDIA_MAX_VIDEO_HEIGHT', { infer: true }),
          heights[limits.maxVideoQuality ?? '1080p'] ?? 1080,
        );
        const id = randomUUID();
        const originalKey = `originals/${dto.targetId}/${id}/source`;
        const asset = manager.create(MediaAsset, {
          id,
          ...target,
          purpose: dto.purpose,
          kind: dto.kind,
          status: MediaStatus.PENDING,
          originalKey,
          mimeType: dto.fileType,
          sizeBytes: String(dto.fileSize),
          uploadExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          processingLimits: {
            maxBytes,
            maxDurationSeconds: boundedLimit(
              this.config.get('MEDIA_MAX_VIDEO_DURATION_SECONDS', {
                infer: true,
              }),
              limits.maxVideoDurationSeconds,
            ),
            maxWidth:
              dto.kind === MediaKind.IMAGE
                ? boundedLimit(20000, limits.maxImageWidth)
                : Math.ceil((videoHeight * 16) / 9),
            maxHeight:
              dto.kind === MediaKind.IMAGE
                ? boundedLimit(20000, limits.maxImageHeight)
                : videoHeight,
            maxPixels: this.config.get('MEDIA_MAX_IMAGE_PIXELS', {
              infer: true,
            }),
          },
        });
        await manager.save(asset);
        const { url } = await this.storage.presignedPutUrl(
          originalKey,
          dto.fileType,
          dto.fileSize,
        );
        return { url, mediaId: id, key: originalKey };
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  async mediaComplete(
    dto: MediaCompleteDto,
    slug: string,
    ownerId: string,
  ): Promise<void> {
    const post = await this.showcases.findOneBy({
      slug,
      ...ownerWhere('post'),
    });
    if (!post) throw new NotFoundException('Post not found');
    const asset = await this.ownedAsset(dto.mediaId, ownerId);
    if (asset.showcaseId !== post.id)
      throw new NotFoundException('Media asset not found');
    await this.complete(dto.mediaId, ownerId);
  }

  private async ownedAsset(id: string, ownerId: string): Promise<MediaAsset> {
    const asset = await this.mediaAssets.findOneBy({
      id,
      ...ownerWhere('media'),
    });
    if (
      !asset ||
      (await mediaParent(this.mediaAssets.manager, asset)).ownerId !== ownerId
    )
      throw new NotFoundException('Media asset not found');
    return asset;
  }

  async complete(id: string, ownerId: string): Promise<void> {
    try {
      const asset = await this.ownedAsset(id, ownerId);
      if ([MediaStatus.PROCESSING, MediaStatus.READY].includes(asset.status))
        return;
      this.pending(asset);
      if (!asset.originalKey)
        throw new ConflictException('Upload is no longer pending');
      const stored = await this.storage.statObject(asset.originalKey);
      if (
        stored.size !== Number(asset.sizeBytes) ||
        stored.size > (asset.processingLimits?.maxBytes ?? 0)
      )
        throw new BadRequestException('Uploaded media size is invalid');
      await this.mediaAssets.manager.transaction(async (manager) => {
        await manager.findOneOrFail(User, {
          where: { id: ownerId },
          lock: { mode: 'pessimistic_write' },
        });
        const current = await manager.findOneOrFail(MediaAsset, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          [MediaStatus.PROCESSING, MediaStatus.READY].includes(current.status)
        )
          return;
        this.pending(current);
        if ((await mediaParent(manager, current)).ownerId !== ownerId)
          throw new NotFoundException('Media asset not found');
        current.status = MediaStatus.PROCESSING;
        await manager.save(current);
        await manager.insert(MediaProcessingOutbox, { assetId: id });
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  async abandon(id: string, ownerId: string): Promise<void> {
    const asset = await this.ownedAsset(id, ownerId);
    if (asset.status !== MediaStatus.PENDING)
      throw new ConflictException('Upload cannot be abandoned');
    try {
      await this.mediaAssets.manager.transaction(async (manager) => {
        await manager.findOneOrFail(User, {
          where: { id: ownerId },
          lock: { mode: 'pessimistic_write' },
        });
        if ((await mediaParent(manager, asset)).ownerId !== ownerId)
          throw new NotFoundException('Media asset not found');
        await manager.update(
          MediaAsset,
          { id, status: MediaStatus.PENDING },
          { status: MediaStatus.FAILED },
        );
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  async status(id: string, ownerId: string) {
    const asset = await this.ownedAsset(id, ownerId);
    const variants =
      asset.status === MediaStatus.READY
        ? await this.mediaAssets.manager.find(MediaVariant, {
            where: { assetId: id },
            take: 30,
          })
        : [];
    return {
      id,
      status: asset.status,
      kind: asset.kind,
      variants: variants.map((v) => ({
        key: v.storageKey,
        mimeType: v.mimeType,
        width: v.width,
        height: v.height,
      })),
    };
  }

  private pending(asset: MediaAsset): void {
    if (
      asset.status !== MediaStatus.PENDING ||
      !asset.uploadExpiresAt ||
      asset.uploadExpiresAt <= new Date()
    )
      throw new ConflictException('Upload is no longer pending');
  }

  async authorizeUpload(key: string, ownerId: string): Promise<MediaAsset> {
    this.requireLocal();
    const asset = await this.mediaAssets.findOne({
      where: { originalKey: key, ...ownerWhere('media') },
    });
    if (
      !asset ||
      (await mediaParent(this.mediaAssets.manager, asset)).ownerId !== ownerId
    )
      throw new NotFoundException('Media asset not found');
    this.pending(asset);
    return asset;
  }

  async authorizeDownload(
    key: string,
    ownerId?: string,
    administrator?: AdminActor,
  ): Promise<{ mimeType: string; public: boolean }> {
    this.requireLocal();
    if (administrator)
      await requireAdmin(
        this.mediaAssets.manager,
        administrator,
        this.config.get('ADMIN_EMAILS', { infer: true }),
      );
    const variant = await this.mediaAssets.manager
      .getRepository(MediaVariant)
      .findOne({
        where: {
          storageKey: key,
          ...(administrator ? {} : { asset: ownerWhere('media') }),
        },
        relations: ['asset'],
      });
    if (variant) {
      if (administrator) return { mimeType: variant.mimeType, public: false };
      const {
        post,
        store,
        product,
        ownerId: actualOwner,
      } = await mediaParent(this.mediaAssets.manager, variant.asset);
      const attached = post
        ? post.status === 'published'
        : product
          ? product.status === 'active' &&
            Boolean(product.imageKeys?.includes(key))
          : Boolean(
              store && (store.logoKey === key || store.bannerKey === key),
            );
      const visible =
        variant.asset.status === MediaStatus.READY &&
        attached &&
        (!store || store.status === StoreStatus.ACTIVE);
      if (visible || actualOwner === ownerId)
        return { mimeType: variant.mimeType, public: visible };
    }
    const original = await this.mediaAssets.findOne({
      where: {
        originalKey: key,
        ...(administrator ? {} : ownerWhere('media')),
      },
    });
    if (
      original &&
      (administrator ||
        (await mediaParent(this.mediaAssets.manager, original)).ownerId ===
          ownerId)
    )
      return { mimeType: original.mimeType, public: false };
    throw new NotFoundException('Media asset not found');
  }

  requireLocal(): void {
    if (this.config.get('STORAGE_PROVIDER', { infer: true }) !== 'local')
      throw new NotFoundException('Media route not found');
  }

  private sanitize(error: unknown): never {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(
      'Media storage is temporarily unavailable',
    );
  }
}
