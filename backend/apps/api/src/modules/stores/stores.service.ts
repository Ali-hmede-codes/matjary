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
import { Repository, QueryFailedError, Not } from 'typeorm';
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
  moderationWhere,
  ownerWhere,
  publicWhere,
  StoreStatus,
  lockOwnerContent,
  chooseContentSlug,
  assertMediaAttachment,
  visibilitySql,
  publicVisibilitySql,
  ShowcaseStatus,
  actorContext,
  appendAdminAudit,
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
      const where: Record<string, unknown> = {
        ...(ownerId ? ownerWhere('store') : publicWhere('store')),
        ...(ownerId ? { ownerId } : {}),
      };

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
      const store = await this.stores.findOneBy({
        slug,
        ...publicWhere('store'),
      });
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
      const store = await this.stores.findOneBy({
        id,
        ...publicWhere('store'),
      });
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
      return await this.stores.findOneBy({ slug, ...ownerWhere('store') });
    } catch (error) {
      this.sanitize(error);
    }
  }

  async create(
    dto: CreateStoreDto,
    ownerId: string,
  ): Promise<StoreResponseDto> {
    try {
      const slug = await chooseContentSlug(dto.name, dto.slug, (value) =>
        this.stores.findOneBy({ slug: value }),
      );
      const existing = await this.stores.findOneBy({ slug });
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
        slug,
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
        await this.seoService.autoGenerateOwnedSeo(
          'store',
          saved.id,
          saved.ownerId,
        );
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
      const store = await this.stores.findOneBy({
        slug,
        ...ownerWhere('store'),
      });
      if (!store) {
        throw new NotFoundException('Store not found');
      }

      if (store.ownerId !== userId) {
        throw new ForbiddenException('You do not own this store');
      }

      if (
        dto.enableCart !== undefined ||
        dto.enableWhatsAppCheckout !== undefined
      ) {
        const limits = await effectiveLimits(this.stores.manager, userId);
        if (
          (dto.enableCart && !limits.enableCart) ||
          (dto.enableWhatsAppCheckout && !limits.enableWhatsAppCheckout)
        )
          throw new ConflictException(
            'This feature is not included in your plan',
          );
        if (dto.enableCart !== undefined) store.enableCart = dto.enableCart;
        if (dto.enableWhatsAppCheckout !== undefined)
          store.enableWhatsAppCheckout = dto.enableWhatsAppCheckout;
      }
      await assertMediaAttachment(
        this.stores.manager,
        userId,
        'store_logo',
        store.id,
        [dto.logoKey],
        [store.logoKey],
      );
      await assertMediaAttachment(
        this.stores.manager,
        userId,
        'store_banner',
        store.id,
        [dto.bannerKey],
        [store.bannerKey],
      );
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

      const saved = await this.stores.manager.transaction(async (manager) => {
        const current = await lockOwnerContent(
          manager,
          'store',
          store.id,
          userId,
        );
        store.status = current.status;
        store.trashedAt = current.trashedAt;
        return manager.save(store);
      });

      // Auto-regenerate SEO if content changed
      try {
        await this.seoService.autoGenerateOwnedSeo(
          'store',
          saved.id,
          saved.ownerId,
        );
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

  async setStatus(
    slug: string,
    status: StoreStatus,
    userId: string,
  ): Promise<StoreResponseDto> {
    if (
      ![StoreStatus.ACTIVE, StoreStatus.OFFLINE, StoreStatus.ARCHIVED].includes(
        status,
      )
    )
      throw new BadRequestException('Invalid store status');
    return this.transition(slug, status, userId);
  }

  async remove(slug: string, userId: string): Promise<void> {
    await this.transition(slug, StoreStatus.TRASHED, userId);
  }

  async restore(slug: string, userId: string): Promise<StoreResponseDto> {
    return this.transition(slug, 'restore', userId);
  }

  private async transition(
    slug: string,
    action: StoreStatus | 'restore',
    userId: string,
  ): Promise<StoreResponseDto> {
    try {
      return await this.stores.manager.transaction(async (manager) => {
        const user = await manager.findOne(User, {
          where: { id: userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!user || user.suspendedAt)
          throw new ForbiddenException('Account unavailable');
        const store = await manager.findOne(Store, {
          where: { slug, ownerId: userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!store) throw new NotFoundException('Store not found');
        let next: StoreStatus;
        if (action === 'restore') {
          if (
            ![StoreStatus.ARCHIVED, StoreStatus.TRASHED].includes(store.status)
          )
            return toStoreResponseDto(store, true);
          next = StoreStatus.OFFLINE;
        } else {
          if (
            store.status === StoreStatus.TRASHED &&
            action !== StoreStatus.TRASHED
          )
            throw new ConflictException('Restore the store from Trash first');
          next = action;
        }
        if (store.status === next) return toStoreResponseDto(store, true);
        if (next === StoreStatus.ACTIVE && store.adminArchivedAt)
          throw new ForbiddenException(
            'This store is restricted by an administrator',
          );
        const trashedAt = next === StoreStatus.TRASHED ? new Date() : null;
        // No child rows, bytes, subscription usage or moderation flags are changed.
        await manager.query(
          'UPDATE stores SET status = ?, trashed_at = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND owner_id = ?',
          [next, trashedAt, store.id, userId],
        );
        store.status = next;
        store.trashedAt = trashedAt;
        return toStoreResponseDto(store, true);
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  async getUserStores(
    userId: string,
    includeTrashed = false,
  ): Promise<StoreResponseDto[]> {
    try {
      const stores = await this.stores.findBy({
        ownerId: userId,
        ...(includeTrashed ? {} : { status: Not(StoreStatus.TRASHED) }),
      });
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
    return this.stores.manager.count('showcases', {
      where: {
        storeId,
        status: ShowcaseStatus.PUBLISHED,
        ...moderationWhere('post'),
      },
    });
  }

  private async getProductsCount(storeId: string): Promise<number> {
    return this.products.count({
      where: {
        storeId,
        status: ProductStatus.ACTIVE,
        ...moderationWhere('product'),
      },
    });
  }

  private async getPostsCounts(
    storeIds: string[],
  ): Promise<Record<string, number>> {
    if (storeIds.length === 0) return {};
    const result = await this.stores.manager
      .createQueryBuilder()
      .select('showcase.storeId', 'storeId')
      .addSelect('COUNT(*)', 'count')
      .from('showcases', 'showcase')
      .where('showcase.storeId IN (:...storeIds)', { storeIds })
      .andWhere('showcase.status = :status', {
        status: ShowcaseStatus.PUBLISHED,
      })
      .andWhere(visibilitySql('post', 'showcase'))
      .groupBy('showcase.storeId')
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
      .select('product.storeId', 'storeId')
      .addSelect('COUNT(*)', 'count')
      .where('product.storeId IN (:...storeIds)', { storeIds })
      .andWhere('product.status = :status', { status: ProductStatus.ACTIVE })
      .andWhere(visibilitySql('product', 'product'))
      .groupBy('product.storeId')
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
        .andWhere(publicVisibilitySql('store', 'store'))
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
        where: { city, ...publicWhere('store') },
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
        where: { country, ...publicWhere('store') },
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
    const store = await this.stores.findOneBy({
      id: storeId,
      ...moderationWhere('store'),
    });
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
   * Verification is an administrator decision, never a subscription self-service action.
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
      const existing = await this.stores.findOneBy({
        id: storeId,
        ...moderationWhere('store'),
      });
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
        if (!actor || actor.suspendedAt || !this.admin.isAdmin(actor))
          throw new ForbiddenException('Administrator access required');
        if (
          store.hasVerificationBadge &&
          (!store.verificationBadgeExpiresAt ||
            store.verificationBadgeExpiresAt > new Date())
        )
          return { success: true };
        store.verificationBadgeExpiresAt = null;
        store.hasVerificationBadge = true;
        store.verificationBadgeGrantedAt = new Date();
        store.verificationBadgeGrantedBy = grantedBy;
        await manager.save(store);
        await appendAdminAudit(
          manager,
          actorContext(grantedBy),
          'stores',
          storeId,
          'badge.grant',
          ['hasVerificationBadge'],
        );
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
      if (!actor || actor.suspendedAt || !this.admin.isAdmin(actor))
        throw new ForbiddenException('Administrator access required');
      const existing = await this.stores.findOneBy({
        id: storeId,
        ...moderationWhere('store'),
      });
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
        const currentActor = await manager.findOneBy(User, { id: actorId });
        if (
          !currentActor ||
          currentActor.suspendedAt ||
          !this.admin.isAdmin(currentActor)
        )
          throw new ForbiddenException('Administrator access required');
        store.hasVerificationBadge = false;
        store.verificationBadgeGrantedAt = null;
        store.verificationBadgeGrantedBy = null;
        store.verificationBadgeExpiresAt = null;
        await manager.save(store);
        await appendAdminAudit(
          manager,
          actorContext(actorId),
          'stores',
          storeId,
          'badge.revoke',
          ['hasVerificationBadge'],
        );
        return { success: true };
      });
    } catch (error) {
      this.sanitize(error);
    }
  }
}
