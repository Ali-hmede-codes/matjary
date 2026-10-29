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
import { In, QueryFailedError, type Repository } from 'typeorm';
import {
  MediaAsset,
  MediaKind,
  MediaStatus,
  MediaVariant,
  Product,
  Store,
  StoreCategory,
  StoreStatus,
  StoreStory,
  User,
  assertSubscriptionActive,
  businessCategoryLabel,
  effectiveLimits,
  isPublicProductStatus,
  liveStoryCount,
  liveStoryWhere,
  ownerWhere,
  publicVisibilitySql,
  purgeStoryRecords,
  storyExpiresAt,
  STORY_LIMIT_CODE,
  STORY_OFFLINE_CODE,
  assertStoreAccess,
  storeAccessBySlug,
} from '@app/database';
import { StorageService } from '@app/storage';
import { deleteStoredObjects } from '../media-cleanup';
import {
  CreateStoryDto,
  type MyStoriesResponse,
  type StoryDto,
  type StoryGroupDto,
  type StoryLinkDto,
  type StoryListResponse,
  type StoryMediaDto,
  type StoryStoreDto,
} from './dto/story.dto';

const DEFAULT_GROUP_LIMIT = 25;
const MAX_GROUP_LIMIT = 50;
// One shop can rarely exceed a plan quota; the cap only protects the response
// when an administrator sets maxStories to unlimited.
const MAX_STORIES_PER_SHOP = 30;
const LIST_SCAN_LIMIT = 400;

@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);

  constructor(
    @InjectRepository(StoreStory)
    private readonly stories: Repository<StoreStory>,
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    @InjectRepository(MediaAsset)
    private readonly assets: Repository<MediaAsset>,
    @InjectRepository(MediaVariant)
    private readonly variants: Repository<MediaVariant>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(StoreCategory)
    private readonly categories: Repository<StoreCategory>,
    private readonly storage: StorageService,
  ) {}

  /**
   * Public rail and story page. Every live story of every visible shop, grouped
   * per shop; `shops` narrows the result to the shops a page already knows.
   */
  async list(shopSlugs: string[], limit: number): Promise<StoryListResponse> {
    try {
      const now = new Date();
      const query = this.stories
        .createQueryBuilder('story')
        .innerJoin(Store, 'store', 'store.id = story.store_id')
        .where('story.expires_at > :now', { now })
        // Public visibility already requires an active, unarchived shop whose
        // owner is not suspended.
        .andWhere(`(${publicVisibilitySql('store', 'store')})`)
        .orderBy('story.created_at', 'DESC')
        .take(LIST_SCAN_LIMIT)
        .select(['story.id AS id', 'story.store_id AS storeId']);
      if (shopSlugs.length > 0)
        query.andWhere('store.slug IN (:...slugs)', { slugs: shopSlugs });
      const rows = await query.getRawMany<{ id: string; storeId: string }>();
      if (rows.length === 0) return { groups: [], total: 0 };

      // Preserve the newest-first shop order while bounding the response.
      const storeOrder: string[] = [];
      const storyIdsByStore = new Map<string, string[]>();
      for (const row of rows) {
        const ids = storyIdsByStore.get(row.storeId);
        if (!ids) {
          if (storeOrder.length >= limit) continue;
          storeOrder.push(row.storeId);
          storyIdsByStore.set(row.storeId, [row.id]);
        } else if (ids.length < MAX_STORIES_PER_SHOP) {
          ids.push(row.id);
        }
      }

      const stores = await this.stores.find({
        where: { id: In(storeOrder) },
        select: {
          id: true,
          name: true,
          slug: true,
          logoKey: true,
          brandColor: true,
          hasVerificationBadge: true,
          verificationBadgeExpiresAt: true,
          businessCategory: true,
        },
      });
      const storeMap = new Map(stores.map((store) => [store.id, store]));
      const stories = await this.stories.find({
        where: { id: In(rows.map((row) => row.id)) },
        order: { createdAt: 'ASC' },
      });
      const storyMap = new Map(stories.map((story) => [story.id, story]));
      const storyDtos = await this.toStoryDtos(stories);

      const groups: StoryGroupDto[] = [];
      for (const storeId of storeOrder) {
        const store = storeMap.get(storeId);
        if (!store) continue;
        const items = (storyIdsByStore.get(storeId) ?? [])
          .map((id) => storyMap.get(id))
          .filter((story): story is StoreStory => Boolean(story))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .flatMap((story) => {
            const dto = storyDtos.get(story.id);
            return dto ? [dto] : [];
          });
        if (items.length === 0) continue;
        groups.push({ store: this.toStoreDto(store, now), stories: items });
      }

      return {
        groups,
        total: groups.reduce((sum, group) => sum + group.stories.length, 0),
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  /** Owner and team view: live stories plus the shop's remaining slots. */
  async mine(storeSlug: string, userId: string): Promise<MyStoriesResponse> {
    try {
      const access = await storeAccessBySlug(
        this.stores.manager,
        userId,
        storeSlug,
      );
      if (!access) throw new NotFoundException('Store not found');
      const store = access.store;

      const now = new Date();
      const stories = await this.stories.find({
        where: { storeId: store.id, ...liveStoryWhere(now) },
        order: { createdAt: 'ASC' },
      });
      const limits = await effectiveLimits(
        this.stores.manager,
        access.ownerId,
        now,
      );
      const limit = limits.maxStories ?? null;
      const storyDtos = await this.toStoryDtos(stories);

      return {
        storeId: store.id,
        limit,
        used: stories.length,
        remaining: limit == null ? null : Math.max(0, limit - stories.length),
        stories: stories.flatMap((story) => {
          const dto = storyDtos.get(story.id);
          return dto ? [dto] : [];
        }),
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  /** Publishes an already processed upload as a live story. */
  async create(dto: CreateStoryDto, userId: string): Promise<StoryDto> {
    try {
      const story = await this.stories.manager.transaction(async (manager) => {
        const store = await manager.findOneBy(Store, {
          slug: dto.storeSlug,
          ...ownerWhere('store'),
        });
        if (!store) throw new NotFoundException('Store not found');

        // Members publish for the shop owner, so the plan allowance and the
        // story row belong to the owner's account.
        const ownerId = (await assertStoreAccess(manager, userId, store.id))
          .ownerId;
        if (store.status !== StoreStatus.ACTIVE)
          throw new ConflictException({ code: STORY_OFFLINE_CODE });
        const user = await manager.findOne(User, {
          where: { id: ownerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!user || user.suspendedAt)
          throw new ForbiddenException('Account unavailable');
        await assertSubscriptionActive(manager, ownerId);

        const limits = await effectiveLimits(manager, ownerId);
        const live = await liveStoryCount(manager, store.id);
        // The storefront turns this code into "every slot is in use" copy.
        if (limits.maxStories != null && live >= limits.maxStories)
          throw new ConflictException({ code: STORY_LIMIT_CODE });

        const asset = await manager.findOne(MediaAsset, {
          where: { id: dto.mediaId, ...ownerWhere('media') },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !asset ||
          asset.storeId !== store.id ||
          asset.purpose !== 'store_story'
        )
          throw new NotFoundException('Story media not found');
        if (asset.status !== MediaStatus.READY)
          throw new ConflictException(
            'Wait for the media to finish processing',
          );
        const attached = await manager.findOneBy(StoreStory, {
          mediaAssetId: asset.id,
        });
        if (attached)
          throw new ConflictException('This media is already a story');

        if (dto.linkedProductId && dto.linkedCategoryId)
          throw new BadRequestException(
            'A story can link one item or one section, not both',
          );
        if (dto.linkedProductId) {
          const product = await manager.findOneBy(Product, {
            id: dto.linkedProductId,
          });
          if (
            !product ||
            product.storeId !== store.id ||
            product.adminArchivedAt
          )
            throw new NotFoundException('Product not found');
        }
        if (dto.linkedCategoryId) {
          const category = await manager.findOneBy(StoreCategory, {
            id: dto.linkedCategoryId,
          });
          if (!category || category.storeId !== store.id)
            throw new NotFoundException('Category not found');
        }

        const saved = manager.create(StoreStory, {
          storeId: store.id,
          ownerId,
          mediaAssetId: asset.id,
          linkedProductId: dto.linkedProductId ?? null,
          linkedCategoryId: dto.linkedCategoryId ?? null,
          expiresAt: storyExpiresAt(),
        });
        return manager.save(saved);
      });

      const storyDto = (await this.toStoryDtos([story])).get(story.id);
      if (!storyDto) throw new NotFoundException('Story not found');
      return storyDto;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (
        error instanceof QueryFailedError &&
        (error as { driverError?: { code?: string } }).driverError?.code ===
          'ER_DUP_ENTRY'
      )
        throw new ConflictException('This media is already a story');
      this.sanitize(error);
    }
  }

  /** Removes a story immediately; the slot is free for the next publish. */
  async remove(id: string, userId: string): Promise<void> {
    let keys: string[] = [];
    try {
      const story = await this.stories.findOneBy({ id });
      if (!story) throw new NotFoundException('Story not found');
      const access = await assertStoreAccess(
        this.stories.manager,
        userId,
        story.storeId,
      );
      const ownerId = access.ownerId;

      keys = await this.stories.manager.transaction(async (manager) => {
        const user = await manager.findOne(User, {
          where: { id: ownerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!user || user.suspendedAt)
          throw new NotFoundException('Story not found');
        const locked = await manager.findOne(StoreStory, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked || locked.ownerId !== ownerId)
          throw new NotFoundException('Story not found');
        return purgeStoryRecords(manager, locked);
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.sanitize(error);
    }
    // Bytes go only after the rows are gone; a cleanup hiccup must never report
    // a committed deletion as failed.
    await deleteStoredObjects(this.storage, keys);
  }

  private async toStoryDtos(
    stories: StoreStory[],
  ): Promise<Map<string, StoryDto>> {
    const result = new Map<string, StoryDto>();
    if (stories.length === 0) return result;

    const assetIds = [...new Set(stories.map((story) => story.mediaAssetId))];
    const assets = await this.assets.find({
      where: { id: In(assetIds), status: MediaStatus.READY },
    });
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    const variants = await this.variants.find({
      where: { assetId: In(assets.map((asset) => asset.id)) },
    });
    const variantsByAsset = new Map<string, MediaVariant[]>();
    for (const variant of variants) {
      const list = variantsByAsset.get(variant.assetId) ?? [];
      list.push(variant);
      variantsByAsset.set(variant.assetId, list);
    }

    // Links resolve in two batched lookups and only survive while they belong
    // to the story's own shop and are still public.
    const productIds = [
      ...new Set(
        stories.flatMap((story) =>
          story.linkedProductId ? [story.linkedProductId] : [],
        ),
      ),
    ];
    const categoryIds = [
      ...new Set(
        stories.flatMap((story) =>
          story.linkedCategoryId ? [story.linkedCategoryId] : [],
        ),
      ),
    ];
    const [products, categories] = await Promise.all([
      productIds.length
        ? this.products.findBy({ id: In(productIds) })
        : Promise.resolve([]),
      categoryIds.length
        ? this.categories.findBy({ id: In(categoryIds) })
        : Promise.resolve([]),
    ]);
    const productMap = new Map(
      products.map((product) => [product.id, product]),
    );
    const categoryMap = new Map(
      categories.map((category) => [category.id, category]),
    );

    for (const story of stories) {
      const asset = assetMap.get(story.mediaAssetId);
      if (!asset) continue;
      const media = await this.toMediaDto(
        asset,
        variantsByAsset.get(asset.id) ?? [],
      );
      let link: StoryLinkDto | undefined;
      const product = story.linkedProductId
        ? productMap.get(story.linkedProductId)
        : undefined;
      const category = story.linkedCategoryId
        ? categoryMap.get(story.linkedCategoryId)
        : undefined;
      if (
        product &&
        product.storeId === story.storeId &&
        !product.adminArchivedAt &&
        isPublicProductStatus(product.status)
      ) {
        link = {
          type: 'product',
          name: product.name,
          slug: product.slug,
          priceCents: product.priceCents,
          currency: product.currency,
          compareAtPriceCents: product.compareAtPriceCents ?? null,
        };
      } else if (category && category.storeId === story.storeId) {
        link = {
          type: 'category',
          name: category.name,
          slug: null,
          priceCents: null,
          currency: null,
          compareAtPriceCents: null,
        };
      }
      result.set(story.id, {
        id: story.id,
        createdAt: story.createdAt,
        expiresAt: story.expiresAt,
        media,
        ...(link ? { link } : {}),
      });
    }
    return result;
  }

  private async toMediaDto(
    asset: MediaAsset,
    variants: MediaVariant[],
  ): Promise<StoryMediaDto> {
    const primary = this.selectPrimaryVariant(variants, asset.kind);
    const poster =
      asset.kind === MediaKind.VIDEO
        ? variants.find((variant) => variant.label.startsWith('poster'))
        : undefined;
    return {
      id: asset.id,
      kind: asset.kind,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      primaryUrl: primary ? await this.mediaUrl(primary.storageKey) : '',
      posterUrl: poster ? await this.mediaUrl(poster.storageKey) : null,
    };
  }

  // Full-screen stories want a portrait-friendly width; the encoder never
  // upscales, so the closest available size is the honest choice.
  private selectPrimaryVariant(
    variants: MediaVariant[],
    kind: MediaKind,
  ): MediaVariant | undefined {
    if (variants.length === 0) return undefined;
    if (kind === MediaKind.VIDEO) {
      const mp4 = variants.find((variant) => variant.label.startsWith('mp4-'));
      return mp4 ?? variants[0];
    }
    const preferred = ['avif', 'webp', 'jpeg'];
    for (const format of preferred) {
      const matches = variants
        .filter((variant) => variant.label.startsWith(`${format}-`))
        .sort((a, b) => Math.abs(a.width - 1080) - Math.abs(b.width - 1080));
      if (matches[0]) return matches[0];
    }
    return variants[0];
  }

  private async mediaUrl(storageKey: string): Promise<string> {
    try {
      return await this.storage.presignedGetUrl(storageKey);
    } catch {
      // Local storage serves variants through the authorized media route.
      return `/api/v1/uploads/${encodeURIComponent(storageKey)}`;
    }
  }

  private toStoreDto(store: Store, now: Date): StoryStoreDto {
    return {
      id: store.id,
      name: store.name,
      slug: store.slug,
      logoKey: store.logoKey,
      brandColor: store.brandColor,
      hasVerificationBadge:
        store.hasVerificationBadge &&
        (!store.verificationBadgeExpiresAt ||
          store.verificationBadgeExpiresAt > now),
      verificationBadgeExpiresAt: store.verificationBadgeExpiresAt,
      businessCategoryLabel: businessCategoryLabel(store.businessCategory),
    };
  }

  private sanitize(error: unknown): never {
    if (error instanceof HttpException) throw error;
    this.logger.warn('Story request failed');
    throw new ServiceUnavailableException(
      'Stories are temporarily unavailable',
    );
  }
}

export function storyListLimit(value: number | undefined): number {
  return Math.min(Math.max(value ?? DEFAULT_GROUP_LIMIT, 1), MAX_GROUP_LIMIT);
}
