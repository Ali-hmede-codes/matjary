import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  In,
  type ObjectLiteral,
  type SelectQueryBuilder,
} from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  Showcase,
  ShowcaseStatus,
  Store,
  StoreCategory,
  Product,
  MediaAsset,
  MediaKind,
  MediaStatus,
  PostEngagement,
  PostLike,
  MediaVariant,
  isPublicProductStatus,
  publicWhere,
  publicVisibilitySql,
  BUSINESS_CATEGORIES,
  businessCategoryDefinition,
  businessCategoryGroupLabel,
  businessCategoryLabel,
  isBusinessCategory,
} from '@app/database';
import { ResolvedViewer } from '../engagement/post-engagement.service';
import { LocationService } from '../../stores/services/location.service';
import { MediaService } from '../media.service';
import { StorageService } from '@app/storage';
import { RedisService } from '@app/queue';
import {
  readEngagementMany,
  type EngagementState,
} from '@app/queue/engagement-buffer';
import {
  diversifyByStore,
  exploreScore,
  nearbyScore,
  popularityScore,
  recencyScore,
  storeFeedScore,
  trendingScore,
} from './feed-ranking';

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
    businessCategory: string;
    businessCategoryLabel: string;
    location?: {
      city: string | null;
      country: string | null;
      latitude: number | null;
      longitude: number | null;
    };
  };
  media: FeedMediaItem[];
  // Shoppable post target, resolved only when it is still publicly visible.
  link?: FeedPostLink;
  engagement: {
    likes: number;
    views: number;
    viewerLiked: boolean;
  };
  // Algorithm score for debugging/ordering
  _algorithmScore?: number;
}

export interface FeedPostLink {
  type: 'product' | 'category';
  name: string;
  // Products are addressed by slug; categories by their derived slug.
  slug: string | null;
  priceCents: string | null;
  currency: string | null;
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

export interface ExploreCategoryFacet {
  slug: string;
  label: string;
  group: string;
  groupLabel: string;
  count: number;
}

export interface ExploreParams {
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  // One or more business-category slugs (restaurant, school, ...).
  categories?: string[];
  // Backwards-compatible single value; merged into categories.
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
    private readonly locationService: LocationService,
    private readonly mediaService: MediaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  // Category affinity is derived from durable likes, so a short in-process
  // cache avoids one aggregate query per feed refresh without hiding new likes
  // for long. The map is bounded to keep memory predictable.
  private readonly affinityCache = new Map<
    string,
    { expiresAt: number; value: Map<string, number> }
  >();
  private static readonly AFFINITY_TTL_MS = 5 * 60 * 1000;
  private static readonly AFFINITY_CACHE_MAX = 500;

  // Anonymous visitors all request the same first pages. A very short shared
  // cache turns a thundering herd into one ranking pass per key, and the
  // per-visitor like state is patched on the way out. Authenticated feeds skip
  // it because their ordering depends on personal affinity.
  private readonly feedCache = new Map<
    string,
    { expiresAt: number; response: FeedResponse }
  >();
  private readonly feedInflight = new Map<string, Promise<FeedResponse>>();
  private static readonly FEED_CACHE_TTL_MS = 20 * 1000;
  private static readonly FEED_CACHE_MAX = 40;

  // Explore filters change rarely and every visitor asks for them on load.
  private categoriesCache:
    { expiresAt: number; value: ExploreCategoryFacet[] } | undefined;
  private static readonly CATEGORIES_TTL_MS = 60 * 1000;

  private normalizedCategories(params: ExploreParams): string[] {
    const values = [
      ...(params.categories ?? []),
      ...(params.category ? [params.category] : []),
    ];
    return [
      ...new Set(
        values
          .map((value) => value.trim().toLowerCase())
          .filter((value) => isBusinessCategory(value)),
      ),
    ].slice(0, 12);
  }

  private applyStoreScope<T extends ObjectLiteral>(
    query: SelectQueryBuilder<T>,
    params: ExploreParams,
    alias = 'store',
  ): SelectQueryBuilder<T> {
    const categories = this.normalizedCategories(params);
    if (categories.length > 0) {
      query.andWhere(`${alias}.business_category IN (:...businessCategories)`, {
        businessCategories: categories,
      });
    }
    if (params.city)
      query.andWhere(`${alias}.city = :city`, { city: params.city });
    if (params.country) {
      query.andWhere(`${alias}.country = :country`, {
        country: params.country,
      });
    }
    return query;
  }

  /**
   * Stores whose categories the viewer has liked, plus their own shop
   * categories. This is the only personal signal used by "For you": enough
   * to feel familiar without pretending to be a large recommendation engine.
   */
  private async getCategoryAffinity(
    viewer?: ResolvedViewer,
  ): Promise<Map<string, number>> {
    if (!viewer) return new Map();
    const key = `${viewer.voterType}:${viewer.voterId}`;
    const cached = this.affinityCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const affinity = new Map<string, number>();
    try {
      const rows = await this.engagementRepo.manager
        .createQueryBuilder()
        .select('store.business_category', 'category')
        .addSelect('COUNT(*)', 'count')
        .from('post_likes', 'pl')
        .innerJoin('showcases', 'showcase', 'showcase.id = pl.post_id')
        .innerJoin('stores', 'store', 'store.id = showcase.store_id')
        .where('pl.voter_id = :voterId', { voterId: viewer.voterId })
        .andWhere('pl.voter_type = :voterType', {
          voterType: viewer.voterType,
        })
        .andWhere('store.business_category IS NOT NULL')
        .groupBy('store.business_category')
        .getRawMany<{ category: string; count: string }>();
      for (const row of rows) {
        const count = Number.parseInt(row.count, 10);
        if (row.category && Number.isFinite(count)) {
          affinity.set(row.category, count);
        }
      }
    } catch {
      // A personalization failure must never break the public feed.
    }

    if (viewer.voterType === 'user') {
      try {
        const ownStores = await this.stores.find({
          where: { ownerId: viewer.voterId },
          select: ['businessCategory'],
        });
        for (const store of ownStores) {
          if (!store.businessCategory) continue;
          affinity.set(
            store.businessCategory,
            (affinity.get(store.businessCategory) ?? 0) + 3,
          );
        }
      } catch {
        // Own-shop affinity is optional.
      }
    }

    if (this.affinityCache.size >= FeedExploreService.AFFINITY_CACHE_MAX) {
      const oldest = this.affinityCache.keys().next().value;
      if (oldest) this.affinityCache.delete(oldest);
    }
    this.affinityCache.set(key, {
      expiresAt: Date.now() + FeedExploreService.AFFINITY_TTL_MS,
      value: affinity,
    });
    return affinity;
  }

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
      const enrichedItems = await this.enrichFeedItems(displayItems, {
        voterId: userId,
        voterType: 'user',
      });

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
    const { limit = 20, cursor, algorithm = 'mixed' } = params;
    const normalized: ExploreParams = {
      ...params,
      categories: this.normalizedCategories(params),
    };

    // Visitors share one ranked page; owners keep their personalised ordering.
    const cacheable = viewer?.voterType === 'visitor';
    const key = cacheable ? this.feedCacheKey(normalized, limit, cursor) : '';
    if (cacheable) {
      const cached = this.feedCache.get(key);
      if (cached && cached.expiresAt > Date.now())
        return this.patchViewerLikes(cached.response, viewer);
      const pending = this.feedInflight.get(key);
      if (pending) return this.patchViewerLikes(await pending, viewer);
    }

    const work = this.computeExploreFeed(normalized, viewer, limit, cursor);
    if (!cacheable) return work;
    // Single flight: the first visitor computes, everyone waiting shares it.
    this.feedInflight.set(key, work);
    try {
      const response = await work;
      this.storeFeedCache(key, response);
      return response;
    } finally {
      this.feedInflight.delete(key);
    }
  }

  private async computeExploreFeed(
    normalized: ExploreParams,
    viewer: ResolvedViewer | undefined,
    limit: number,
    cursor: string | undefined,
  ): Promise<FeedResponse> {
    const algorithm = normalized.algorithm ?? 'mixed';
    let items: FeedItem[] = [];

    switch (algorithm) {
      case 'trending':
        items = await this.getTrendingPosts(normalized, viewer);
        break;
      case 'popular':
        items = await this.getPopularPosts(normalized, viewer);
        break;
      case 'recent':
        items = await this.getRecentPosts(normalized, viewer);
        break;
      case 'nearby':
        items = await this.getNearbyPosts(normalized, viewer);
        break;
      case 'mixed':
      default:
        items = await this.getMixedExploreFeed(normalized, viewer);
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

  private feedCacheKey(
    params: ExploreParams,
    limit: number,
    cursor?: string,
  ): string {
    return JSON.stringify([
      params.algorithm ?? 'mixed',
      params.categories ?? [],
      params.city ?? '',
      params.country ?? '',
      // Nearby/mixed feeds depend on the coordinates, not just the radius.
      params.latitude ?? '',
      params.longitude ?? '',
      params.radiusKm ?? '',
      params.timeWindowHours ?? '',
      limit,
      cursor ?? '',
    ]);
  }

  private storeFeedCache(key: string, response: FeedResponse): void {
    // The entry is shared between visitors, so it must not carry one
    // visitor's like state; every hit is patched for its own viewer.
    const snapshot: FeedResponse = {
      ...response,
      items: response.items.map((item) => ({
        ...item,
        engagement: { ...item.engagement, viewerLiked: false },
      })),
    };
    if (this.feedCache.size >= FeedExploreService.FEED_CACHE_MAX) {
      const oldest = this.feedCache.keys().next().value;
      if (oldest) this.feedCache.delete(oldest);
    }
    this.feedCache.set(key, {
      expiresAt: Date.now() + FeedExploreService.FEED_CACHE_TTL_MS,
      response: snapshot,
    });
  }

  private async patchViewerLikes(
    response: FeedResponse,
    viewer?: ResolvedViewer,
  ): Promise<FeedResponse> {
    // A freshly minted visitor id cannot have liked anything yet, so first-time
    // visitors (the bulk of a traffic spike) skip the extra lookup entirely.
    if (!viewer || viewer.newVisitorId) return response;
    const { liked } = await this.engagementSnapshot(
      response.items.map((item) => item.id),
      viewer,
    );
    return {
      ...response,
      items: response.items.map((item) => ({
        ...item,
        engagement: {
          ...item.engagement,
          viewerLiked: liked.has(item.id),
        },
      })),
    };
  }

  /**
   * Live like/view state plus the viewer's own likes, both read in a constant
   * number of round trips. Redis holds activity that has not been flushed to
   * MySQL yet; posts without a live entry fall back to the durable counters and
   * one batched `post_likes` lookup.
   */
  private async engagementSnapshot(
    postIds: string[],
    viewer?: ResolvedViewer,
  ): Promise<{ states: Map<string, EngagementState>; liked: Set<string> }> {
    let states = new Map<string, EngagementState>();
    try {
      states = await readEngagementMany(this.redis, postIds);
    } catch {
      // A personalization/Redis outage must never break the public feed.
    }
    const liked = new Set<string>();
    if (!viewer) return { states, liked };
    const unresolved: string[] = [];
    for (const postId of postIds) {
      const state = states.get(postId);
      if (!state) unresolved.push(postId);
      else if (state.likes[viewer.voterId]) liked.add(postId);
    }
    if (unresolved.length > 0) {
      try {
        const rows = await this.showcases.manager.getRepository(PostLike).find({
          where: { postId: In(unresolved), voterId: viewer.voterId },
          select: { postId: true },
        });
        for (const row of rows) liked.add(row.postId);
      } catch {
        // Losing the viewer's like state only affects the heart icon.
      }
    }
    return { states, liked };
  }

  /**
   * Mixed explore feed - combines multiple signals
   * This is the main explore page algorithm
   */
  private async getMixedExploreFeed(
    params: ExploreParams,
    viewer?: ResolvedViewer,
  ): Promise<FeedItem[]> {
    const { latitude, longitude, radiusKm = 25, limit } = params;

    // Build base query
    let query = this.showcases
      .createQueryBuilder('showcase')
      .innerJoinAndSelect('showcase.store', 'store')
      .where('showcase.status = :status', { status: ShowcaseStatus.PUBLISHED })
      .andWhere(publicVisibilitySql('post', 'showcase'))
      .andWhere('showcase.publishedAt IS NOT NULL')
      .andWhere('showcase.storeId IS NOT NULL');

    // Apply location filter if coordinates provided
    if (latitude !== undefined && longitude !== undefined) {
      const bounds = this.locationService.calculateBoundingBox(
        latitude,
        longitude,
        radiusKm,
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

    // Business-category, city and country filters.
    query = this.applyStoreScope(query, params);

    // A wider pool gives the small mixer room to balance freshness and reach.
    const poolSize = Math.min(Math.max(limit * 8, 60), 300);
    const rawItems = await query
      .orderBy('showcase.publishedAt', 'DESC')
      .take(poolSize)
      .getMany();

    // Enrich all items
    const enrichedItems = await this.enrichFeedItems(rawItems, viewer);
    const affinity = await this.getCategoryAffinity(viewer);

    // Apply mixed algorithm scoring
    const scoredItems = enrichedItems.map((item) => ({
      ...item,
      _algorithmScore: exploreScore(item, {
        latitude,
        longitude,
        affinity,
        distanceKm: (lat1, lon1, lat2, lon2) =>
          this.locationService.calculateDistance(lat1, lon1, lat2, lon2),
      }),
    }));

    // Sort by score, then break up runs from the same shop.
    scoredItems.sort(
      (a, b) => (b._algorithmScore ?? 0) - (a._algorithmScore ?? 0),
    );

    return diversifyByStore(scoredItems);
  }

  /**
   * Candidate ids ordered by durable engagement. Recent activity wins, and a
   * quiet window falls back to 7 days so Trending is not blank on a small site.
   */
  private async fetchTrendingCandidateIds(
    params: ExploreParams,
    since: Date,
    limit: number,
  ): Promise<string[]> {
    let query = this.engagementRepo
      .createQueryBuilder('engagement')
      .innerJoin('showcases', 'showcase', 'showcase.id = engagement.postId')
      .innerJoin('stores', 'store', 'store.id = showcase.storeId')
      .where('showcase.status = :status', { status: ShowcaseStatus.PUBLISHED })
      .andWhere(publicVisibilitySql('post', 'showcase'))
      .andWhere('showcase.publishedAt >= :since', { since })
      .andWhere('showcase.storeId IS NOT NULL');
    query = this.applyStoreScope(query, params);
    const rows = await query
      .orderBy('(engagement.likesCount + engagement.viewsCount * 0.1)', 'DESC')
      .take(Math.min(Math.max(limit * 3, 30), 100))
      .select('showcase.id')
      .getRawMany<{ showcase_id: string }>();
    return rows.map((row) => row.showcase_id);
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
    let fallback = false;
    const recentIds = await this.fetchTrendingCandidateIds(
      params,
      new Date(Date.now() - timeWindowHours * 60 * 60 * 1000),
      limit,
    );
    let postIds = recentIds;

    // A brand-new site can legitimately have little activity in 24 hours.
    // Topping up from the last week keeps Trending useful without replacing
    // the freshest posts, which still score higher on velocity.
    const fallbackHours = 24 * 7;
    if (recentIds.length < limit && timeWindowHours < fallbackHours) {
      fallback = true;
      const widerIds = await this.fetchTrendingCandidateIds(
        params,
        new Date(Date.now() - fallbackHours * 60 * 60 * 1000),
        limit,
      );
      postIds = [...new Set([...recentIds, ...widerIds])];
    }
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

    const enriched = await this.enrichFeedItems(items, viewer);
    const now = Date.now();
    const scored = enriched.map((item) => ({
      ...item,
      _algorithmScore: trendingScore(item, now, fallback ? fallbackHours : 72),
    }));
    scored.sort((a, b) => (b._algorithmScore ?? 0) - (a._algorithmScore ?? 0));
    return diversifyByStore(scored);
  }

  /**
   * Popular posts - all-time high engagement
   */
  private async getPopularPosts(
    params: ExploreParams,
    viewer?: ResolvedViewer,
  ): Promise<FeedItem[]> {
    const { limit } = params;

    let query = this.engagementRepo
      .createQueryBuilder('engagement')
      .innerJoin('showcases', 'showcase', 'showcase.id = engagement.postId')
      .innerJoin('stores', 'store', 'store.id = showcase.storeId')
      .where('showcase.status = :status', { status: ShowcaseStatus.PUBLISHED })
      .andWhere(publicVisibilitySql('post', 'showcase'))
      .andWhere('showcase.storeId IS NOT NULL');
    query = this.applyStoreScope(query, params);
    const popularPostIds = await query
      .orderBy('engagement.likesCount', 'DESC')
      .addOrderBy('engagement.viewsCount', 'DESC')
      .take(Math.min(limit * 3, 100))
      .select('showcase.id')
      .getRawMany<{ showcase_id: string }>();

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

    const enriched = await this.enrichFeedItems(items, viewer);
    const scored = enriched.map((item) => ({
      ...item,
      _algorithmScore: popularityScore(item),
    }));
    scored.sort((a, b) => (b._algorithmScore ?? 0) - (a._algorithmScore ?? 0));
    return diversifyByStore(scored);
  }

  /**
   * Recent posts - newest first
   */
  private async getRecentPosts(
    params: ExploreParams,
    viewer?: ResolvedViewer,
  ): Promise<FeedItem[]> {
    const { limit, latitude, longitude, radiusKm = 25 } = params;

    let query = this.showcases
      .createQueryBuilder('showcase')
      .innerJoinAndSelect('showcase.store', 'store')
      .where('showcase.status = :status', { status: ShowcaseStatus.PUBLISHED })
      .andWhere(publicVisibilitySql('post', 'showcase'))
      .andWhere('showcase.publishedAt IS NOT NULL')
      .andWhere('showcase.storeId IS NOT NULL');

    if (latitude !== undefined && longitude !== undefined) {
      const bounds = this.locationService.calculateBoundingBox(
        latitude,
        longitude,
        radiusKm,
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

    query = this.applyStoreScope(query, params);

    const items = await query
      .orderBy('showcase.publishedAt', 'DESC')
      .take(Math.min(Math.max(limit * 8, 60), 300))
      .getMany();

    const enriched = await this.enrichFeedItems(items, viewer);
    return enriched.map((item) => ({
      ...item,
      _algorithmScore: recencyScore(item),
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

    if (latitude === undefined || longitude === undefined) {
      return [];
    }

    const bounds = this.locationService.calculateBoundingBox(
      latitude,
      longitude,
      radiusKm,
    );

    let query = this.showcases
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
      });
    query = this.applyStoreScope(query, params);

    const items = await query
      .orderBy('showcase.publishedAt', 'DESC')
      .take(Math.min(Math.max(limit * 8, 60), 300))
      .getMany();

    const enriched = await this.enrichFeedItems(items, viewer);
    const now = Date.now();
    return enriched.map((item) => ({
      ...item,
      _algorithmScore: nearbyScore(
        item,
        latitude,
        longitude,
        (lat1, lon1, lat2, lon2) =>
          this.locationService.calculateDistance(lat1, lon1, lat2, lon2),
        now,
      ),
    }));
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
   * Enrich showcase items with media and engagement data.
   *
   * Every lookup here is batched: one query for media, one for variants, one
   * for durable counters, one Redis MGET and at most one `post_likes` read.
   * The previous implementation issued several queries per card, which made a
   * single feed page hundreds of round trips and collapsed under load.
   */
  private async enrichFeedItems(
    showcases: Showcase[],
    viewer?: ResolvedViewer,
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

    // All variants of the page in one query, grouped by asset.
    const assetIds = mediaAssets.map((asset) => asset.id);
    const variants = assetIds.length
      ? await this.mediaAssets.manager.getRepository(MediaVariant).find({
          where: { assetId: In(assetIds) },
          select: {
            assetId: true,
            label: true,
            storageKey: true,
            mimeType: true,
            width: true,
            height: true,
          },
        })
      : [];
    const variantsByAsset = new Map<string, MediaVariant[]>();
    for (const variant of variants) {
      const list = variantsByAsset.get(variant.assetId) ?? [];
      list.push(variant);
      variantsByAsset.set(variant.assetId, list);
    }

    // Fetch engagement data: durable counters, live Redis state and the
    // viewer's own likes, each in a single round trip.
    const [engagementData, snapshot, stores] = await Promise.all([
      this.engagementRepo.findBy({ postId: In(showcaseIds) }),
      this.engagementSnapshot(showcaseIds, viewer),
      storeIds.length > 0
        ? this.stores.findBy({
            id: In(storeIds),
            ...publicWhere('store'),
          })
        : Promise.resolve([]),
    ]);
    const storeMap = new Map(stores.map((s) => [s.id, s]));

    // Shoppable post targets, resolved in two batched lookups. A link only
    // survives when the row still belongs to the post's shop and is public.
    const productIds = [
      ...new Set(showcases.map((item) => item.linkedProductId).filter(Boolean)),
    ] as string[];
    const categoryIds = [
      ...new Set(
        showcases.map((item) => item.linkedCategoryId).filter(Boolean),
      ),
    ] as string[];
    const linkedProducts = productIds.length
      ? await this.showcases.manager.getRepository(Product).find({
          where: { id: In(productIds), ...publicWhere('product') },
        })
      : [];
    const linkedCategories = categoryIds.length
      ? await this.showcases.manager
          .getRepository(StoreCategory)
          .findBy({ id: In(categoryIds) })
      : [];
    const productMap = new Map(linkedProducts.map((p) => [p.id, p]));
    const categoryMap = new Map(linkedCategories.map((c) => [c.id, c]));

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

    const items: FeedItem[] = [];
    for (const showcase of showcases) {
      const media = await this.buildMediaUrls(
        mediaByShowcase.get(showcase.id) || [],
        variantsByAsset,
      );

      const live = snapshot.states.get(showcase.id);
      const durable = engagementMap.get(showcase.id);
      // Live state includes the durable baseline plus unflushed activity.
      const likes = live
        ? Object.keys(live.likes).length
        : (durable?.likesCount ?? 0);
      const views = live ? live.views : (durable?.viewsCount ?? 0);

      const store = showcase.storeId ? storeMap.get(showcase.storeId) : null;

      let link: FeedPostLink | undefined;
      const linkedProduct = showcase.linkedProductId
        ? productMap.get(showcase.linkedProductId)
        : undefined;
      const linkedCategory = showcase.linkedCategoryId
        ? categoryMap.get(showcase.linkedCategoryId)
        : undefined;
      if (
        linkedProduct &&
        linkedProduct.storeId === showcase.storeId &&
        isPublicProductStatus(linkedProduct.status)
      ) {
        link = {
          type: 'product',
          name: linkedProduct.name,
          slug: linkedProduct.slug,
          priceCents: linkedProduct.priceCents,
          currency: linkedProduct.currency,
        };
      } else if (
        linkedCategory &&
        linkedCategory.storeId === showcase.storeId
      ) {
        link = {
          type: 'category',
          name: linkedCategory.name,
          slug: null,
          priceCents: null,
          currency: null,
        };
      }

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
              businessCategory: businessCategoryDefinition(
                store.businessCategory,
              ).slug,
              businessCategoryLabel: businessCategoryLabel(
                store.businessCategory,
              ),
              location: {
                city: store.city,
                country: store.country,
                latitude: store.latitude,
                longitude: store.longitude,
              },
            }
          : undefined,
        media,
        ...(link ? { link } : {}),
        engagement: {
          likes,
          views,
          viewerLiked: snapshot.liked.has(showcase.id),
        },
      });
    }

    return items;
  }

  /**
   * Build media URLs with variants
   */
  private async buildMediaUrls(
    assets: MediaAsset[],
    variantsByAsset: Map<string, MediaVariant[]>,
  ): Promise<FeedMediaItem[]> {
    const items: FeedMediaItem[] = [];

    for (const asset of assets) {
      const variants = variantsByAsset.get(asset.id) ?? [];

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
      // Scored feeds use a numeric offset so pagination stays aligned with the
      // in-memory ranking. Legacy date/id cursors are still accepted.
      const offset = Number(cursor);
      if (Number.isInteger(offset) && offset >= 0) {
        startIndex = offset;
      } else {
        const cursorIndex = items.findIndex(
          (item) =>
            item.publishedAt?.toISOString() === cursor || item.id === cursor,
        );
        if (cursorIndex >= 0) startIndex = cursorIndex + 1;
      }
    }

    const pageItems = items.slice(startIndex, startIndex + limit + 1);
    const hasMore = pageItems.length > limit;
    const displayItems = hasMore ? pageItems.slice(0, limit) : pageItems;
    const nextCursor = hasMore
      ? String(startIndex + displayItems.length)
      : undefined;

    return { items: displayItems, hasMore, nextCursor };
  }

  /**
   * Get business categories that currently have public posts. Counts let the
   * filter hide empty shops types instead of showing a long dead list.
   */
  async getExploreCategories(): Promise<ExploreCategoryFacet[]> {
    if (this.categoriesCache && this.categoriesCache.expiresAt > Date.now())
      return this.categoriesCache.value;
    const value = await this.loadExploreCategories();
    this.categoriesCache = {
      expiresAt: Date.now() + FeedExploreService.CATEGORIES_TTL_MS,
      value,
    };
    return value;
  }

  private async loadExploreCategories(): Promise<ExploreCategoryFacet[]> {
    const result = await this.showcases
      .createQueryBuilder('showcase')
      .innerJoin('showcase.store', 'store')
      .where('showcase.status = :status', { status: ShowcaseStatus.PUBLISHED })
      .andWhere(publicVisibilitySql('post', 'showcase'))
      .andWhere('showcase.publishedAt IS NOT NULL')
      .select('store.business_category', 'slug')
      .addSelect('COUNT(DISTINCT showcase.id)', 'count')
      .groupBy('store.business_category')
      .getRawMany<{ slug: string; count: string }>();

    const counts = new Map(
      result.map((row) => [row.slug, Number.parseInt(row.count, 10)]),
    );

    return BUSINESS_CATEGORIES.map((category) => ({
      slug: category.slug,
      label: category.label,
      group: category.group,
      groupLabel: businessCategoryGroupLabel(category.slug),
      count: counts.get(category.slug) ?? 0,
    }))
      .filter((category) => category.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
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
    const enrichedItems = await this.enrichFeedItems(displayItems, viewer);

    // Apply store-specific ranking (recency + engagement)
    const rankedItems = enrichedItems.map((item) => ({
      ...item,
      _algorithmScore: storeFeedScore(item),
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
}
