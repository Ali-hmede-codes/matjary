import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import {
  User,
  Store,
  Showcase,
  Product,
  MediaAsset,
  UserSubscription,
  SubscriptionPlan,
  SubscriptionLimits,
  ShowcaseStatus,
  ProductStatus,
  StoreType,
  moderationWhere,
  visibilitySql,
  MEDIA_OWNER_ID,
  MEDIA_OWNER_JOINS,
} from '@app/database';
import { SubscriptionPlansService } from '../subscriptions/subscription-plans.service';
import {
  DashboardSummaryDto,
  UserStoreSummaryDto,
  UserPostSummaryDto,
  UserProductSummaryDto,
  UserSubscriptionInfoDto,
} from './dto/dashboard-response.dto';

interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

@Injectable()
export class UserDashboardService {
  private static readonly DEFAULT_LIMIT = 20;
  private static readonly MAX_LIMIT = 100;

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    @InjectRepository(Showcase)
    private readonly showcases: Repository<Showcase>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(MediaAsset)
    private readonly mediaAssets: Repository<MediaAsset>,
    @InjectRepository(UserSubscription)
    private readonly userSubscriptions: Repository<UserSubscription>,
    @InjectRepository(SubscriptionPlan)
    private readonly subscriptionPlans: Repository<SubscriptionPlan>,
    private readonly plansService: SubscriptionPlansService,
  ) {}

  private sanitize(error: unknown): never {
    throw new ServiceUnavailableException(
      'Dashboard data is temporarily unavailable',
    );
  }

  /**
   * Get complete dashboard summary for a user - optimized with batch queries
   */
  async getDashboard(userId: string): Promise<DashboardSummaryDto> {
    try {
      // 1. Get user's stores (single query)
      const userStores = await this.stores.find({
        where: { ownerId: userId, ...moderationWhere('store') },
        order: { createdAt: 'DESC' },
        select: {
          id: true,
          name: true,
          slug: true,
          brandColor: true,
          description: true,
          logoKey: true,
          bannerKey: true,
          storeType: true,
          subscriptionTier: true,
          subscriptionExpiresAt: true,
          enableCart: true,
          enableWhatsAppCheckout: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const storeIds = userStores.map((s) => s.id);

      // 2. Batch count posts per store (single query with GROUP BY)
      const postsPerStore = await this.showcases
        .createQueryBuilder('sc')
        .select('sc.storeId', 'storeId')
        .addSelect('COUNT(*)', 'total')
        .addSelect(
          "SUM(CASE WHEN sc.status = 'published' THEN 1 ELSE 0 END)",
          'published',
        )
        .where('sc.ownerId = :userId', { userId })
        .andWhere(visibilitySql('post', 'sc'))
        .groupBy('sc.storeId')
        .getRawMany();
      const postsCountMap = new Map(
        postsPerStore.map((p) => [p.storeId, parseInt(p.total, 10)]),
      );
      const publishedCountMap = new Map(
        postsPerStore.map((p) => [p.storeId, parseInt(p.published, 10)]),
      );

      // 3. Batch count products per store (single query with GROUP BY)
      const productsPerStore = await this.products
        .createQueryBuilder('p')
        .innerJoin('p.store', 'store')
        .select('p.storeId', 'storeId')
        .addSelect('COUNT(*)', 'total')
        .addSelect(
          "SUM(CASE WHEN p.status = 'active' THEN 1 ELSE 0 END)",
          'active',
        )
        .where('store.ownerId = :userId', { userId })
        .andWhere(visibilitySql('product', 'p'))
        .groupBy('p.storeId')
        .getRawMany();
      const productsCountMap = new Map(
        productsPerStore.map((p) => [p.storeId, parseInt(p.total, 10)]),
      );
      const activeProductsMap = new Map(
        productsPerStore.map((p) => [p.storeId, parseInt(p.active, 10)]),
      );

      // Count all owned media targets without double-counting product/store joins.
      const [totalMediaResult] = await this.mediaAssets.manager.query(
        `SELECT COUNT(*) AS totalMedia FROM media_assets a ${MEDIA_OWNER_JOINS} WHERE ${MEDIA_OWNER_ID} = ? AND a.status = 'ready' AND ${visibilitySql('media', 'a')}`,
        [userId],
      );
      const totalMedia = totalMediaResult?.totalMedia
        ? parseInt(totalMediaResult.totalMedia, 10)
        : 0;

      // 5. Build stores with counts
      const storesWithCounts: UserStoreSummaryDto[] = userStores.map(
        (store) => {
          const postsCount = postsCountMap.get(store.id) ?? 0;
          const publishedPosts = publishedCountMap.get(store.id) ?? 0;
          const productsCount = productsCountMap.get(store.id) ?? 0;
          const activeProducts = activeProductsMap.get(store.id) ?? 0;
          return UserStoreSummaryDto.fromEntity(
            store,
            postsCount,
            productsCount,
          );
        },
      );

      // 6. Get recent posts with BATCHED engagement & media counts (max 10 for dashboard)
      const recentPostsResult = await this.getUserPostsOptimized(userId, {
        limit: 10,
      });
      const posts = recentPostsResult.items;

      // 7. Get recent products (max 10 for dashboard)
      const recentProductsResult = await this.getUserProductsOptimized(userId, {
        limit: 10,
      });
      const products = recentProductsResult.items;

      // 8. Get subscription & limits
      const subscription =
        await this.plansService.getUserActiveSubscription(userId);
      const effectiveLimits =
        await this.plansService.getEffectiveLimits(userId);

      return {
        stores: storesWithCounts,
        posts,
        products,
        subscription: subscription
          ? UserSubscriptionInfoDto.fromSubscription(subscription)
          : null,
        limits: effectiveLimits,
        stats: {
          totalStores: userStores.length,
          totalPosts: Array.from(postsCountMap.values()).reduce(
            (a, b) => a + b,
            0,
          ),
          totalProducts: Array.from(productsCountMap.values()).reduce(
            (a, b) => a + b,
            0,
          ),
          publishedPosts: Array.from(publishedCountMap.values()).reduce(
            (a, b) => a + b,
            0,
          ),
          activeProducts: Array.from(activeProductsMap.values()).reduce(
            (a, b) => a + b,
            0,
          ),
          totalMedia,
        },
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  /**
   * Get user's stores with counts - optimized with batch queries
   */
  async getUserStores(userId: string): Promise<UserStoreSummaryDto[]> {
    try {
      const userStores = await this.stores.find({
        where: { ownerId: userId, ...moderationWhere('store') },
        order: { createdAt: 'DESC' },
        select: {
          id: true,
          name: true,
          slug: true,
          brandColor: true,
          description: true,
          logoKey: true,
          bannerKey: true,
          storeType: true,
          subscriptionTier: true,
          subscriptionExpiresAt: true,
          enableCart: true,
          enableWhatsAppCheckout: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (userStores.length === 0) return [];

      const storeIds = userStores.map((s) => s.id);

      // Batch count posts per store
      const postsPerStore = await this.showcases
        .createQueryBuilder('sc')
        .select('sc.storeId', 'storeId')
        .addSelect('COUNT(*)', 'total')
        .where('sc.storeId IN (:...ids)', { ids: storeIds })
        .andWhere(visibilitySql('post', 'sc'))
        .groupBy('sc.storeId')
        .getRawMany();
      const postsCountMap = new Map(
        postsPerStore.map((p) => [p.storeId, parseInt(p.total, 10)]),
      );

      // Batch count products per store
      const productsPerStore = await this.products
        .createQueryBuilder('p')
        .select('p.storeId', 'storeId')
        .addSelect('COUNT(*)', 'total')
        .where('p.storeId IN (:...ids)', { ids: storeIds })
        .andWhere(visibilitySql('product', 'p'))
        .groupBy('p.storeId')
        .getRawMany();
      const productsCountMap = new Map(
        productsPerStore.map((p) => [p.storeId, parseInt(p.total, 10)]),
      );

      return userStores.map((store) =>
        UserStoreSummaryDto.fromEntity(
          store,
          postsCountMap.get(store.id) ?? 0,
          productsCountMap.get(store.id) ?? 0,
        ),
      );
    } catch (error) {
      this.sanitize(error);
    }
  }

  /**
   * Get a specific store owned by the user
   */
  async getUserStore(userId: string, storeId: string): Promise<Store> {
    try {
      const store = await this.stores.findOne({
        where: { id: storeId, ownerId: userId, ...moderationWhere('store') },
        relations: ['owner'],
      });

      if (!store) {
        throw new NotFoundException('Store not found');
      }

      return store;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.sanitize(error);
    }
  }

  /**
   * Get user's posts with cursor-based pagination and BATCHED engagement/media counts
   */
  async getUserPosts(
    userId: string,
    options?: {
      status?: ShowcaseStatus;
      storeId?: string;
      limit?: number;
      offset?: number;
      cursor?: string; // "createdAt|id" for cursor pagination
    },
  ): Promise<{ posts: UserPostSummaryDto[]; total: number }> {
    const result = await this.getUserPostsOptimized(userId, options);
    return { posts: result.items, total: result.total ?? 0 };
  }

  /**
   * Internal optimized method returning PaginatedResult with cursor
   */
  private async getUserPostsOptimized(
    userId: string,
    options?: {
      status?: ShowcaseStatus;
      storeId?: string;
      limit?: number;
      offset?: number;
      cursor?: string;
    },
  ): Promise<PaginatedResult<UserPostSummaryDto>> {
    try {
      const limit = Math.min(
        options?.limit ?? UserDashboardService.DEFAULT_LIMIT,
        UserDashboardService.MAX_LIMIT,
      );
      const cursor = options?.cursor;

      // Build where clause
      const where: any = { ownerId: userId };
      if (options?.status) where.status = options.status;
      if (options?.storeId) where.storeId = options.storeId;
      if (cursor) {
        const parts = cursor.split('|');
        const dateStr = parts[0]!;
        const cursorDate = new Date(dateStr);
        // Use composite cursor for stable ordering
        where.createdAt = LessThan(cursorDate);
        // We'll handle ID tiebreaker in query builder for precision
      }

      // Use QueryBuilder for precise cursor pagination
      const qb = this.showcases
        .createQueryBuilder('sc')
        .leftJoinAndSelect('sc.store', 'store')
        .where('sc.ownerId = :userId', { userId })
        .andWhere(visibilitySql('post', 'sc'))
        .orderBy('sc.createdAt', 'DESC')
        .addOrderBy('sc.id', 'DESC')
        .limit(limit + 1); // fetch one extra to detect hasMore

      if (options?.status)
        qb.andWhere('sc.status = :status', { status: options.status });
      if (options?.storeId)
        qb.andWhere('sc.storeId = :storeId', { storeId: options.storeId });

      if (cursor) {
        const parts = cursor.split('|');
        const dateStr = parts[0]!;
        const idStr = parts[1]!;
        qb.andWhere(
          '(sc.createdAt < :cursorDate OR (sc.createdAt = :cursorDate AND sc.id < :cursorId))',
          {
            cursorDate: new Date(dateStr),
            cursorId: idStr,
          },
        );
      } else if (options?.offset && options.offset > 0) {
        qb.offset(options.offset);
      }

      const posts = await qb
        .select([
          'sc.id',
          'sc.slug',
          'sc.title',
          'sc.description',
          'sc.status',
          'sc.publishedAt',
          'sc.storeId',
          'sc.createdAt',
          'sc.updatedAt',
          'sc.mediaCount',
          'sc.likesCount',
          'sc.viewsCount',
          'store.id',
          'store.slug',
          'store.name',
        ])
        .getMany();

      const hasMore = posts.length > limit;
      if (hasMore) posts.pop();

      if (posts.length === 0) {
        const total = cursor
          ? undefined
          : await this.showcases.count({
              where: { ownerId: userId, ...moderationWhere('post') },
            });
        return { items: [], nextCursor: null, hasMore: false, total };
      }

      // Build DTOs using denormalized counters - zero additional queries needed
      const postDtos: UserPostSummaryDto[] = posts.map((post) => {
        // Use denormalized counters from the entity
        const mediaCount = (post as any).mediaCount ?? 0;
        const likesCount = (post as any).likesCount ?? 0;
        const viewsCount = (post as any).viewsCount ?? 0;
        return UserPostSummaryDto.fromEntity(
          post,
          post.store?.slug ?? null,
          post.store?.name ?? null,
          mediaCount,
          likesCount,
          viewsCount,
          false,
        );
      });

      const lastPost = posts[posts.length - 1];
      const nextCursor =
        postDtos.length > 0 && lastPost
          ? `${lastPost.createdAt.toISOString()}|${lastPost.id}`
          : null;

      // For offset pagination, also return total count
      const total = cursor
        ? undefined
        : await this.showcases.count({
            where: {
              ownerId: userId,
              ...moderationWhere('post'),
              ...(options?.status ? { status: options.status } : {}),
              ...(options?.storeId ? { storeId: options.storeId } : {}),
            },
          });

      return {
        items: postDtos,
        nextCursor,
        hasMore,
        total,
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  /**
   * Get user's products with cursor-based pagination
   */
  async getUserProducts(
    userId: string,
    options?: {
      status?: ProductStatus;
      storeId?: string;
      limit?: number;
      offset?: number;
      cursor?: string;
    },
  ): Promise<{ products: UserProductSummaryDto[]; total: number }> {
    const result = await this.getUserProductsOptimized(userId, options);
    return { products: result.items, total: result.total ?? 0 };
  }

  /**
   * Internal optimized method for products
   */
  private async getUserProductsOptimized(
    userId: string,
    options?: {
      status?: ProductStatus;
      storeId?: string;
      limit?: number;
      offset?: number;
      cursor?: string;
    },
  ): Promise<PaginatedResult<UserProductSummaryDto>> {
    try {
      const limit = Math.min(
        options?.limit ?? UserDashboardService.DEFAULT_LIMIT,
        UserDashboardService.MAX_LIMIT,
      );
      const cursor = options?.cursor;

      const qb = this.products
        .createQueryBuilder('p')
        .leftJoinAndSelect('p.store', 'store')
        .where('store.ownerId = :userId', { userId })
        .andWhere(visibilitySql('product', 'p'))
        .orderBy('p.createdAt', 'DESC')
        .addOrderBy('p.id', 'DESC')
        .limit(limit + 1);

      if (options?.status)
        qb.andWhere('p.status = :status', { status: options.status });
      if (options?.storeId)
        qb.andWhere('p.storeId = :storeId', { storeId: options.storeId });

      if (cursor) {
        const parts = cursor.split('|');
        const dateStr = parts[0]!;
        const idStr = parts[1]!;
        qb.andWhere(
          '(p.createdAt < :cursorDate OR (p.createdAt = :cursorDate AND p.id < :cursorId))',
          {
            cursorDate: new Date(dateStr),
            cursorId: idStr,
          },
        );
      } else if (options?.offset && options.offset > 0) {
        qb.offset(options.offset);
      }

      const products = await qb
        .select([
          'p.id',
          'p.slug',
          'p.name',
          'p.description',
          'p.priceCents',
          'p.currency',
          'p.category',
          'p.status',
          'p.stockQuantity',
          'p.imageKeys',
          'p.storeId',
          'p.sortOrder',
          'p.createdAt',
          'p.updatedAt',
          'store.id',
          'store.slug',
          'store.name',
        ])
        .getMany();

      const hasMore = products.length > limit;
      if (hasMore) products.pop();

      const productDtos: UserProductSummaryDto[] = products.map((p) =>
        UserProductSummaryDto.fromEntity(p, p.store?.slug ?? ''),
      );

      const lastProduct = products[products.length - 1];
      const nextCursor =
        productDtos.length > 0 && lastProduct
          ? `${lastProduct.createdAt.toISOString()}|${lastProduct.id}`
          : null;

      const total = cursor
        ? undefined
        : await this.products.count({
            where: {
              store: { ownerId: userId },
              ...moderationWhere('product'),
              ...(options?.status ? { status: options.status } : {}),
              ...(options?.storeId ? { storeId: options.storeId } : {}),
            },
          });

      return {
        items: productDtos,
        nextCursor,
        hasMore,
        total,
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  /**
   * Get media for a specific showcase (owned by user)
   */
  async getShowcaseMedia(
    userId: string,
    showcaseId: string,
  ): Promise<MediaAsset[]> {
    try {
      const showcase = await this.showcases.findOne({
        where: { id: showcaseId, ownerId: userId, ...moderationWhere('post') },
      });

      if (!showcase) {
        throw new NotFoundException('Showcase not found');
      }

      return this.mediaAssets.find({
        where: { showcaseId, ...moderationWhere('media') },
        order: { position: 'ASC' },
        take: 100,
        relations: ['variants'],
        select: {
          variants: { id: true, storageKey: true, mimeType: true, width: true },
          id: true,
          kind: true,
          status: true,
          mimeType: true,
          width: true,
          height: true,
          durationMs: true,
          altText: true,
          position: true,
          originalKey: true,
          sizeBytes: true,
          createdAt: true,
        },
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.sanitize(error);
    }
  }

  /**
   * Check if user owns a store
   */
  async checkStoreOwnership(userId: string, storeId: string): Promise<Store> {
    const store = await this.stores.findOneBy({
      id: storeId,
      ownerId: userId,
      ...moderationWhere('store'),
    });
    if (!store) {
      throw new ForbiddenException('You do not own this store');
    }
    return store;
  }

  /**
   * Check if user owns a showcase
   */
  async checkShowcaseOwnership(
    userId: string,
    showcaseId: string,
  ): Promise<Showcase> {
    const showcase = await this.showcases.findOneBy({
      id: showcaseId,
      ownerId: userId,
      ...moderationWhere('post'),
    });
    if (!showcase) {
      throw new ForbiddenException('You do not own this showcase');
    }
    return showcase;
  }

  /**
   * Check if user owns a product
   */
  async checkProductOwnership(
    userId: string,
    productId: string,
  ): Promise<Product> {
    const product = await this.products.findOne({
      where: {
        id: productId,
        store: { ownerId: userId },
        ...moderationWhere('product'),
      },
      relations: ['store'],
    });
    if (!product) {
      throw new ForbiddenException('You do not own this product');
    }
    return product;
  }
}
