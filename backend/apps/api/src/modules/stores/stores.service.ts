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
import { Repository, QueryFailedError, Not, In, EntityManager } from 'typeorm';
import {
  Store,
  StoreBranch,
  StoreCategory,
  StoreSubscriptionTier,
  StoreType,
  StoreMember,
  Product,
  SubscriptionPlan,
  User,
  effectiveLimits,
  effectiveSubscription,
  assertSubscriptionActive,
  assertQuota,
  contentSectionCaps,
  ownerContentState,
  sectionHasRoom,
  SECTION_LAST_ENABLED_CODE,
  SECTION_NO_ROOM_CODE,
  moderationWhere,
  ownerWhere,
  publicWhere,
  StoreStatus,
  lockOwnerContent,
  chooseContentSlug,
  assertMediaAttachment,
  visibilitySql,
  publicVisibilitySql,
  PUBLIC_PRODUCT_STATUSES,
  ShowcaseStatus,
  actorContext,
  appendAdminAudit,
  purgeStoreRecords,
  BUSINESS_CATEGORIES,
  BUSINESS_CATEGORY_GROUPS,
  defaultBusinessCategoryForStoreType,
  isBusinessCategory,
  canManageStore,
  nextVerificationExpiry,
  verificationPricing,
  verificationBadgeVisible,
  StoreVerificationRequest,
  VerificationRequestStatus,
  VerificationSettings,
  VERIFICATION_GRACE_DAYS,
  VERIFICATION_PERIOD_DAYS,
  requireAdmin,
  type AdminActor,
} from '@app/database';
import { StorageService } from '@app/storage';
import { CreateStoreDto, CreateStoreLocationDto } from './dto/create-store.dto';
import { UpdateStoreDto, UpdateStoreLocationDto } from './dto/update-store.dto';
import { StoreBranchDto } from './dto/store-branch.dto';
import { storedDesignSettings } from './store-design';
import { StoreResponseDto, toStoreResponseDto } from './dto/store-response.dto';
import {
  StoreDirectoryResponseDto,
  toStoreDirectoryItemDto,
} from './dto/store-directory.dto';
import {
  LocationService,
  LocationValidationResult,
} from './services/location.service';
import { SeoService } from '../seo/seo.service';
import { AdminGuard } from '../auth/guards/auth.guards';
import { deleteStoredObjects } from '../media-cleanup';

const MAX_BRANCHES = 10;
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_ALIASES: Record<string, string> = {
  mon: 'mon',
  monday: 'mon',
  tue: 'tue',
  tuesday: 'tue',
  wed: 'wed',
  wednesday: 'wed',
  thu: 'thu',
  thursday: 'thu',
  fri: 'fri',
  friday: 'fri',
  sat: 'sat',
  saturday: 'sat',
  sun: 'sun',
  sunday: 'sun',
};
const TIME_RANGE =
  /^([01]\d|2[0-3]):([0-5]\d)\s*[-–]\s*([01]\d|2[0-3]):([0-5]\d)$/u;

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
    private readonly storage: StorageService,
  ) {}

  private sanitize(error: unknown): never {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(
      'Store storage is temporarily unavailable',
    );
  }

  // The public shop list is identical for every visitor and powers the home
  // strip and the shop directory. Its per-store post/product counts are the
  // expensive part, so a short shared cache keeps page loads cheap.
  private readonly publicListCache = new Map<
    string,
    { expiresAt: number; value: { items: StoreResponseDto[]; total: number } }
  >();
  private static readonly PUBLIC_LIST_TTL_MS = 30 * 1000;
  private static readonly PUBLIC_LIST_CACHE_MAX = 20;

  // The directory reads the whole public catalogue at once; it shares the same
  // short TTL so a busy page load cannot turn into one query per visitor.
  private directoryCache?: {
    expiresAt: number;
    value: StoreDirectoryResponseDto;
  };
  // A ceiling keeps the response bounded; the page reports when it is reached.
  private static readonly DIRECTORY_MAX_ITEMS = 1000;

  // Every public shop in one slim response, so the directory filters locally
  // instead of paying a request per keystroke.
  async listDirectory(): Promise<StoreDirectoryResponseDto> {
    const cached = this.directoryCache;
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const [rows, total] = await this.stores.findAndCount({
        where: publicWhere('store'),
        select: {
          id: true,
          name: true,
          slug: true,
          logoKey: true,
          brandColor: true,
          storeType: true,
          businessCategory: true,
          city: true,
          country: true,
          hasVerificationBadge: true,
          verificationBadgeExpiresAt: true,
        },
        order: { name: 'ASC', id: 'ASC' },
        take: StoresService.DIRECTORY_MAX_ITEMS,
      });
      const storeIds = rows.map((row) => row.id);
      const [postsCounts, productsCounts] = await Promise.all([
        this.getPostsCounts(storeIds),
        this.getProductsCounts(storeIds),
      ]);
      const value: StoreDirectoryResponseDto = {
        items: rows.map((row) =>
          toStoreDirectoryItemDto(
            row,
            postsCounts[row.id],
            productsCounts[row.id],
          ),
        ),
        total,
      };
      this.directoryCache = {
        expiresAt: Date.now() + StoresService.PUBLIC_LIST_TTL_MS,
        value,
      };
      return value;
    } catch (error) {
      this.sanitize(error);
    }
  }

  // The catalog itself is static, so it can be served without touching MySQL.
  getBusinessCategoryCatalog() {
    return {
      groups: BUSINESS_CATEGORY_GROUPS.map((group) => ({ ...group })),
      categories: BUSINESS_CATEGORIES.map((category) => ({ ...category })),
    };
  }

  private businessCategoryValue(
    value: string | undefined,
    storeType: StoreType | undefined,
  ): string {
    const slug =
      value?.trim() || defaultBusinessCategoryForStoreType(storeType);
    if (!isBusinessCategory(slug))
      throw new BadRequestException('Choose a valid business category');
    return slug;
  }

  async findAll(
    ownerId: string | undefined,
    limit: number,
    offset: number,
  ): Promise<{ items: StoreResponseDto[]; total: number }> {
    // Owner-scoped listings always read fresh; only the public list is shared.
    const cacheKey = ownerId ? '' : `${limit}:${offset}`;
    if (cacheKey) {
      const cached = this.publicListCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
    }
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
        relations: { branches: true },
      });

      // Get counts for each store
      const storeIds = items.map((s) => s.id);
      const [postsCounts, productsCounts] = await Promise.all([
        this.getPostsCounts(storeIds),
        this.getProductsCounts(storeIds),
      ]);

      const result = {
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
      if (cacheKey) {
        if (this.publicListCache.size >= StoresService.PUBLIC_LIST_CACHE_MAX) {
          const oldest = this.publicListCache.keys().next().value;
          if (oldest) this.publicListCache.delete(oldest);
        }
        this.publicListCache.set(cacheKey, {
          expiresAt: Date.now() + StoresService.PUBLIC_LIST_TTL_MS,
          value: result,
        });
      }
      return result;
    } catch (error) {
      this.sanitize(error);
    }
  }

  async findOneBySlug(
    slug: string,
    userId: string | undefined,
  ): Promise<StoreResponseDto> {
    try {
      const store = await this.stores.findOne({
        where: { slug, ...publicWhere('store') },
        relations: { branches: true },
      });
      if (!store) {
        throw new NotFoundException('Store not found');
      }

      // The storefront shows its story "+" to the owner and the shop team.
      const canManage = userId
        ? await canManageStore(this.stores.manager, userId, store)
        : false;
      const [postsCount, productsCount] = await Promise.all([
        this.getPostsCount(store.id),
        this.getProductsCount(store.id),
      ]);

      return toStoreResponseDto(store, canManage, postsCount, productsCount);
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
      const store = await this.stores.findOne({
        where: { id, ...publicWhere('store') },
        relations: { branches: true },
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

  // `administrator` marks a store opened from the admin workspace: the acting
  // platform administrator bypasses every plan quota, the store is created for
  // the chosen owner, and the creation is written to the admin audit log inside
  // the same transaction.
  async create(
    dto: CreateStoreDto,
    ownerId: string,
    options: { administrator?: { actor: AdminActor; allowlist: string } } = {},
  ): Promise<StoreResponseDto> {
    const administrator = options.administrator;
    try {
      // Trial-expired owners keep read-only access to published stores.
      if (!administrator)
        await assertSubscriptionActive(this.stores.manager, ownerId);
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
        businessCategory: this.businessCategoryValue(
          dto.businessCategory,
          dto.storeType,
        ),
        socialMediaLinks: dto.socialMediaLinks ?? null,
        ownerId,
        subscriptionTier: StoreSubscriptionTier.FREE,
        postsCountThisMonth: 0,
        ...locationData,
      });

      const saved = await this.stores.manager.transaction(async (manager) => {
        const owner = await manager.findOne(User, {
          where: { id: ownerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!owner || owner.suspendedAt)
          throw new NotFoundException(
            administrator ? 'Owner not found' : 'Store not found',
          );
        if (administrator) {
          // Re-check the acting administrator inside the writing transaction so
          // a revoked role cannot create shops through a stale session.
          await requireAdmin(
            manager,
            administrator.actor,
            administrator.allowlist,
          );
        } else {
          // A website administrator owns shops without a plan limit; everyone
          // else stays bounded by their subscription's shop allowance.
          const unlimitedOwner = this.admin.isGlobalAdmin(owner);
          if (!unlimitedOwner) {
            await assertSubscriptionActive(manager, ownerId);
            const limits = await effectiveLimits(manager, ownerId);
            // Trashed shops keep their rows but release a shop slot.
            const count = await manager.count(Store, {
              where: { ownerId, status: Not(StoreStatus.TRASHED) },
            });
            assertQuota(count, limits.maxShops, 'Store');
          }
        }
        const created = await manager.save(store);
        if (dto.branches?.length) {
          await this.replaceBranches(manager, created, dto.branches);
          await manager.save(created);
        }
        if (administrator) {
          await appendAdminAudit(
            manager,
            administrator.actor,
            'stores',
            created.id,
            'store.create',
            ['name', 'slug', 'ownerId'],
          );
        }
        return manager.findOneOrFail(Store, {
          where: { id: created.id },
          relations: { branches: true },
        });
      });

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

      await assertSubscriptionActive(this.stores.manager, userId);

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
      // Display preference only: no plan gate, because the shop still sells in
      // USD and the LBP line is generated from the platform rate.
      if (dto.showPricesInLbp !== undefined)
        store.showPricesInLbp = dto.showPricesInLbp;
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
      if (dto.businessCategory !== undefined)
        store.businessCategory = this.businessCategoryValue(
          dto.businessCategory,
          dto.storeType ?? store.storeType,
        );
      if (dto.socialMediaLinks !== undefined)
        store.socialMediaLinks = dto.socialMediaLinks;
      if (dto.logoKey !== undefined) store.logoKey = dto.logoKey;
      if (dto.bannerKey !== undefined) store.bannerKey = dto.bannerKey;

      // A design save replaces the whole visual system. Overrides for sections
      // this store no longer owns are dropped before they reach the JSON column.
      if (dto.designSettings !== undefined) {
        const categories = await this.stores.manager.find(StoreCategory, {
          where: { storeId: store.id },
          select: { id: true },
        });
        store.designSettings = storedDesignSettings(
          dto.designSettings,
          categories.map((category) => category.id),
        );
      }

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

        const nextPostsSection =
          dto.enablePostsSection ?? current.enablePostsSection;
        const nextProductsSection =
          dto.enableProductsSection ?? current.enableProductsSection;
        if (!nextPostsSection && !nextProductsSection)
          throw new BadRequestException({ code: SECTION_LAST_ENABLED_CODE });
        store.enablePostsSection = nextPostsSection;
        store.enableProductsSection = nextProductsSection;

        // Turning a section back on must leave room for at least one new item;
        // otherwise the owner would re-open a section that can never accept
        // content. Existing rows in the section keep it re-openable.
        if (
          (nextPostsSection && !current.enablePostsSection) ||
          (nextProductsSection && !current.enableProductsSection)
        ) {
          const [limits, sections] = await Promise.all([
            effectiveLimits(manager, userId),
            ownerContentState(manager, userId),
          ]);
          // Evaluate the split as it will be after this save: other live shops
          // may already keep a section on.
          const availability = {
            posts:
              nextPostsSection ||
              sections.shops.some(
                (shop) => shop.id !== current.id && shop.enablePostsSection,
              ),
            products:
              nextProductsSection ||
              sections.shops.some(
                (shop) => shop.id !== current.id && shop.enableProductsSection,
              ),
          };
          const caps = contentSectionCaps(limits, sections.usage, availability);
          if (
            nextPostsSection &&
            !current.enablePostsSection &&
            !sectionHasRoom('posts', caps, sections.usage)
          )
            throw new ConflictException({ code: SECTION_NO_ROOM_CODE });
          if (
            nextProductsSection &&
            !current.enableProductsSection &&
            !sectionHasRoom('products', caps, sections.usage)
          )
            throw new ConflictException({ code: SECTION_NO_ROOM_CODE });
        }

        const persisted = await manager.save(store);
        if (dto.branches !== undefined) {
          await this.replaceBranches(manager, persisted, dto.branches);
          await manager.save(persisted);
          persisted.branches = await manager.find(StoreBranch, {
            where: { storeId: persisted.id },
            order: { sortOrder: 'ASC', createdAt: 'ASC' },
          });
        }
        return persisted;
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

  // Branches are saved as a complete ordered list. The first branch flagged as
  // primary becomes the shop's legacy location, keeping nearby search and SEO
  // on the same address as the storefront's main branch.
  private async replaceBranches(
    manager: EntityManager,
    store: Store,
    inputs: StoreBranchDto[],
  ): Promise<StoreBranch[]> {
    if (inputs.length > MAX_BRANCHES)
      throw new BadRequestException(
        `A shop can have up to ${MAX_BRANCHES} branches`,
      );
    const existing = await manager.find(StoreBranch, {
      where: { storeId: store.id },
    });
    const existingById = new Map(existing.map((branch) => [branch.id, branch]));
    const retained = new Set<string>();
    for (const input of inputs) {
      if (!input.id) continue;
      if (!existingById.has(input.id))
        throw new BadRequestException(
          'A branch is no longer available. Refresh and try again.',
        );
      retained.add(input.id);
    }
    for (const branch of existing) {
      if (!retained.has(branch.id))
        await manager.delete(StoreBranch, branch.id);
    }

    const primaryIndex = Math.max(
      0,
      inputs.findIndex((input) => input.isPrimary),
    );
    const rows: StoreBranch[] = [];
    for (const [index, input] of inputs.entries()) {
      const branch =
        (input.id ? existingById.get(input.id) : undefined) ??
        manager.create(StoreBranch, { storeId: store.id });
      Object.assign(branch, this.branchData(input), {
        isPrimary: index === primaryIndex,
        sortOrder: index,
      });
      rows.push(await manager.save(branch));
    }

    const primary = rows[primaryIndex];
    if (primary) {
      store.latitude = primary.latitude;
      store.longitude = primary.longitude;
      store.address = primary.address;
      store.city = primary.city;
      store.country = primary.country;
      store.postalCode = primary.postalCode;
      store.locationName = primary.name;
      store.phone = primary.phone;
      store.openingHours = primary.openingHours;
    } else {
      store.latitude = null;
      store.longitude = null;
      store.address = null;
      store.city = null;
      store.country = null;
      store.postalCode = null;
      store.locationName = null;
      store.phone = null;
      store.openingHours = null;
    }
    return rows;
  }

  private branchData(input: StoreBranchDto): Partial<StoreBranch> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('A branch name is required');
    const latitude =
      typeof input.latitude === 'number' && Number.isFinite(input.latitude)
        ? input.latitude
        : null;
    const longitude =
      typeof input.longitude === 'number' && Number.isFinite(input.longitude)
        ? input.longitude
        : null;
    if (latitude !== null && (latitude < -90 || latitude > 90))
      throw new BadRequestException('Branch latitude is out of range');
    if (longitude !== null && (longitude < -180 || longitude > 180))
      throw new BadRequestException('Branch longitude is out of range');
    return {
      name: name.slice(0, 120),
      address: this.optionalText(input.address, 500),
      city: this.optionalText(input.city, 100),
      country: this.optionalText(input.country, 100),
      postalCode: this.optionalText(input.postalCode, 20),
      latitude: latitude !== null && longitude !== null ? latitude : null,
      longitude: latitude !== null && longitude !== null ? longitude : null,
      phone: this.optionalText(input.phone, 30),
      whatsapp: this.normalizeWhatsApp(input.whatsapp),
      openingHours: this.normalizeOpeningHours(input.openingHours),
      googleMapsUrl: this.locationService.normalizeGoogleMapsUrl(
        input.googleMapsUrl,
      ),
    };
  }

  private optionalText(
    value: string | null | undefined,
    maxLength: number,
  ): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed.slice(0, maxLength) : null;
  }

  private normalizeWhatsApp(value: string | null | undefined): string | null {
    const digits = value?.replace(/\D/gu, '') ?? '';
    return /^\d{7,15}$/u.test(digits) ? digits : null;
  }

  private normalizeOpeningHours(
    value: Record<string, string | null> | null | undefined,
  ): Record<string, string> | null {
    if (!value) return null;
    const hours: Record<string, string> = {};
    for (const day of WEEKDAYS) hours[day] = '';
    let hasHours = false;
    for (const [rawDay, rawRange] of Object.entries(value)) {
      const day = DAY_ALIASES[rawDay.trim().toLowerCase()];
      if (!day || typeof rawRange !== 'string') continue;
      const normalized = rawRange.trim().replace(/\s*[–]\s*/gu, '-');
      if (!TIME_RANGE.test(normalized)) continue;
      hours[day] = normalized.replace(/\s+/gu, '');
      hasHours = true;
    }
    if (!hasHours) return null;
    return Object.fromEntries(
      Object.entries(hours).filter(([, range]) => Boolean(range)),
    );
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

  // Permanent deletion is only reachable from Trash, so a mistaken request can
  // never erase an active shop. The locked row is checked again under the lock.
  async purge(slug: string, userId: string): Promise<void> {
    let keys: string[] = [];
    try {
      keys = await this.stores.manager.transaction(async (manager) => {
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
        if (store.status !== StoreStatus.TRASHED)
          throw new ConflictException(
            'Move the store to Trash before deleting it permanently',
          );
        return purgeStoreRecords(manager, store.id);
      });
    } catch (error) {
      this.sanitize(error);
    }
    await deleteStoredObjects(this.storage, keys);
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
        // Restoring from Trash re-occupies a shop slot; archived shops already
        // count toward the plan quota.
        if (action === 'restore' && store.status === StoreStatus.TRASHED) {
          const limits = await effectiveLimits(manager, userId);
          const count = await manager.count(Store, {
            where: { ownerId: userId, status: Not(StoreStatus.TRASHED) },
          });
          assertQuota(count, limits.maxShops, 'Store');
        }
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
      // Owned shops and shops where this account is an invited team member.
      const memberRows = await this.stores.manager.find(StoreMember, {
        where: { userId },
        select: { storeId: true },
      });
      const memberIds = [
        ...new Set(memberRows.map((member) => member.storeId)),
      ];
      const [owned, joined] = await Promise.all([
        this.stores.find({
          where: {
            ownerId: userId,
            ...(includeTrashed ? {} : { status: Not(StoreStatus.TRASHED) }),
          },
          relations: { branches: true },
        }),
        memberIds.length
          ? this.stores.find({
              where: {
                id: In(memberIds),
                // A trashed shop stays out of the member's panel even when the
                // owner asked to include their own trash.
                status: Not(StoreStatus.TRASHED),
                ...ownerWhere('store'),
              },
              relations: { branches: true },
            })
          : Promise.resolve([]),
      ]);
      const ownedIds = new Set(owned.map((store) => store.id));
      const stores = [
        ...owned,
        ...joined.filter((store) => !ownedIds.has(store.id)),
      ];
      const storeIds = stores.map((s) => s.id);
      const [postsCounts, productsCounts] = await Promise.all([
        this.getPostsCounts(storeIds),
        this.getProductsCounts(storeIds),
      ]);

      return stores.map((store) => ({
        ...toStoreResponseDto(
          store,
          store.ownerId === userId,
          postsCounts[store.id],
          productsCounts[store.id],
        ),
        teamRole: store.ownerId === userId ? 'owner' : 'member',
      }));
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
        // Out of stock items still appear on the shop and its menus.
        status: In([...PUBLIC_PRODUCT_STATUSES]),
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
      .andWhere('product.status IN (:...statuses)', {
        statuses: [...PUBLIC_PRODUCT_STATUSES],
      })
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
        .leftJoinAndSelect('store.branches', 'branch')
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
        relations: { branches: true },
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
        relations: { branches: true },
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

  async resolveGoogleMapsLink(url: string) {
    const result = await this.locationService.resolveGoogleMapsLink(url);
    if (!result) {
      return {
        success: false,
        error: 'Could not find a location in that Google Maps link',
      };
    }
    return { success: true, data: result };
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
    included: boolean;
  }> {
    const store = await this.stores.findOneBy({
      id: storeId,
      ...moderationWhere('store'),
    });
    const actor = await this.stores.manager.findOneBy(User, { id: actorId });
    if (!store || !actor) throw new NotFoundException('Store not found');
    if (store.ownerId !== actorId && !this.admin.isAdmin(actor))
      throw new ForbiddenException('You do not own this store');
    const [limits, subscription, settings] = await Promise.all([
      effectiveLimits(this.stores.manager, store.ownerId),
      effectiveSubscription(this.stores.manager, store.ownerId),
      this.stores.manager
        .getRepository(VerificationSettings)
        .findOneBy({ id: 1 }),
    ]);
    const currentBadges = await this.activeBadgeCount(
      this.stores.manager,
      store.ownerId,
    );
    const maxBadges =
      limits.maxVerificationBadges === undefined
        ? 0
        : limits.maxVerificationBadges;
    const pricing = verificationPricing(limits, {
      // A lapsed bundled badge no longer holds its slot; another shop may have
      // taken it, so this shop competes for a free one or pays the add-on.
      includedBadge:
        store.verificationIncludedInPlan && verificationBadgeVisible(store),
      activeIncludedBadges: currentBadges,
      // The platform-wide price fills in for plans that set none. A lapsed
      // subscription still fails every quota closed.
      fallbackPriceCents: subscription
        ? Math.max(0, settings?.badgePriceCents ?? 0)
        : 0,
    });
    return {
      eligible: pricing.available,
      reason: pricing.available
        ? undefined
        : 'Verification is not available on your plan',
      currentBadges,
      maxBadges,
      badgePriceCents: pricing.priceCents,
      included: pricing.included,
    };
  }

  private activeBadgeCount(
    manager: import('typeorm').EntityManager,
    ownerId: string,
  ): Promise<number> {
    // Only bundled badges occupy a plan slot; paid add-ons never do. Badges
    // past their grace window no longer occupy anything.
    const graceBorder = new Date(
      Date.now() - VERIFICATION_GRACE_DAYS * 86_400_000,
    );
    return manager
      .getRepository(Store)
      .createQueryBuilder('store')
      .where('store.ownerId = :ownerId', { ownerId })
      .andWhere('store.hasVerificationBadge = true')
      .andWhere('store.verificationIncludedInPlan = true')
      .andWhere(
        '(store.verificationBadgeExpiresAt IS NULL OR store.verificationBadgeExpiresAt > :graceBorder)',
        { graceBorder },
      )
      .getCount();
  }

  // The legacy admin badge endpoints and the verification queue must agree:
  // an approval closes any pending application for the same shop.
  private async settleVerificationRequests(
    manager: EntityManager,
    storeId: string,
    reviewerId: string,
    expiresAt: Date,
  ): Promise<void> {
    const pending = await manager.find(StoreVerificationRequest, {
      where: { storeId, status: VerificationRequestStatus.PENDING },
    });
    const now = new Date();
    for (const request of pending) {
      request.status = VerificationRequestStatus.APPROVED;
      request.reviewedBy = reviewerId;
      request.reviewedAt = now;
      request.periodStartsAt = new Date(
        expiresAt.getTime() - VERIFICATION_PERIOD_DAYS * 86_400_000,
      );
      request.periodEndsAt = expiresAt;
    }
    if (pending.length) await manager.save(pending);
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
        if (!actor || actor.suspendedAt || !this.admin.isGlobalAdmin(actor))
          throw new ForbiddenException('Administrator access required');
        // Granting is idempotent while the tick is already visible; giving
        // another month has its own explicit action in the verification queue.
        if (verificationBadgeVisible(store)) return { success: true };
        const now = new Date();
        store.verificationBadgeExpiresAt = nextVerificationExpiry(
          store.verificationBadgeExpiresAt,
          now,
        );
        store.hasVerificationBadge = true;
        store.verificationBadgeGrantedAt = now;
        store.verificationBadgeGrantedBy = grantedBy;
        // A manual administrator grant is not a plan bundle: it keeps its own
        // month and never consumes one of the owner's bundled slots.
        store.verificationIncludedInPlan = false;
        await manager.save(store);
        await this.settleVerificationRequests(
          manager,
          storeId,
          grantedBy,
          store.verificationBadgeExpiresAt,
        );
        await appendAdminAudit(
          manager,
          actorContext(grantedBy),
          'stores',
          storeId,
          'badge.grant',
          ['hasVerificationBadge', 'verificationIncludedInPlan'],
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
      if (!actor || actor.suspendedAt || !this.admin.isGlobalAdmin(actor))
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
          !this.admin.isGlobalAdmin(currentActor)
        )
          throw new ForbiddenException('Administrator access required');
        store.hasVerificationBadge = false;
        store.verificationBadgeGrantedAt = null;
        store.verificationBadgeGrantedBy = null;
        store.verificationBadgeExpiresAt = null;
        store.verificationIncludedInPlan = false;
        await manager.save(store);
        const pending = await manager.find(StoreVerificationRequest, {
          where: {
            storeId,
            status: VerificationRequestStatus.PENDING,
          },
        });
        for (const request of pending) {
          request.status = VerificationRequestStatus.REJECTED;
          request.reviewedBy = actorId;
          request.reviewedAt = new Date();
          request.reviewNote = 'Verification revoked';
        }
        if (pending.length) await manager.save(pending);
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
