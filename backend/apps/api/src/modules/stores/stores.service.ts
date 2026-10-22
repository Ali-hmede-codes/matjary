import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
  BadRequestException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import {
  Store,
  StoreSubscriptionTier,
  StoreType,
  Product,
  ProductStatus,
  SubscriptionPlan,
  User,
  effectiveLimits,
  effectiveSubscription,
  assertQuota,
} from '@app/database';
import { CreateStoreDto, CreateStoreLocationDto } from './dto/create-store.dto';
import { UpdateStoreDto, UpdateStoreLocationDto } from './dto/update-store.dto';
import { StoreResponseDto, toStoreResponseDto } from './dto/store-response.dto';
import {
  LocationService,
  LocationValidationResult,
} from './services/location.service';
import { SeoService } from '../seo/seo.service';
import { AdminGuard } from '../auth/guards/auth.guards';

@Injectable()
export class StoresService {
  private readonly logger = new Logger(StoresService.name);

  constructor(
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(SubscriptionPlan)
    private readonly plans: Repository<SubscriptionPlan>,
    private readonly locationService: LocationService,
    private readonly seoService: SeoService,
    private readonly admin: AdminGuard,
  ) {}

  private sanitize(error: unknown): never {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(
      'Store storage is temporarily unavailable',
    );
  }

  async findAll(
    ownerId: string | undefined,
    limit: number,
    offset: number,
  ): Promise<{ items: StoreResponseDto[]; total: number }> {
    try {
      const where: Record<string, unknown> = {};

      const [items, total] = await this.stores.findAndCount({
        where,
        order: { createdAt: 'DESC' },
        take: limit,
        skip: offset,
      });

      // Get counts for each store
      const storeIds = items.map((s) => s.id);
      const [postsCounts, productsCounts] = await Promise.all([
        this.getPostsCounts(storeIds),
        this.getProductsCounts(storeIds),
      ]);

      return {
        items: items.map((item, index) =>
          toStoreResponseDto(
            item,
            !!ownerId && ownerId === item.ownerId,
            postsCounts[item.id],
            productsCounts[item.id],
          ),
        ),
        total,
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  async findOneBySlug(
    slug: string,
    userId: string | undefined,
  ): Promise<StoreResponseDto> {
    try {
      const store = await this.stores.findOneBy({ slug });
      if (!store) {
        throw new NotFoundException('Store not found');
      }

      const isOwner = userId === store.ownerId;
      const [postsCount, productsCount] = await Promise.all([
        this.getPostsCount(store.id),
        this.getProductsCount(store.id),
      ]);

      return toStoreResponseDto(store, isOwner, postsCount, productsCount);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  async findOneById(
    id: string,
    userId: string | undefined,
  ): Promise<StoreResponseDto> {
    try {
      const store = await this.stores.findOneBy({ id });
      if (!store) {
        throw new NotFoundException('Store not found');
      }

      const isOwner = userId === store.ownerId;
      const [postsCount, productsCount] = await Promise.all([
        this.getPostsCount(store.id),
        this.getProductsCount(store.id),
      ]);

      return toStoreResponseDto(store, isOwner, postsCount, productsCount);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  async findStoreEntityBySlug(slug: string): Promise<Store | null> {
    try {
      return await this.stores.findOneBy({ slug });
    } catch (error) {
      this.sanitize(error);
    }
  }

  async create(
    dto: CreateStoreDto,
    ownerId: string,
  ): Promise<StoreResponseDto> {
    try {
      const existing = await this.stores.findOneBy({ slug: dto.slug });
      if (existing) {
        throw new ConflictException('A store with this slug already exists');
      }

      // Handle location if provided
      let locationData: Partial<Store> = {};
      if (dto.location) {
        locationData = this.processLocationData(dto.location);
        // If address is provided but no coordinates, try to geocode
        if (
          (dto.location.address || dto.location.city) &&
          !dto.location.latitude &&
          !dto.location.longitude
        ) {
          const addressToGeocode = [
            dto.location.address,
            dto.location.city,
            dto.location.country ?? 'Lebanon',
          ]
            .filter(Boolean)
            .join(', ');
          const geocodeResult =
            await this.locationService.geocodeAddress(addressToGeocode);
          if (geocodeResult) {
            locationData.latitude = geocodeResult.latitude;
            locationData.longitude = geocodeResult.longitude;
            // Fill in missing address details from geocoding
            if (!locationData.address && geocodeResult.address) {
              locationData.address = geocodeResult.address;
            }
            if (!locationData.city && geocodeResult.city) {
              locationData.city = geocodeResult.city;
            }
            if (!locationData.country && geocodeResult.country) {
              locationData.country = geocodeResult.country;
            }
            if (!locationData.postalCode && geocodeResult.postalCode) {
              locationData.postalCode = geocodeResult.postalCode;
            }
          }
        }
      }

      const store = this.stores.create({
        name: dto.name,
        slug: dto.slug,
        brandColor: dto.brandColor ?? null,
        description: dto.description ?? null,
        storeType: dto.storeType ?? StoreType.ECOMMERCE,
        socialMediaLinks: dto.socialMediaLinks ?? null,
        ownerId,
        subscriptionTier: StoreSubscriptionTier.FREE,
        postsCountThisMonth: 0,
        ...locationData,
      });

      const saved = await this.stores.save(store);

      // Auto-generate SEO for the new store
      try {
        await this.seoService.autoGenerateStoreSeo(saved);
      } catch (error) {
        // SEO generation failure shouldn't break store creation
        this.logger.warn('Failed to auto-generate store SEO:', error);
      }

      return toStoreResponseDto(saved, true, 0, 0);
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      if (
        error instanceof QueryFailedError &&
        (error as any).driverError?.code === 'ER_DUP_ENTRY'
      ) {
        throw new ConflictException('A store with this slug already exists');
      }
      this.sanitize(error);
    }
  }

  async update(
    slug: string,
    dto: UpdateStoreDto,
    userId: string,
  ): Promise<StoreResponseDto> {
    try {
      const store = await this.stores.findOneBy({ slug });
      if (!store) {
        throw new NotFoundException('Store not found');
      }

      if (store.ownerId !== userId) {
        throw new ForbiddenException('You do not own this store');
      }

      if (dto.name !== undefined) store.name = dto.name;
      if (dto.brandColor !== undefined) store.brandColor = dto.brandColor;
      if (dto.description !== undefined) store.description = dto.description;
      if (dto.storeType !== undefined) store.storeType = dto.storeType;
      if (dto.socialMediaLinks !== undefined)
        store.socialMediaLinks = dto.socialMediaLinks;
      if (dto.logoKey !== undefined) store.logoKey = dto.logoKey;
      if (dto.bannerKey !== undefined) store.bannerKey = dto.bannerKey;

      // Handle location update
      if (dto.location) {
        const locationData = this.processLocationData(dto.location);
        Object.assign(store, locationData);

        // If address is provided but no coordinates, try to geocode
        if (
          (dto.location.address || dto.location.city) &&
          !dto.location.latitude &&
          !dto.location.longitude
        ) {
          const addressToGeocode = [
            dto.location.address,
            dto.location.city,
            dto.location.country ?? 'Lebanon',
          ]
            .filter(Boolean)
            .join(', ');
          const geocodeResult =
            await this.locationService.geocodeAddress(addressToGeocode);
          if (geocodeResult) {
            store.latitude = geocodeResult.latitude;
            store.longitude = geocodeResult.longitude;
            // Fill in missing address details from geocoding
            if (!store.address && geocodeResult.address) {
              store.address = geocodeResult.address;
            }
            if (!store.city && geocodeResult.city) {
              store.city = geocodeResult.city;
            }
            if (!store.country && geocodeResult.country) {
              store.country = geocodeResult.country;
            }
            if (!store.postalCode && geocodeResult.postalCode) {
              store.postalCode = geocodeResult.postalCode;
            }
          }
        }
      }

      const saved = await this.stores.save(store);

      // Auto-regenerate SEO if content changed
      try {
        await this.seoService.autoGenerateStoreSeo(saved);
        await this.seoService.notifyIndexNowOnChange('store', saved);
      } catch (error) {
        // SEO generation failure shouldn't break store update
        this.logger.warn('Failed to auto-generate store SEO:', error);
      }

      const [postsCount, productsCount] = await Promise.all([
        this.getPostsCount(saved.id),
        this.getProductsCount(saved.id),
      ]);

      return toStoreResponseDto(saved, true, postsCount, productsCount);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      if (
        error instanceof QueryFailedError &&
        (error as any).driverError?.code === 'ER_DUP_ENTRY'
      ) {
        throw new ConflictException('A store with this slug already exists');
      }
      this.sanitize(error);
    }
  }

  /**
   * Process location data from DTO to entity fields
   * Validates coordinates are within Lebanon if provided
   */
  private processLocationData(
    location: CreateStoreLocationDto | UpdateStoreLocationDto,
  ): Partial<Store> {
    const result: Partial<Store> = {};

    if (location.latitude !== undefined)
      result.latitude = location.latitude ?? null;
    if (location.longitude !== undefined)
      result.longitude = location.longitude ?? null;
    if (location.address !== undefined)
      result.address = location.address ?? null;
    if (location.city !== undefined) result.city = location.city ?? null;
    if (location.country !== undefined)
      result.country = location.country ?? 'Lebanon';
    if (location.postalCode !== undefined)
      result.postalCode = location.postalCode ?? null;
    if (location.locationName !== undefined)
      result.locationName = location.locationName ?? null;
    if (location.phone !== undefined) result.phone = location.phone ?? null;
    if (location.website !== undefined)
      result.website = location.website ?? null;
    if (location.openingHours !== undefined)
      result.openingHours = location.openingHours ?? null;

    // Validate coordinates if both are provided
    if (
      result.latitude !== null &&
      result.longitude !== null &&
      typeof result.latitude === 'number' &&
      typeof result.longitude === 'number'
    ) {
      const validation = this.locationService.validateLocationInLebanon(
        result.latitude,
        result.longitude,
      );
      if (!validation.isValid) {
        throw new BadRequestException(validation.error);
      }
      // Note: We don't enforce isInLebanon here - just warn, allow outside Lebanon too
      // If you want to enforce Lebanon-only, throw if !validation.isInLebanon
    }

    return result;
  }

  async remove(slug: string, userId: string): Promise<void> {
    try {
      const store = await this.stores.findOneBy({ slug });
      if (!store) {
        throw new NotFoundException('Store not found');
      }

      if (store.ownerId !== userId) {
        throw new ForbiddenException('You do not own this store');
      }

      // Check if store has posts or products
      const [postsCount, productsCount] = await Promise.all([
        this.getPostsCount(store.id),
        this.getProductsCount(store.id),
      ]);

      if (postsCount > 0 || productsCount > 0) {
        throw new ConflictException(
          'Cannot delete store with existing posts or products. Delete them first.',
        );
      }

      await this.stores.remove(store);
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

  async getUserStores(userId: string): Promise<StoreResponseDto[]> {
    try {
      const stores = await this.stores.findBy({ ownerId: userId });
      const storeIds = stores.map((s) => s.id);
      const [postsCounts, productsCounts] = await Promise.all([
        this.getPostsCounts(storeIds),
        this.getProductsCounts(storeIds),
      ]);

      return stores.map((store, index) =>
        toStoreResponseDto(
          store,
          true,
          postsCounts[store.id],
          productsCounts[store.id],
        ),
      );
    } catch (error) {
      this.sanitize(error);
    }
  }

  private async getPostsCount(storeId: string): Promise<number> {
    return this.stores.manager.count('showcases', { where: { storeId } });
  }

  private async getProductsCount(storeId: string): Promise<number> {
    return this.products.count({
      where: { storeId, status: ProductStatus.ACTIVE },
    });
  }

  private async getPostsCounts(
    storeIds: string[],
  ): Promise<Record<string, number>> {
    if (storeIds.length === 0) return {};
    const result = await this.stores.manager
      .createQueryBuilder()
      .select('storeId', 'storeId')
      .addSelect('COUNT(*)', 'count')
      .from('showcases', 'showcase')
      .where('storeId IN (:...storeIds)', { storeIds })
      .groupBy('storeId')
      .getRawMany();

    const counts: Record<string, number> = {};
    for (const row of result) {
      counts[row.storeId] = parseInt(row.count, 10);
    }
    return counts;
  }

  private async getProductsCounts(
    storeIds: string[],
  ): Promise<Record<string, number>> {
    if (storeIds.length === 0) return {};
    const result = await this.products
      .createQueryBuilder('product')
      .select('storeId', 'storeId')
      .addSelect('COUNT(*)', 'count')
      .where('storeId IN (:...storeIds)', { storeIds })
      .andWhere('status = :status', { status: ProductStatus.ACTIVE })
      .groupBy('storeId')
      .getRawMany();

    const counts: Record<string, number> = {};
    for (const row of result) {
      counts[row.storeId] = parseInt(row.count, 10);
    }
    return counts;
  }

  // ============================================
  // Location-based methods
  // ============================================

  /**
   * Find stores near a given location (within radius in km)
   * Returns stores sorted by distance
   */
  async findStoresNearLocation(
    latitude: number,
    longitude: number,
    radiusKm: number = 50,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ items: StoreResponseDto[]; total: number }> {
    try {
      const bounds = this.locationService.calculateBoundingBox(
        latitude,
        longitude,
        radiusKm,
      );

      // First, find stores within the bounding box
      const stores = await this.stores
        .createQueryBuilder('store')
        .where('store.latitude IS NOT NULL')
        .andWhere('store.longitude IS NOT NULL')
        .andWhere('store.latitude BETWEEN :minLat AND :maxLat', {
          minLat: bounds.minLat,
          maxLat: bounds.maxLat,
        })
        .andWhere('store.longitude BETWEEN :minLon AND :maxLon', {
          minLon: bounds.minLon,
          maxLon: bounds.maxLon,
        })
        .orderBy('store.createdAt', 'DESC')
        .take(limit + 50) // Get extra to account for distance filtering
        .skip(offset)
        .getMany();

      // Calculate exact distances and filter by radius
      const storesWithDistance = stores
        .map((store) => ({
          store,
          distance: this.locationService.calculateDistance(
            latitude,
            longitude,
            store.latitude!,
            store.longitude!,
          ),
        }))
        .filter((item) => item.distance <= radiusKm)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit);

      const storeIds = storesWithDistance.map((item) => item.store.id);
      const [postsCounts, productsCounts] = await Promise.all([
        this.getPostsCounts(storeIds),
        this.getProductsCounts(storeIds),
      ]);

      return {
        items: storesWithDistance.map((item, index) =>
          toStoreResponseDto(
            item.store,
            false,
            postsCounts[item.store.id],
            productsCounts[item.store.id],
          ),
        ),
        total: storesWithDistance.length,
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  /**
   * Find stores by city
   */
  async findStoresByCity(
    city: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ items: StoreResponseDto[]; total: number }> {
    try {
      const [items, total] = await this.stores.findAndCount({
        where: { city },
        order: { createdAt: 'DESC' },
        take: limit,
        skip: offset,
      });

      const storeIds = items.map((s) => s.id);
      const [postsCounts, productsCounts] = await Promise.all([
        this.getPostsCounts(storeIds),
        this.getProductsCounts(storeIds),
      ]);

      return {
        items: items.map((item, index) =>
          toStoreResponseDto(
            item,
            false,
            postsCounts[item.id],
            productsCounts[item.id],
          ),
        ),
        total,
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  /**
   * Find stores by country
   */
  async findStoresByCountry(
    country: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ items: StoreResponseDto[]; total: number }> {
    try {
      const [items, total] = await this.stores.findAndCount({
        where: { country },
        order: { createdAt: 'DESC' },
        take: limit,
        skip: offset,
      });

      const storeIds = items.map((s) => s.id);
      const [postsCounts, productsCounts] = await Promise.all([
        this.getPostsCounts(storeIds),
        this.getProductsCounts(storeIds),
      ]);

      return {
        items: items.map((item, index) =>
          toStoreResponseDto(
            item,
            false,
            postsCounts[item.id],
            productsCounts[item.id],
          ),
        ),
        total,
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  /**
   * Get map configuration for frontend
   * Returns tile URLs, default center, attribution, etc.
   */
  getMapConfig() {
    return {
      defaultCenter: this.locationService.getDefaultLebanonView(),
      lebanonBounds: {
        north: 34.7,
        south: 33.0,
        east: 36.7,
        west: 35.0,
      },
      tileLayerTemplates: {
        standard: this.locationService.getTileLayerTemplate('standard'),
        humanitarian: this.locationService.getTileLayerTemplate('humanitarian'),
        topo: this.locationService.getTileLayerTemplate('topo'),
      },
      attribution: this.locationService.getMapAttribution(),
    };
  }

  /**
   * Geocode an address (public endpoint for frontend)
   */
  async geocodeAddress(address: string) {
    const result = await this.locationService.geocodeAddress(address);
    if (!result) {
      return { success: false, error: 'Could not geocode address' };
    }
    const validation = this.locationService.validateLocationInLebanon(
      result.latitude,
      result.longitude,
    );
    return {
      success: true,
      data: {
        ...result,
        isInLebanon: validation.isInLebanon,
      },
    };
  }

  /**
   * Reverse geocode coordinates (public endpoint for frontend)
   */
  async reverseGeocode(latitude: number, longitude: number) {
    const validation = this.locationService.validateLocationInLebanon(
      latitude,
      longitude,
    );
    if (!validation.isValid) {
      return { success: false, error: validation.error };
    }
    const result = await this.locationService.reverseGeocode(
      latitude,
      longitude,
    );
    if (!result) {
      return { success: false, error: 'Could not reverse geocode coordinates' };
    }
    return {
      success: true,
      data: {
        ...result,
        isInLebanon: validation.isInLebanon,
      },
    };
  }

  // ============================================
  // VERIFICATION BADGE MANAGEMENT
  // ============================================

  /**
   * Check if a store can have a verification badge based on their subscription
   */
  async checkBadgeEligibility(
    storeId: string,
    actorId: string,
  ): Promise<{
    eligible: boolean;
    reason?: string;
    currentBadges: number;
    maxBadges: number | null;
    badgePriceCents: number | null;
  }> {
    const store = await this.stores.findOneBy({ id: storeId });
    const actor = await this.stores.manager.findOneBy(User, { id: actorId });
    if (!store || !actor) throw new NotFoundException('Store not found');
    if (store.ownerId !== actorId && !this.admin.isAdmin(actor))
      throw new ForbiddenException('You do not own this store');
    const limits = await effectiveLimits(this.stores.manager, store.ownerId);
    const currentBadges = await this.activeBadgeCount(
      this.stores.manager,
      store.ownerId,
    );
    const maxBadges =
      limits.maxVerificationBadges === undefined
        ? 0
        : limits.maxVerificationBadges;
    const alreadyActive =
      store.hasVerificationBadge &&
      (!store.verificationBadgeExpiresAt ||
        store.verificationBadgeExpiresAt > new Date());
    const eligible =
      alreadyActive || maxBadges === null || currentBadges < maxBadges;
    return {
      eligible,
      reason: eligible
        ? undefined
        : 'Badge limit reached for your subscription',
      currentBadges,
      maxBadges,
      badgePriceCents: limits.verificationBadgePriceCents ?? 0,
    };
  }

  private activeBadgeCount(
    manager: import('typeorm').EntityManager,
    ownerId: string,
  ): Promise<number> {
    return manager
      .getRepository(Store)
      .createQueryBuilder('store')
      .where(
        'store.ownerId = :ownerId AND store.hasVerificationBadge = true AND (store.verificationBadgeExpiresAt IS NULL OR store.verificationBadgeExpiresAt > :now)',
        { ownerId, now: new Date() },
      )
      .getCount();
  }

  /**
   * Grant a verification badge to a store
   * Can be called by admin (free grant) or by store owner (paid via subscription)
   */
  async grantVerificationBadge(
    storeId: string,
    grantedBy: string,
  ): Promise<{
    success: boolean;
    error?: string;
    requiresPayment?: boolean;
    priceCents?: number;
  }> {
    try {
      const existing = await this.stores.findOneBy({ id: storeId });
      if (!existing) throw new NotFoundException('Store not found');
      return await this.stores.manager.transaction(async (manager) => {
        await manager.findOneOrFail(User, {
          where: { id: existing.ownerId },
          lock: { mode: 'pessimistic_write' },
        });
        const actor = await manager.findOneBy(User, { id: grantedBy });
        const store = await manager.findOneOrFail(Store, {
          where: { id: storeId },
          lock: { mode: 'pessimistic_write' },
        });
        const adminGrant = Boolean(actor && this.admin.isAdmin(actor));
        if (!actor || (!adminGrant && store.ownerId !== grantedBy))
          throw new ForbiddenException('You do not own this store');
        if (
          store.hasVerificationBadge &&
          (!store.verificationBadgeExpiresAt ||
            store.verificationBadgeExpiresAt > new Date())
        )
          return { success: true };
        if (!adminGrant) {
          const limits = await effectiveLimits(manager, store.ownerId);
          assertQuota(
            await this.activeBadgeCount(manager, store.ownerId),
            limits.maxVerificationBadges,
            'Verification badge',
          );
          const price = limits.verificationBadgePriceCents ?? 0;
          if (price > 0)
            return {
              success: false,
              requiresPayment: true,
              priceCents: price,
              error: 'Paid badge checkout is not available',
            };
          store.verificationBadgeExpiresAt =
            (await effectiveSubscription(manager, store.ownerId))?.expiresAt ??
            null;
        } else store.verificationBadgeExpiresAt = null;
        store.hasVerificationBadge = true;
        store.verificationBadgeGrantedAt = new Date();
        store.verificationBadgeGrantedBy = grantedBy;
        await manager.save(store);
        return { success: true };
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  /**
   * Revoke a verification badge from a store (admin only)
   */
  async revokeVerificationBadge(
    storeId: string,
    actorId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const actor = await this.stores.manager.findOneBy(User, { id: actorId });
      if (!actor || !this.admin.isAdmin(actor))
        throw new ForbiddenException('Administrator access required');
      const existing = await this.stores.findOneBy({ id: storeId });
      if (!existing) throw new NotFoundException('Store not found');
      return await this.stores.manager.transaction(async (manager) => {
        await manager.findOneOrFail(User, {
          where: { id: existing.ownerId },
          lock: { mode: 'pessimistic_write' },
        });
        const store = await manager.findOneOrFail(Store, {
          where: { id: storeId },
          lock: { mode: 'pessimistic_write' },
        });
        store.hasVerificationBadge = false;
        store.verificationBadgeGrantedAt = null;
        store.verificationBadgeGrantedBy = null;
        store.verificationBadgeExpiresAt = null;
        await manager.save(store);
        return { success: true };
      });
    } catch (error) {
      this.sanitize(error);
    }
  }
}
