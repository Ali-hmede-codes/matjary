import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import type { EntityManager, Repository } from 'typeorm';
import type { AppEnvironment } from '@app/config';
import {
  Showcase,
  Store,
  MediaAsset,
  MediaKind,
  MediaStatus,
  MediaVariant,
  MediaProcessingOutbox,
  StoreStory,
  User,
  effectiveLimits,
  assertSubscriptionActive,
  boundedLimit,
  assertQuota,
  liveStoryCount,
  liveStoryWhere,
  STORY_LIMIT_CODE,
  STORY_MAX_DURATION_SECONDS,
  ownerWhere,
  StoreStatus,
  requireAdmin,
  mediaParent,
  storeAccess,
  MEDIA_OWNER_JOINS,
  MEDIA_OWNER_ID,
  type AdminActor,
} from '@app/database';
import { QueueService } from '@app/queue';
import { StorageService, mediaAssetIdFromKey } from '@app/storage';
import { PresignedUrlDto, OwnerUploadDto } from './dto/presigned-url.dto';
import { MediaCompleteDto } from './dto/media-complete.dto';
import { randomUUID } from 'node:crypto';

// Purposes whose media hangs off a shop instead of a post or a product.
const STORE_SCOPED_PURPOSES: ReadonlyArray<MediaAsset['purpose']> = [
  'store_logo',
  'store_banner',
  'store_story',
];

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
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

  async presignedUrl(dto: PresignedUrlDto, slug: string, userId: string) {
    const post = await this.showcases.findOneBy({
      slug,
      ...ownerWhere('post'),
    });
    if (!post) throw new NotFoundException('Post not found');
    await this.assertPostAccess(post, userId);
    if (dto.storeId && dto.storeId !== post.storeId)
      throw new BadRequestException('Store must match the post');
    return this.negotiate(
      { ...dto, targetId: post.id, purpose: 'post' },
      userId,
    );
  }

  // Shop posts are authored by the owner and their team; standalone posts stay
  // private to the account that wrote them.
  private async assertPostAccess(
    post: Showcase,
    userId: string,
  ): Promise<void> {
    if (post.ownerId === userId) return;
    if (
      post.storeId &&
      (await storeAccess(this.showcases.manager, userId, post.storeId))
    )
      return;
    throw new NotFoundException('Post not found');
  }

  // An asset is reachable through its shop (direct, product, or shop post).
  // Team members share that reach for content, but branding (logo/banner) stays
  // an owner-only upload even though it hangs off the same shop.
  private async canManageParent(
    manager: EntityManager,
    parent: { ownerId: string; store: Store | null },
    userId: string | undefined,
    purpose?: MediaAsset['purpose'],
  ): Promise<boolean> {
    if (!userId) return false;
    if (purpose === 'store_logo' || purpose === 'store_banner')
      return parent.ownerId === userId;
    if (parent.ownerId === userId) return true;
    if (!parent.store) return false;
    return Boolean(await storeAccess(manager, userId, parent.store.id));
  }

  async negotiate(
    dto: OwnerUploadDto,
    actorId: string,
  ): Promise<{ url: string; mediaId: string; key: string }> {
    try {
      return await this.mediaAssets.manager.transaction(async (manager) => {
        const target = {
          showcaseId: dto.purpose === 'post' ? dto.targetId : null,
          storeId: STORE_SCOPED_PURPOSES.includes(dto.purpose)
            ? dto.targetId
            : null,
          productId: dto.purpose === 'product_image' ? dto.targetId : null,
        };
        const parent = await mediaParent(manager, target);
        if (
          !(await this.canManageParent(manager, parent, actorId, dto.purpose))
        )
          throw new ForbiddenException('You do not own this content');
        // The asset belongs to the shop owner even when a team member uploads
        // it, keeping plans, storage accounting, and public visibility stable.
        const ownerId = parent.ownerId;
        const user = await manager.findOneOrFail(User, {
          where: { id: ownerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (user.suspendedAt)
          throw new ForbiddenException('Account unavailable');
        // Trial-expired owners cannot start new uploads. Completions of
        // uploads negotiated during the trial still succeed.
        await assertSubscriptionActive(manager, ownerId);
        // Stories are the only shop-scoped upload that may be a video.
        if (
          dto.purpose !== 'post' &&
          dto.purpose !== 'store_story' &&
          dto.kind !== MediaKind.IMAGE
        )
          throw new BadRequestException('Choose an image');
        if (!dto.fileType.startsWith(`${dto.kind}/`))
          throw new BadRequestException('File type does not match media kind');
        const limits = await effectiveLimits(manager, ownerId);
        if (dto.purpose === 'store_story') {
          // Story slots are a live count per shop: published stories plus
          // uploads still in flight. The image quota and the one-image cap for
          // shop branding do not apply, because a story is neither.
          const live = await liveStoryCount(manager, dto.targetId);
          const pending = await manager
            .getRepository(MediaAsset)
            .createQueryBuilder('asset')
            .where('asset.storeId = :storeId AND asset.purpose = :purpose', {
              storeId: dto.targetId,
              purpose: dto.purpose,
            })
            .andWhere('asset.status IN (:...statuses)', {
              statuses: [MediaStatus.PENDING, MediaStatus.PROCESSING],
            })
            .andWhere('asset.uploadExpiresAt > :now', { now: new Date() })
            .getCount();
          // The storefront translates this code into slot copy.
          if (limits.maxStories != null && live + pending >= limits.maxStories)
            throw new ConflictException({ code: STORY_LIMIT_CODE });
        } else {
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
            maxDurationSeconds:
              dto.purpose === 'store_story'
                ? Math.min(
                    STORY_MAX_DURATION_SECONDS,
                    boundedLimit(
                      this.config.get('MEDIA_MAX_VIDEO_DURATION_SECONDS', {
                        infer: true,
                      }),
                      limits.maxVideoDurationSeconds,
                    ),
                  )
                : boundedLimit(
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
    userId: string,
  ): Promise<void> {
    const post = await this.showcases.findOneBy({
      slug,
      ...ownerWhere('post'),
    });
    if (!post) throw new NotFoundException('Post not found');
    await this.assertPostAccess(post, userId);
    const asset = await this.ownedAsset(dto.mediaId, userId);
    if (asset.showcaseId !== post.id)
      throw new NotFoundException('Media asset not found');
    await this.complete(dto.mediaId, userId);
  }

  private async ownedAsset(id: string, userId: string): Promise<MediaAsset> {
    return (await this.resolvedAsset(id, userId)).asset;
  }

  // Resolves the asset plus the account that owns its content. A shop team
  // member may finish or cancel an upload they started for that shop.
  private async resolvedAsset(
    id: string,
    userId: string,
  ): Promise<{ asset: MediaAsset; ownerId: string }> {
    const asset = await this.mediaAssets.findOneBy({
      id,
      ...ownerWhere('media'),
    });
    if (!asset) throw new NotFoundException('Media asset not found');
    const parent = await mediaParent(this.mediaAssets.manager, asset);
    if (
      !(await this.canManageParent(
        this.mediaAssets.manager,
        parent,
        userId,
        asset.purpose,
      ))
    )
      throw new NotFoundException('Media asset not found');
    return { asset, ownerId: parent.ownerId };
  }

  async complete(id: string, userId: string): Promise<void> {
    try {
      const { asset, ownerId } = await this.resolvedAsset(id, userId);
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
      let queued = false;
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
        queued = true;
      });
      // Hand the job over immediately instead of waiting for the worker's
      // repair sweep, which otherwise added up to ten seconds to every upload.
      if (queued) await this.enqueue(asset);
    } catch (error) {
      this.sanitize(error);
    }
  }

  private async enqueue(asset: MediaAsset): Promise<void> {
    if (!asset.originalKey) return;
    try {
      await this.queue.enqueueMediaProcessing({
        mediaId: asset.id,
        originalKey: asset.originalKey,
        kind: asset.kind,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
      });
    } catch {
      // The outbox row is durable: the worker sweep retries a lost enqueue,
      // so a Redis hiccup must not fail the owner's request.
      this.logger.warn(`Media job enqueue deferred for ${asset.id}`);
    }
  }

  async abandon(id: string, userId: string): Promise<void> {
    const { asset, ownerId } = await this.resolvedAsset(id, userId);
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

  async status(id: string, userId: string) {
    const { asset } = await this.resolvedAsset(id, userId);
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

  async authorizeUpload(key: string, userId: string): Promise<MediaAsset> {
    this.requireLocal();
    const asset = await this.mediaAssets.findOne({
      where: { originalKey: key, ...ownerWhere('media') },
    });
    if (!asset) throw new NotFoundException('Media asset not found');
    const parent = await mediaParent(this.mediaAssets.manager, asset);
    if (
      !(await this.canManageParent(
        this.mediaAssets.manager,
        parent,
        userId,
        asset.purpose,
      ))
    )
      throw new NotFoundException('Media asset not found');
    this.pending(asset);
    return asset;
  }

  async authorizeDownload(
    key: string,
    userId?: string,
    administrator?: AdminActor,
  ): Promise<{ mimeType: string; public: boolean; storeId: string | null }> {
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
      if (administrator)
        return { mimeType: variant.mimeType, public: false, storeId: null };
      const {
        post,
        store,
        product,
        ownerId: actualOwner,
      } = await mediaParent(this.mediaAssets.manager, variant.asset);
      // Any READY size of an attached image is public: variants carry the same
      // picture, and share previews need a wider (JPEG) sibling than the key
      // the owner saved. Detached assets never qualify.
      const belongs = (candidate: string | null | undefined) =>
        candidate != null &&
        (candidate === key ||
          mediaAssetIdFromKey(candidate) === variant.assetId);
      const attached = post
        ? post.status === 'published'
        : product
          ? product.status === 'active' &&
            Boolean(product.imageKeys?.some(belongs))
          : Boolean(
              store && (belongs(store.logoKey) || belongs(store.bannerKey)),
            );
      // A story's processed media is public only while the story is live and
      // its shop is active; an expired or deleted story stops serving bytes.
      const storyAttached =
        !attached &&
        variant.asset.purpose === 'store_story' &&
        (await this.mediaAssets.manager.exists(StoreStory, {
          where: { mediaAssetId: variant.assetId, ...liveStoryWhere() },
        }));
      const visible =
        variant.asset.status === MediaStatus.READY &&
        (attached || storyAttached) &&
        (!store || store.status === StoreStatus.ACTIVE);
      const manageable = await this.canManageParent(
        this.mediaAssets.manager,
        { ownerId: actualOwner, store },
        userId,
        variant.asset.purpose,
      );
      if (visible || manageable)
        return {
          mimeType: variant.mimeType,
          public: visible,
          // The shop that owns the bytes; a locked shop's files may live in the
          // archive tier, and the route needs its id to find them.
          storeId: store?.id ?? null,
        };
    }
    const original = await this.mediaAssets.findOne({
      where: {
        originalKey: key,
        ...(administrator ? {} : ownerWhere('media')),
      },
    });
    if (original) {
      const parent = await mediaParent(this.mediaAssets.manager, original);
      if (
        administrator ||
        (await this.canManageParent(
          this.mediaAssets.manager,
          parent,
          userId,
          original.purpose,
        ))
      )
        return {
          mimeType: original.mimeType,
          public: false,
          storeId: parent.store?.id ?? null,
        };
    }
    throw new NotFoundException('Media asset not found');
  }

  requireLocal(): void {
    if (this.config.get('STORAGE_PROVIDER', { infer: true }) !== 'local')
      throw new NotFoundException('Media route not found');
  }

  private sanitize(error: unknown): never {
    if (error instanceof HttpException) throw error;
    // Driver codes (never messages) make a 503 diagnosable from server logs.
    const code = (error as { driverError?: { code?: string } }).driverError
      ?.code;
    this.logger.warn(`Media request failed${code ? ` (${code})` : ''}`);
    throw new ServiceUnavailableException(
      'Media storage is temporarily unavailable',
    );
  }
}
