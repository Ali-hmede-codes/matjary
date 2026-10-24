import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  Showcase,
  ShowcaseStatus,
  Store,
  MediaAsset,
  MediaKind,
  MediaStatus,
  Product,
  ProductStatus,
  PostEngagement,
  MediaVariant,
  publicWhere,
  publicVisibilitySql,
} from '@app/database';
import {
  PostEngagementService,
  ResolvedViewer,
} from '../engagement/post-engagement.service';
import { LocationService } from '../../stores/services/location.service';
import { MediaService } from '../media.service';
import { StorageService } from '@app/storage';

export interface FeedItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: ShowcaseStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ownerId: string;
  storeId: string | null;
  store?: {
    id: string;
    name: string;
    slug: string;
    logoKey: string | null;
    brandColor: string | null;
    location?: {
      city: string | null;
      country: string | null;
      latitude: number | null;
      longitude: number | null;
    };
  };
  media: FeedMediaItem[];
  engagement: {
    likes: number;
    views: number;
    viewerLiked: boolean;
  };
  // Algorithm score for debugging/ordering
  _algorithmScore?: number;
}

export interface FeedMediaItem {
  id: string;
  kind: MediaKind;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  // URLs for different variants
  variants: {
    label: string;
    url: string;
    width: number;
    height: number;
    mimeType: string;
  }[];
  // Primary URL (best variant for feed display)
  primaryUrl: string;
  // Poster for videos
  posterUrl: string | null;
}

export interface FeedResponse {
  items: FeedItem[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
  algorithm: string;
}

export interface ExploreParams {
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  category?: string;
  city?: string;
  country?: string;
  limit: number;
  cursor?: string;
  algorithm?: 'trending' | 'popular' | 'recent' | 'nearby' | 'mixed';
  timeWindowHours?: number;
}

export interface TrendingParams {
  timeWindowHours?: number;
  limit: number;
  cursor?: string;
}

export interface StoreFeedParams {
  storeSlug: string;
  limit: number;
  cursor?: string;
}

@Injectable()
export class FeedExploreService {
  private readonly logger = new Logger(FeedExploreService.name);

  constructor(
    @InjectRepository(Showcase)
    private readonly showcases: Repository<Showcase>,
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    @InjectRepository(MediaAsset)
    private readonly mediaAssets: Repository<MediaAsset>,
    @InjectRepository(PostEngagement)
    private readonly engagementRepo: Repository<PostEngagement>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    private readonly engagementService: PostEngagementService,
    private readonly locationService: LocationService,
    private readonly mediaService: MediaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  // ============================================
  // MAIN FEED (Personalized for authenticated users)
  // ============================================

  /**
   * Get personalized feed for a user
   * Algorithm: Combines following + interactions + recency + engagement
   */
  async getPersonalizedFeed(
    userId: string,
    limit: number = 20,
    cursor?: string,
  ): Promise<FeedResponse> {
    try {
      // Get stores the user owns (their own posts)
      const userStores = await this.stores.find({
        where: { ownerId: userId, ...publicWhere('store') },
        select: ['id'],
      });
      const userStoreIds = userStores.map((s) => s.id);

      // Get stores the user has interacted with (liked/commented posts)
      // For now, we'll use stores from posts they've liked
      const interactedStoreIds = await this.getInteractedStoreIds(userId);

      // Combine: user's own stores + interacted stores
      const relevantStoreIds = Array.from(
        new Set([...userStoreIds, ...interactedStoreIds]),
      );

      let query = this.showcases
        .createQueryBuilder('showcase')
        .innerJoinAndSelect('showcase.store', 'store')
        .where('showcase.status = :status', {
          status: ShowcaseStatus.PUBLISHED,
        })
        .andWhere('showcase.publishedAt IS NOT NULL')
        .andWhere(publicVisibilitySql('post', 'showcase'));

      if (relevantStoreIds.length > 0) {
        query = query.andWhere('showcase.storeId IN (:...storeIds)', {
          storeIds: relevantStoreIds,
        });
      } else {
        // If no relevant stores, fall back to recent posts from all stores
        // But prioritize stores with high engagement
        query = query
          .leftJoin('store', 's2')
          .addSelect('s2.id')
          .orderBy('showcase.publishedAt', 'DESC');
      }

      // Cursor-based pagination
      if (cursor) {
        const cursorDate = new Date(cursor);
        query = query.andWhere('showcase.publishedAt < :cursorDate', {
          cursorDate,
        });
      }

      query = query
        .orderBy('showcase.publishedAt', 'DESC')
        .addOrderBy('showcase.createdAt', 'DESC')
        .take(limit + 1); // Take one extra to check hasMore

      const items = await query.getMany();

      const hasMore = items.length > limit;
      const displayItems = hasMore ? items.slice(0, limit) : items;
      const lastItem =
        displayItems.length > 0
          ? displayItems[displayItems.length - 1]
          : undefined;
      const nextCursor =
        hasMore && lastItem?.publishedAt
          ? lastItem.publishedAt.toISOString()
          : undefined;

      // Enrich with media and engagement
      const enrichedItems = await this.enrichFeedItems(displayItems, userId);

      // Apply final ranking algorithm
      const rankedItems = this.rankFeedItems(enrichedItems, 'personalized');

      return {
        items: rankedItems,
        total: rankedItems.length,
        hasMore,
        nextCursor,
        algorithm: 'personalized',
      };
    } catch (error) {
      this.logger.error('Error getting personalized feed:', error);
      throw new ServiceUnavailableException('Feed temporarily unavailable');
    }
  }

  /**
   * Get stores the user has interacted with (via likes)
   */
  private async getInteractedStoreIds(userId: string): Promise<string[]> {
    try {
      // Get post IDs the user liked from post_likes table
      const likes = await this.engagementRepo.manager
        .createQueryBuilder()
        .select('showcase.storeId')
        .from('post_likes', 'pl')
        .innerJoin('showcases', 'showcase', 'showcase.id = pl.post_id')
        .where('pl.voter_id = :userId', { userId })
        .andWhere('pl.voter_type = :type', { type: 'user' })
        .andWhere('showcase.storeId IS NOT NULL')
        .distinct()
        .getRawMany();

      return likes.map((l) => l.storeId).filter(Boolean) as string[];
    } catch {
      return [];
    }
  }

  // ============================================
  // EXPLORE - Discovery Algorithms
  // ============================================

  /**
   * Get explore feed with multiple algorithms
   */
  async getExploreFeed(
    params: ExploreParams,
    viewer?: ResolvedViewer,
  ): Promise<FeedResponse> {
    const {
      latitude,
      longitude,
      radiusKm = 25,
      category,
      city,
      country,
      limit = 20,
      cursor,
      algorithm = 'mixed',
    } = params;

    let items: FeedItem[] = [];

    switch (algorithm) {
      case 'trending':
        items = await this.getTrendingPosts(params, viewer);
        break;
      case 'popular':
        items = await this.getPopularPosts(params, viewer);
        break;
      case 'recent':
        items = await this.getRecentPosts(params, viewer);
        break;
      case 'nearby':
        items = await this.getNearbyPosts(params, viewer);
        break;
      case 'mixed':
      default:
        items = await this.getMixedExploreFeed(params, viewer);
        break;
    }

    // Apply cursor pagination
    const paginated = this.paginateItems(items, limit, cursor);

    return {
      items: paginated.items,
      total: items.length,
      hasMore: paginated.hasMore,
      nextCursor: paginated.nextCursor,
      algorithm,
    };
  }

  /**
   * Mixed explore feed - combines multiple signals
   * This is the main explore page algorithm
   */
  private async getMixedExploreFeed(
    params: ExploreParams,
    viewer?: ResolvedViewer,
  ): Promise<FeedItem[]> {
    const { latitude, longitude, radiusKm, category, city, country, limit } =
      params;

    // Build base query
    let query = this.showcases
      .createQueryBuilder('showcase')
      .innerJoinAndSelect('showcase.store', 'store')
      .where('showcase.status = :status', { status: ShowcaseStatus.PUBLISHED })
      .andWhere(publicVisibilitySql('post', 'showcase'))
      .andWhere('showcase.publishedAt IS NOT NULL')
      .andWhere('showcase.storeId IS NOT NULL');

    // Apply location filter if coordinates provided
    if (latitude && longitude) {
      const bounds = this.locationService.calculateBoundingBox(
        latitude,
        longitude,
        radiusKm ?? 25,
      );
      query = query
        .andWhere('store.latitude IS NOT NULL')
        .andWhere('store.longitude IS NOT NULL')
        .andWhere('store.latitude BETWEEN :minLat AND :maxLat', {
          minLat: bounds.minLat,
          maxLat: bounds.maxLat,
        })
        .andWhere('store.longitude BETWEEN :minLon AND :maxLon', {
          minLon: bounds.minLon,
          maxLon: bounds.maxLon,
        });
    }

    // Apply city/country filter
    if (city) {
      query = query.andWhere('store.city = :city', { city });
    }
    if (country) {
      query = query.andWhere('store.country = :country', { country });
    }

    // Apply category filter via products
    if (category) {
      query = query
        .innerJoin('store.products', 'product')
        .andWhere('product.category = :category', { category })
        .andWhere(publicVisibilitySql('product', 'product'))
        .andWhere('product.status = :productStatus', {
          productStatus: ProductStatus.ACTIVE,
        });
    }

    // Get a larger pool for algorithm mixing
    const poolSize = Math.min(limit * 5, 200);
    const rawItems = await query
      .orderBy('showcase.publishedAt', 'DESC')
      .take(poolSize)
      .getMany();

    // Enrich all items
    const enrichedItems = await this.enrichFeedItems(rawItems, viewer?.voterId);

    // Apply mixed algorithm scoring
    const scoredItems = enrichedItems.map((item) => ({
      ...item,
      _algorithmScore: this.calculateExploreScore(item, {
        latitude,
        longitude,
        userId: viewer?.voterId,
      }),
    }));

    // Sort by score and return top items
    scoredItems.sort(
      (a, b) => (b._algorithmScore ?? 0) - (a._algorithmScore ?? 0),
    );

    return scoredItems;
  }

  /**
   * Trending posts - high engagement velocity (recent likes/views)
   */
  private async getTrendingPosts(
    params: ExploreParams,
    viewer?: ResolvedViewer,
  ): Promise<FeedItem[]> {
    const { timeWindowHours = 24, limit } = params as TrendingParams &
      ExploreParams;
    const since = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);

    // Get posts with high recent engagement
    // We'll use the flushed engagement table for this
    const trendingPostIds = await this.engagementRepo
      .createQueryBuilder('engagement')
      .innerJoin('showcases', 'showcase', 'showcase.id = engagement.postId')
      .innerJoin('stores', 'store', 'store.id = showcase.storeId')
      .where('showcase.status = :status', { status: ShowcaseStatus.PUBLISHED })
      .andWhere(publicVisibilitySql('post', 'showcase'))
      .andWhere('showcase.publishedAt >= :since', { since })
      .andWhere('showcase.storeId IS NOT NULL')
      .orderBy('(engagement.likesCount + engagement.viewsCount * 0.1)', 'DESC')
      .take(Math.min(limit * 3, 100))
      .select('showcase.id')
      .getRawMany();

    const postIds = trendingPostIds.map((t) => t.showcase_id);

    if (postIds.length === 0) return [];

    const items = await this.showcases
      .createQueryBuilder('showcase')
      .innerJoinAndSelect('showcase.store', 'store')
      .where('showcase.id IN (:...postIds)', { postIds })
      .andWhere(publicVisibilitySql('post', 'showcase'))
      .andWhere('showcase.status = :visibleStatus', {
        visibleStatus: ShowcaseStatus.PUBLISHED,
      })
      .getMany();

    const enriched = await this.enrichFeedItems(items, viewer?.voterId);
    return enriched.map((item) => ({
      ...item,
      _algorithmScore: this.calculateTrendingScore(item),
    }));
  }

  /**
   * Popular posts - all-time high engagement
   */
  private async getPopularPosts(
    params: ExploreParams,
    viewer?: ResolvedViewer,
  ): Promise<FeedItem[]> {
    const { limit } = params;

    const popularPostIds = await this.engagementRepo
      .createQueryBuilder('engagement')
      .innerJoin('showcases', 'showcase', 'showcase.id = engagement.postId')
      .innerJoin('stores', 'store', 'store.id = showcase.storeId')
      .where('showcase.status = :status', { status: ShowcaseStatus.PUBLISHED })
      .andWhere(publicVisibilitySql('post', 'showcase'))
      .andWhere('showcase.storeId IS NOT NULL')
      .orderBy('engagement.likesCount', 'DESC')
      .addOrderBy('engagement.viewsCount', 'DESC')
      .take(Math.min(limit * 3, 100))
      .select('showcase.id')
      .getRawMany();

    const postIds = popularPostIds.map((p) => p.showcase_id);

    if (postIds.length === 0) return [];

    const items = await this.showcases
      .createQueryBuilder('showcase')
      .innerJoinAndSelect('showcase.store', 'store')
      .where('showcase.id IN (:...postIds)', { postIds })
      .andWhere(publicVisibilitySql('post', 'showcase'))
      .andWhere('showcase.status = :visibleStatus', {
        visibleStatus: ShowcaseStatus.PUBLISHED,
      })
      .getMany();

    const enriched = await this.enrichFeedItems(items, viewer?.voterId);
    return enriched.map((item) => ({
      ...item,
      _algorithmScore: this.calculatePopularityScore(item),
    }));
  }

  /**
   * Recent posts - newest first
   */
  private async getRecentPosts(
    params: ExploreParams,
    viewer?: ResolvedViewer,
  ): Promise<FeedItem[]> {
    const { limit, latitude, longitude, radiusKm, city, country, category } =
      params;

    let query = this.showcases
      .createQueryBuilder('showcase')
      .innerJoinAndSelect('showcase.store', 'store')
      .where('showcase.status = :status', { status: ShowcaseStatus.PUBLISHED })
      .andWhere(publicVisibilitySql('post', 'showcase'))
      .andWhere('showcase.publishedAt IS NOT NULL')
      .andWhere('showcase.storeId IS NOT NULL');

    if (latitude && longitude) {
      const bounds = this.locationService.calculateBoundingBox(
        latitude,
        longitude,
        radiusKm ?? 25,
      );
      query = query
        .andWhere('store.latitude IS NOT NULL')
        .andWhere('store.longitude IS NOT NULL')
        .andWhere('store.latitude BETWEEN :minLat AND :maxLat', {
          minLat: bounds.minLat,
          maxLat: bounds.maxLat,
        })
        .andWhere('store.longitude BETWEEN :minLon AND :maxLon', {
          minLon: bounds.minLon,
          maxLon: bounds.maxLon,
        });
    }

    if (city) query = query.andWhere('store.city = :city', { city });
    if (country)
      query = query.andWhere('store.country = :country', { country });
    if (category) {
      query = query
        .innerJoin('store.products', 'product')
        .andWhere('product.category = :category', { category })
        .andWhere(publicVisibilitySql('product', 'product'))
        .andWhere('product.status = :productStatus', {
          productStatus: ProductStatus.ACTIVE,
        });
    }

    const items = await query
      .orderBy('showcase.publishedAt', 'DESC')
      .take(Math.min(limit * 3, 100))
      .getMany();

    const enriched = await this.enrichFeedItems(items, viewer?.voterId);
    return enriched.map((item) => ({
      ...item,
      _algorithmScore: this.calculateRecencyScore(item),
    }));
  }

  /**
   * Nearby posts - location-based
   */
  private async getNearbyPosts(
    params: ExploreParams,
    viewer?: ResolvedViewer,
  ): Promise<FeedItem[]> {
    const { latitude, longitude, radiusKm = 10, limit } = params;

    if (!latitude || !longitude) {
      return [];
    }

    const bounds = this.locationService.calculateBoundingBox(
      latitude,
      longitude,
      radiusKm,
    );

    const items = await this.showcases
      .createQueryBuilder('showcase')
      .innerJoinAndSelect('showcase.store', 'store')
      .where('showcase.status = :status', { status: ShowcaseStatus.PUBLISHED })
      .andWhere(publicVisibilitySql('post', 'showcase'))
      .andWhere('showcase.publishedAt IS NOT NULL')
      .andWhere('store.latitude IS NOT NULL')
      .andWhere('store.longitude IS NOT NULL')
      .andWhere('store.latitude BETWEEN :minLat AND :maxLat', {
        minLat: bounds.minLat,
        maxLat: bounds.maxLat,
      })
      .andWhere('store.longitude BETWEEN :minLon AND :maxLon', {
        minLon: bounds.minLon,
        maxLon: bounds.maxLon,
      })
      .orderBy('showcase.publishedAt', 'DESC')
      .take(Math.min(limit * 3, 100))
      .getMany();

    const enriched = await this.enrichFeedItems(items, viewer?.voterId);
    return enriched.map((item) => ({
      ...item,
      _algorithmScore: this.calculateNearbyScore(item, latitude, longitude),
    }));
  }

  // ============================================
  // ALGORITHM SCORING FUNCTIONS
  // ============================================

  /**
   * Mixed explore score - combines multiple signals
   */
  private calculateExploreScore(
    item: FeedItem,
    context: { latitude?: number; longitude?: number; userId?: string },
  ): number {
    let score = 0;

    // Recency score (0-40 points)
    const hoursSincePublish = item.publishedAt
      ? (Date.now() - new Date(item.publishedAt).getTime()) / (1000 * 60 * 60)
      : 0;
    score += Math.max(0, 40 - hoursSincePublish * 1.5);

    // Engagement score (0-35 points)
    const engagementRate =
      item.engagement.views > 0
        ? item.engagement.likes / item.engagement.views
        : 0;
    score += Math.min(35, engagementRate * 100 + item.engagement.likes * 2);

    // Media richness (0-10 points)
    if (item.media.length > 0) {
      const hasVideo = item.media.some((m) => m.kind === MediaKind.VIDEO);
      score += hasVideo ? 10 : 5;
      if (item.media.length > 1) score += 5; // Carousel bonus
    }

    // Store quality (0-10 points)
    if (item.store) {
      if (item.store.brandColor) score += 2;
      if (item.store.logoKey) score += 3;
      if (item.store.location?.latitude) score += 5; // Has location
    }

    // Distance bonus for nearby (0-15 points)
    if (
      context.latitude &&
      context.longitude &&
      item.store?.location?.latitude &&
      item.store?.location?.longitude
    ) {
      const distance = this.locationService.calculateDistance(
        context.latitude,
        context.longitude,
        item.store.location.latitude,
        item.store.location.longitude,
      );
      score += Math.max(0, 15 - distance);
    }

    return Math.round(score * 100) / 100;
  }

  /**
   * Trending score - engagement velocity
   */
  private calculateTrendingScore(item: FeedItem): number {
    const hoursSincePublish = item.publishedAt
      ? (Date.now() - new Date(item.publishedAt).getTime()) / (1000 * 60 * 60)
      : 0;

    if (hoursSincePublish > 72) return 0; // Not trending if older than 3 days

    // Velocity = engagement / time
    const velocity =
      (item.engagement.likes + item.engagement.views * 0.05) /
      Math.max(1, hoursSincePublish);

    return Math.round(velocity * 1000) / 1000;
  }

  /**
   * Popularity score - all-time engagement
   */
  private calculatePopularityScore(item: FeedItem): number {
    return item.engagement.likes * 2 + item.engagement.views * 0.1;
  }

  /**
   * Recency score - newest first
   */
  private calculateRecencyScore(item: FeedItem): number {
    const hoursSincePublish = item.publishedAt
      ? (Date.now() - new Date(item.publishedAt).getTime()) / (1000 * 60 * 60)
      : 999999;
    return Math.max(0, 1000 - hoursSincePublish);
  }

  /**
   * Nearby score - distance-based
   */
  private calculateNearbyScore(
    item: FeedItem,
    lat: number,
    lon: number,
  ): number {
    if (!item.store?.location?.latitude || !item.store?.location?.longitude) {
      return 0;
    }

    const distance = this.locationService.calculateDistance(
      lat,
      lon,
      item.store.location.latitude,
      item.store.location.longitude,
    );

    // Recency factor
    const hoursSincePublish = item.publishedAt
      ? (Date.now() - new Date(item.publishedAt).getTime()) / (1000 * 60 * 60)
      : 999999;

    return (
      Math.round((100 - distance * 2 + (100 - hoursSincePublish)) * 100) / 100
    );
  }

  // ============================================
  // FEED RANKING
  // ============================================

  /**
   * Feed ranking for personalized feed
   */
  private rankFeedItems(items: FeedItem[], algorithm: string): FeedItem[] {
    return items
      .map((item) => ({
        ...item,
        _algorithmScore: this.calculateFeedRank(item, algorithm),
      }))
      .sort((a, b) => (b._algorithmScore ?? 0) - (a._algorithmScore ?? 0));
  }

  private calculateFeedRank(item: FeedItem, algorithm: string): number {
    let score = 0;

    // Recency (stronger for feed)
    const hoursSincePublish = item.publishedAt
      ? (Date.now() - new Date(item.publishedAt).getTime()) / (1000 * 60 * 60)
      : 0;
    score += Math.max(0, 50 - hoursSincePublish * 2);

    // Engagement
    score += item.engagement.likes * 3;
    score += item.engagement.views * 0.2;

    // Media bonus
    if (item.media.length > 0) {
      score += item.media.some((m) => m.kind === MediaKind.VIDEO) ? 15 : 10;
    }

    return Math.round(score * 100) / 100;
  }

  // ============================================
  // ENRICHMENT HELPERS
  // ============================================

  /**
   * Enrich showcase items with media and engagement data
   */
  private async enrichFeedItems(
    showcases: Showcase[],
    viewerId?: string,
  ): Promise<FeedItem[]> {
    if (showcases.length === 0) return [];

    const showcaseIds = showcases.map((s) => s.id);
    const storeIds = [
      ...new Set(showcases.map((s) => s.storeId).filter(Boolean)),
    ] as string[];

    // Fetch media assets for all showcases
    const mediaAssets = await this.mediaAssets.find({
      where: {
        showcaseId: In(showcaseIds),
        status: MediaStatus.READY,
        ...publicWhere('media'),
      },
      order: { position: 'ASC' },
    });

    // Fetch engagement data
    const engagementData = await this.engagementRepo.findBy({
      postId: In(showcaseIds),
    });

    // Fetch stores
    const stores =
      storeIds.length > 0
        ? await this.stores.findBy({
            id: In(storeIds),
            ...publicWhere('store'),
          })
        : [];
    const storeMap = new Map(stores.map((s) => [s.id, s]));

    // Group media by showcase
    const mediaByShowcase = new Map<string, MediaAsset[]>();
    for (const asset of mediaAssets) {
      if (!asset.showcaseId) continue;
      const arr = mediaByShowcase.get(asset.showcaseId) || [];
      arr.push(asset);
      mediaByShowcase.set(asset.showcaseId, arr);
    }

    // Group engagement by post
    const engagementMap = new Map(engagementData.map((e) => [e.postId, e]));

    // Build enriched items
    const viewer = viewerId
      ? { voterId: viewerId, voterType: 'user' as const }
      : undefined;

    const items: FeedItem[] = [];
    for (const showcase of showcases) {
      const media = await this.buildMediaUrls(
        mediaByShowcase.get(showcase.id) || [],
      );

      const engagement = engagementMap.get(showcase.id);
      const likes = engagement?.likesCount ?? 0;
      const views = engagement?.viewsCount ?? 0;

      let viewerLiked = false;
      if (viewer) {
        try {
          const engagementResult = await this.engagementService.getEngagement(
            showcase.id,
            viewer,
          );
          viewerLiked = engagementResult.viewerLiked;
        } catch {
          viewerLiked = false;
        }
      }

      const store = showcase.storeId ? storeMap.get(showcase.storeId) : null;

      items.push({
        id: showcase.id,
        slug: showcase.slug,
        title: showcase.title,
        description: showcase.description,
        status: showcase.status,
        publishedAt: showcase.publishedAt,
        createdAt: showcase.createdAt,
        updatedAt: showcase.updatedAt,
        ownerId: showcase.ownerId,
        storeId: showcase.storeId,
        store: store
          ? {
              id: store.id,
              name: store.name,
              slug: store.slug,
              logoKey: store.logoKey,
              brandColor: store.brandColor,
              location: {
                city: store.city,
                country: store.country,
                latitude: store.latitude,
                longitude: store.longitude,
              },
            }
          : undefined,
        media,
        engagement: { likes, views, viewerLiked },
      });
    }

    return items;
  }

  /**
   * Build media URLs with variants
   */
  private async buildMediaUrls(assets: MediaAsset[]): Promise<FeedMediaItem[]> {
    const items: FeedMediaItem[] = [];

    for (const asset of assets) {
      // Get variants for this asset using the repository - use getRawMany for proper typing
      const variants = await this.mediaAssets.manager
        .getRepository(MediaVariant)
        .createQueryBuilder('variant')
        .where('variant.assetId = :assetId', { assetId: asset.id })
        .select('variant.label', 'label')
        .addSelect('variant.storageKey', 'storageKey')
        .addSelect('variant.mimeType', 'mimeType')
        .addSelect('variant.width', 'width')
        .addSelect('variant.height', 'height')
        .getRawMany<{
          label: string;
          storageKey: string;
          mimeType: string;
          width: number | null;
          height: number | null;
        }>();

      // Build variant URLs in parallel
      const variantUrls = await Promise.all(
        variants.map(async (v) => ({
          label: v.label,
          url: await this.getMediaUrl(v.storageKey),
          width: v.width ?? 0,
          height: v.height ?? 0,
          mimeType: v.mimeType,
        })),
      );

      // Find primary variant (prefer webp/avif for images, mp4 for videos)
      const primaryVariant = this.selectPrimaryVariant(
        variants.map((v) => ({
          label: v.label,
          storageKey: v.storageKey,
          mimeType: v.mimeType,
        })),
        asset.kind,
      );
      const primaryUrl = primaryVariant
        ? await this.getMediaUrl(primaryVariant.storageKey)
        : (variantUrls[0]?.url ?? '');

      // Find poster for videos
      let posterUrl: string | null = null;
      if (asset.kind === MediaKind.VIDEO) {
        const posterVariant = variants.find((v) =>
          v.label.startsWith('poster'),
        );
        if (posterVariant) {
          posterUrl = await this.getMediaUrl(posterVariant.storageKey);
        }
      }

      items.push({
        id: asset.id,
        kind: asset.kind,
        mimeType: asset.mimeType,
        width: asset.width ?? 0,
        height: asset.height ?? 0,
        durationMs: asset.durationMs,
        variants: variantUrls,
        primaryUrl,
        posterUrl,
      });
    }

    return items;
  }

  /**
   * Select the best variant for feed display
   */
  private selectPrimaryVariant(
    variants: { label: string; storageKey: string; mimeType: string }[],
    kind: MediaKind,
  ): { storageKey: string; mimeType: string } | null {
    if (kind === MediaKind.IMAGE) {
      // Prefer AVIF > WebP > JPEG, at reasonable size (~480-1080w)
      const avif = variants.find((v) => v.label.startsWith('avif-'));
      if (avif) return { storageKey: avif.storageKey, mimeType: avif.mimeType };

      const webp = variants.find((v) => v.label.startsWith('webp-'));
      if (webp) return { storageKey: webp.storageKey, mimeType: webp.mimeType };

      const jpeg = variants.find((v) => v.label.startsWith('jpeg-'));
      if (jpeg) return { storageKey: jpeg.storageKey, mimeType: jpeg.mimeType };
    } else {
      // Video: prefer mp4-720
      const mp4 = variants.find((v) => v.label.startsWith('mp4-'));
      if (mp4) return { storageKey: mp4.storageKey, mimeType: mp4.mimeType };
    }
    return variants[0] || null;
  }

  /**
   * Get media URL (presigned for S3, direct for local)
   */
  private async getMediaUrl(storageKey: string): Promise<string> {
    try {
      const url = await this.storage.presignedGetUrl(storageKey);
      return url;
    } catch {
      // Fallback for local storage
      return `/api/v1/uploads/${encodeURIComponent(storageKey)}`;
    }
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Paginate items array with cursor support
   */
  private paginateItems(
    items: FeedItem[],
    limit: number,
    cursor?: string,
  ): { items: FeedItem[]; hasMore: boolean; nextCursor?: string } {
    let startIndex = 0;

    if (cursor) {
      const cursorIndex = items.findIndex(
        (item) =>
          item.publishedAt?.toISOString() === cursor || item.id === cursor,
      );
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }

    const pageItems = items.slice(startIndex, startIndex + limit + 1);
    const hasMore = pageItems.length > limit;
    const displayItems = hasMore ? pageItems.slice(0, limit) : pageItems;
    const lastItem =
      displayItems.length > 0
        ? displayItems[displayItems.length - 1]
        : undefined;
    const nextCursor =
      hasMore && lastItem
        ? lastItem.publishedAt?.toISOString() || lastItem.id
        : undefined;

    return { items: displayItems, hasMore, nextCursor };
  }

  /**
   * Get categories with post counts for explore filters
   */
  async getExploreCategories(): Promise<
    { category: string; label: string; count: number }[]
  > {
    const result = await this.products
      .createQueryBuilder('product')
      .innerJoin('showcases', 'showcase', 'showcase.storeId = product.storeId')
      .where('product.status = :status', { status: ProductStatus.ACTIVE })
      .andWhere(publicVisibilitySql('product', 'product'))
      .andWhere(publicVisibilitySql('post', 'showcase'))
      .andWhere('showcase.status = :showcaseStatus', {
        showcaseStatus: ShowcaseStatus.PUBLISHED,
      })
      .select('product.category', 'category')
      .addSelect('COUNT(DISTINCT showcase.id)', 'count')
      .groupBy('product.category')
      .orderBy('count', 'DESC')
      .getRawMany();

    const categoryLabels: Record<string, string> = {
      food: 'Food & Dining',
      beverage: 'Beverages',
      merchandise: 'Merchandise',
      service: 'Services',
      other: 'Other',
    };

    return result.map((r) => ({
      category: r.category,
      label: categoryLabels[r.category] || r.category,
      count: parseInt(r.count, 10),
    }));
  }

  /**
   * Get cities with post counts for explore filters
   */
  async getExploreCities(country?: string): Promise<
    {
      city: string;
      country: string;
      count: number;
      latitude?: number;
      longitude?: number;
    }[]
  > {
    let query = this.showcases
      .createQueryBuilder('showcase')
      .innerJoin('stores', 'store', 'store.id = showcase.storeId')
      .where('showcase.status = :status', { status: ShowcaseStatus.PUBLISHED })
      .andWhere(publicVisibilitySql('post', 'showcase'))
      .andWhere('store.city IS NOT NULL')
      .andWhere('store.country IS NOT NULL');

    if (country) {
      query = query.andWhere('store.country = :country', { country });
    }

    const result = await query
      .select('store.city', 'city')
      .addSelect('store.country', 'country')
      .addSelect('COUNT(*)', 'count')
      .addSelect('store.latitude', 'latitude')
      .addSelect('store.longitude', 'longitude')
      .groupBy('store.city, store.country, store.latitude, store.longitude')
      .orderBy('count', 'DESC')
      .limit(50)
      .getRawMany();

    return result.map((r) => ({
      city: r.city,
      country: r.country,
      count: parseInt(r.count, 10),
      latitude: r.latitude ? parseFloat(r.latitude) : undefined,
      longitude: r.longitude ? parseFloat(r.longitude) : undefined,
    }));
  }

  // ============================================
  // STORE-SPECIFIC FEED
  // ============================================

  /**
   * Get feed for a specific store
   */
  async getStoreFeed(
    params: StoreFeedParams,
    viewer?: ResolvedViewer,
  ): Promise<FeedResponse> {
    const { storeSlug, limit, cursor } = params;

    // Find store by slug
    const store = await this.stores.findOne({
      where: { slug: storeSlug, ...publicWhere('store') },
      select: ['id'],
    });

    if (!store) {
      return {
        items: [],
        total: 0,
        hasMore: false,
        nextCursor: undefined,
        algorithm: 'store',
      };
    }

    // Build query for this store's showcases
    let query = this.showcases
      .createQueryBuilder('showcase')
      .innerJoinAndSelect('showcase.store', 'store')
      .where('showcase.status = :status', { status: ShowcaseStatus.PUBLISHED })
      .andWhere(publicVisibilitySql('post', 'showcase'))
      .andWhere('showcase.publishedAt IS NOT NULL')
      .andWhere('showcase.storeId = :storeId', { storeId: store.id })
      .orderBy('showcase.publishedAt', 'DESC')
      .addOrderBy('showcase.createdAt', 'DESC');

    // Cursor-based pagination
    if (cursor) {
      const cursorDate = new Date(cursor);
      query = query.andWhere('showcase.publishedAt < :cursorDate', {
        cursorDate,
      });
    }

    query = query.take(limit + 1);

    const items = await query.getMany();

    const hasMore = items.length > limit;
    const displayItems = hasMore ? items.slice(0, limit) : items;
    const lastItem =
      displayItems.length > 0
        ? displayItems[displayItems.length - 1]
        : undefined;
    const nextCursor =
      hasMore && lastItem?.publishedAt
        ? lastItem.publishedAt.toISOString()
        : undefined;

    // Enrich with media and engagement
    const enrichedItems = await this.enrichFeedItems(
      displayItems,
      viewer?.voterId,
    );

    // Apply store-specific ranking (recency + engagement)
    const rankedItems = enrichedItems.map((item) => ({
      ...item,
      _algorithmScore: this.calculateStoreFeedScore(item),
    }));

    rankedItems.sort(
      (a, b) => (b._algorithmScore ?? 0) - (a._algorithmScore ?? 0),
    );

    return {
      items: rankedItems,
      total: rankedItems.length,
      hasMore,
      nextCursor,
      algorithm: 'store',
    };
  }

  /**
   * Store feed score - recency + engagement
   */
  private calculateStoreFeedScore(item: FeedItem): number {
    let score = 0;

    // Recency (strong weight for store feed)
    const hoursSincePublish = item.publishedAt
      ? (Date.now() - new Date(item.publishedAt).getTime()) / (1000 * 60 * 60)
      : 0;
    score += Math.max(0, 60 - hoursSincePublish * 3);

    // Engagement
    score += item.engagement.likes * 4;
    score += item.engagement.views * 0.3;

    // Media bonus
    if (item.media.length > 0) {
      score += item.media.some((m) => m.kind === MediaKind.VIDEO) ? 20 : 15;
    }

    return Math.round(score * 100) / 100;
  }
}
