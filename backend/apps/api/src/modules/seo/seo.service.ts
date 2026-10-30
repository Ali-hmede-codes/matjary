import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  Logger,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  DataSource,
  In,
  IsNull,
  type EntityManager,
} from 'typeorm';
import { plainToInstance, ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminGuard } from '../auth/guards/auth.guards';
import {
  StorageService,
  mediaAssetIdFromKey,
  storeBrandCardKey,
  storeBrandCardVersion,
  storeShareCardKey,
} from '@app/storage';
import type { Readable } from 'node:stream';
import {
  StoreSeoDto,
  ProductSeoDto,
  ShowcaseSeoDto,
  SeoSettingsDto,
  CreateRedirectDto,
  UpdateRedirectDto,
  IndexNowDto,
} from './seo.dto';
import { isShareCrawler, renderShareDocument } from './share-document';
import { LEGACY_SEO_DESCRIPTION, LEGACY_SEO_TITLE } from './seo-legacy';
import { choosePreviewImage } from './preview-image';

type SeoKind = 'store' | 'product' | 'showcase';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import {
  StoreSeo,
  ProductSeo,
  ShowcaseSeo,
  SeoRedirect,
  SeoSettings,
  RobotsDirective,
  AiRobotsDirective,
} from './seo.entities';
import {
  Store,
  StoreType,
  StoreCategory,
  Product,
  Showcase,
  ShowcaseStatus,
  MediaAsset,
  MediaVariant,
  MediaStatus,
  PUBLIC_PRODUCT_STATUSES,
  isPublicProductStatus,
  User,
  publicWhere,
  ownerWhere,
  lockOwnerContent,
  publicVisibilitySql,
  appendAdminAudit,
  assertSubscriptionActive,
  adminContext,
  businessCategoryLabel,
  productFromPriceCents,
  readProductOptions,
  storeAccess,
  WebsiteSettings,
  type AdminActor,
} from '@app/database';
import { ShareShellSignal } from './share-shell.signal';

export interface MetaTags {
  title: string;
  description: string;
  keywords?: string;
  robots: string;
  canonical: string;
  og: OpenGraphTags;
  twitter: TwitterCardTags;
  jsonLd?: Record<string, unknown>[];
  verificationMeta?: string[];
  // GEO/AI specific
  aiRobots?: string;
  aiTraining?: string;
}

export interface OpenGraphTags {
  title: string;
  description: string;
  image?: string;
  type: string;
  siteName?: string;
  url: string;
  // Additional OG fields for AI
  locale?: string;
  localeAlternate?: string[];
}

export interface TwitterCardTags {
  card: string;
  site?: string;
  creator?: string;
  title: string;
  description: string;
  image?: string;
}

export interface SitemapUrl {
  url: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
  images?: SitemapImage[];
  videos?: SitemapVideo[];
}

export interface SitemapImage {
  url: string;
  title?: string;
  caption?: string;
}

export interface SitemapVideo {
  url: string;
  title: string;
  description: string;
  thumbnail: string;
  duration?: number;
  uploadDate?: string;
}

export interface LlmsTxtEntry {
  title: string;
  url: string;
  description?: string;
  priority?: 'high' | 'medium' | 'low';
}

/** The post fields an llms.txt row needs, read without hydrating entities. */
interface PublicPostRow {
  slug: string;
  title: string;
  description: string | null;
}

export interface IndexNowUrl {
  url: string;
  lastmod?: string;
}

// Shared links are matched only against slug shapes, so a malformed path can
// never reach a query or the filesystem.
const SHARE_STORE_ROUTE =
  /^stores\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/([cp])\/([a-z0-9]+(?:-[a-z0-9]+)*)|\/post\/([a-z0-9]+(?:-[a-z0-9]+)*))?$/u;
const SHARE_POST_ROUTE = /^post\/([a-z0-9]+(?:-[a-z0-9]+)*)$/u;

@Injectable()
export class SeoService {
  private readonly logger = new Logger(SeoService.name);
  private readonly baseUrl: string;
  private readonly defaultImageKey: string | null;
  // Crawler documents are identical for every visitor, so repeated origin
  // requests must not rebuild the whole catalogue each time. Concurrent
  // builds are shared, and the TTL bounds how long a write path that does
  // not announce itself can stay invisible.
  private static readonly DOCUMENT_TTL_MS = 60_000;
  // Catalog-sized reads stay bounded: one query per chunk, never one per row.
  private static readonly READ_CHUNK = 500;
  private readonly documents = new Map<
    string,
    { computedAt: number; version: number; body: string }
  >();
  private readonly building = new Map<string, Promise<string>>();

  constructor(
    @InjectRepository(StoreSeo)
    private readonly storeSeoRepo: Repository<StoreSeo>,
    @InjectRepository(ProductSeo)
    private readonly productSeoRepo: Repository<ProductSeo>,
    @InjectRepository(ShowcaseSeo)
    private readonly showcaseSeoRepo: Repository<ShowcaseSeo>,
    @InjectRepository(SeoRedirect)
    private readonly redirectRepo: Repository<SeoRedirect>,
    @InjectRepository(SeoSettings)
    private readonly settingsRepo: Repository<SeoSettings>,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly admin: AdminGuard,
    private readonly storage: StorageService,
    // A default value keeps manual construction (tests, scoped copies) short;
    // the explicit token keeps Nest from seeing the emitted `Object` type.
    @Inject(ShareShellSignal)
    private readonly shells: ShareShellSignal = new ShareShellSignal(),
  ) {
    this.baseUrl =
      this.configService.get<string>('APP_ORIGIN') || 'http://localhost:3000';
    this.defaultImageKey =
      this.configService.get<string>('DEFAULT_OG_IMAGE_KEY') || null;
  }

  /**
   * Runs one document build for every identical request: concurrent crawlers
   * share the in-flight work and a finished body is reused for a short window.
   * Any announced content change bumps the signal's version and retires every
   * stored body; failures are never cached, so the next request tries again.
   */
  private async cachedDocument(
    key: string,
    build: () => Promise<string>,
  ): Promise<string> {
    const cached = this.documents.get(key);
    if (
      cached &&
      cached.version === this.shells.version &&
      Date.now() - cached.computedAt < SeoService.DOCUMENT_TTL_MS
    )
      return cached.body;
    const shared = this.building.get(key);
    if (shared) return shared;
    const version = this.shells.version;
    const pending = build()
      .then((body) => {
        this.documents.set(key, { computedAt: Date.now(), version, body });
        return body;
      })
      .finally(() => this.building.delete(key));
    this.building.set(key, pending);
    return pending;
  }

  /** Public content or settings changed: crawler documents and shells drift. */
  private contentChanged(): void {
    this.documents.clear();
    this.shells.request();
  }

  // ============================================
  // Settings
  // ============================================

  private async validated<T extends object>(
    type: ClassConstructor<T>,
    data: T,
  ): Promise<T> {
    const dto = plainToInstance(type, data);
    if (
      (await validate(dto, { whitelist: true, forbidNonWhitelisted: true }))
        .length
    ) {
      throw new BadRequestException('Invalid SEO fields');
    }
    return dto;
  }

  private async requireAdmin(
    actorId: string,
    manager = this.dataSource.manager,
  ): Promise<void> {
    const actor = await manager.findOneBy(User, {
      id: actorId,
    });
    // Website SEO is platform-wide; a store-scoped administrator never edits it.
    if (!actor || actor.suspendedAt || !this.admin.isGlobalAdmin(actor))
      throw new ForbiddenException('Admin access required');
  }

  private async adminWrite<T>(
    actorId: string,
    action: string,
    resourceId: string,
    changed: string[],
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await this.requireAdmin(actorId, manager);
      const context = adminContext.getStore();
      const actor =
        context?.id === actorId
          ? context
          : { id: actorId, requestId: randomUUID() };
      const result = await work(manager);
      await appendAdminAudit(
        manager,
        actor,
        'seo',
        resourceId,
        action,
        changed,
      );
      return result;
    });
  }

  private scoped(manager: EntityManager): SeoService {
    return new SeoService(
      manager.getRepository(StoreSeo),
      manager.getRepository(ProductSeo),
      manager.getRepository(ShowcaseSeo),
      manager.getRepository(SeoRedirect),
      manager.getRepository(SeoSettings),
      this.configService,
      this.dataSource,
      this.admin,
      this.storage,
      this.shells,
    );
  }

  async autoGenerateAdminSeo(kind: SeoKind, id: string, actor: AdminActor) {
    try {
      const saved = await adminContext.run(actor, () =>
        this.adminWrite(
          actor.id,
          'metadata.generate',
          id,
          [],
          async (manager) => {
            const scoped = this.scoped(manager);
            if (kind === 'store') {
              const store = await manager.findOneBy(Store, { id });
              if (!store) throw new NotFoundException('Store not found');
              return scoped.autoGenerateStoreSeo(store);
            }
            if (kind === 'product') {
              const product = await manager.findOne(Product, {
                where: { id },
                relations: ['store'],
              });
              if (!product) throw new NotFoundException('Product not found');
              return scoped.autoGenerateProductSeo(product, product.store);
            }
            const post = await manager.findOne(Showcase, {
              where: { id },
              relations: ['store'],
            });
            if (!post) throw new NotFoundException('Post not found');
            return scoped.autoGenerateShowcaseSeo(post, post.store ?? null);
          },
        ),
      );
      this.contentChanged();
      return saved;
    } catch (error) {
      this.logger.warn('Admin SEO generation failed');
      throw error;
    }
  }

  async getAdminEntitySeo(kind: SeoKind, id: string, actorId: string) {
    await this.requireAdmin(actorId);
    if (kind === 'store') return this.getStoreSeo(id);
    if (kind === 'product') return this.getProductSeo(id);
    return this.getShowcaseSeo(id);
  }

  async upsertAdminSeo(
    kind: SeoKind,
    id: string,
    input: StoreSeoDto | ProductSeoDto | ShowcaseSeoDto,
    actor: AdminActor,
  ) {
    await this.requireAdmin(actor.id);
    const data = await this.validated(
      kind === 'store'
        ? StoreSeoDto
        : kind === 'product'
          ? ProductSeoDto
          : ShowcaseSeoDto,
      input,
    );
    const saved = await adminContext.run(actor, () =>
      this.adminWrite(
        actor.id,
        'metadata.update',
        id,
        Object.keys(data),
        async (manager) => {
          if (kind === 'store') {
            const store = await manager.findOneBy(Store, { id });
            if (!store) throw new NotFoundException('Store not found');
            await this.checkMetadata(data, store.ownerId);
            const seo =
              (await manager.findOneBy(StoreSeo, { storeId: id })) ??
              manager.create(StoreSeo, { storeId: id });
            this.applySeoInput(seo, data);
            return manager.save(seo);
          }
          if (kind === 'product') {
            const product = await manager.findOne(Product, {
              where: { id },
              relations: ['store'],
            });
            if (!product) throw new NotFoundException('Product not found');
            await this.checkMetadata(data, product.store.ownerId);
            const seo =
              (await manager.findOneBy(ProductSeo, { productId: id })) ??
              manager.create(ProductSeo, {
                productId: id,
                storeId: product.storeId,
              });
            this.applySeoInput(seo, data);
            return manager.save(seo);
          }
          const post = await manager.findOneBy(Showcase, { id });
          if (!post) throw new NotFoundException('Post not found');
          await this.checkMetadata(data, post.ownerId);
          const seo =
            (await manager.findOneBy(ShowcaseSeo, { showcaseId: id })) ??
            manager.create(ShowcaseSeo, {
              showcaseId: id,
              storeId: post.storeId,
            });
          this.applySeoInput(seo, data);
          return manager.save(seo);
        },
      ),
    );
    this.contentChanged();
    return saved;
  }

  private async ownedEntity(
    kind: SeoKind,
    id: string,
    actorId: string,
    manager: EntityManager = this.dataSource.manager,
  ) {
    if (kind === 'store') {
      const store = await manager.findOneBy(Store, {
        id,
        ownerId: actorId,
        ...ownerWhere('store'),
      });
      if (!store) throw new NotFoundException('Store not found');
      return { store, product: null, showcase: null, ownerId: actorId };
    }
    if (kind === 'product') {
      const product = await manager.findOne(Product, {
        where: { id, ...ownerWhere('product') },
        relations: ['store'],
      });
      if (!product) throw new NotFoundException('Product not found');
      // Team members author the shop's metadata for the owner's account.
      const access = await storeAccess(manager, actorId, product.storeId);
      if (!access) throw new NotFoundException('Product not found');
      return {
        store: product.store,
        product,
        showcase: null,
        ownerId: access.ownerId,
      };
    }
    const showcase = await manager.findOne(Showcase, {
      where: { id, ...ownerWhere('post') },
      relations: ['store'],
    });
    if (!showcase) throw new NotFoundException('Post not found');
    if (showcase.storeId) {
      const access = await storeAccess(manager, actorId, showcase.storeId);
      if (!access) throw new NotFoundException('Post not found');
      return {
        store: showcase.store ?? null,
        product: null,
        showcase,
        ownerId: access.ownerId,
      };
    }
    if (showcase.ownerId !== actorId)
      throw new NotFoundException('Post not found');
    return {
      store: null,
      product: null,
      showcase,
      ownerId: actorId,
    };
  }

  async getOwnedSeo(kind: SeoKind, id: string, actorId: string) {
    await this.ownedEntity(kind, id, actorId);
    if (kind === 'store') return this.getStoreSeo(id);
    if (kind === 'product') return this.getProductSeo(id);
    return this.getShowcaseSeo(id);
  }

  private ownerWrite<T>(
    kind: SeoKind,
    id: string,
    actorId: string,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      // The shop owner owns the metadata row even when a team member saves it.
      const { ownerId } = await this.ownedEntity(kind, id, actorId, manager);
      await lockOwnerContent(
        manager,
        kind === 'showcase' ? 'post' : kind,
        id,
        ownerId,
      );
      // Tenant SEO is owner-authored content and is read-only after expiry.
      await assertSubscriptionActive(manager, ownerId);
      return work(manager);
    });
  }

  async autoGenerateOwnedSeo(kind: SeoKind, id: string, actorId: string) {
    const saved = await this.ownerWrite(kind, id, actorId, async (manager) => {
      const { store, product, showcase } = await this.ownedEntity(
        kind,
        id,
        actorId,
        manager,
      );
      const scoped = this.scoped(manager);
      if (showcase) return scoped.autoGenerateShowcaseSeo(showcase, store);
      if (product && store)
        return scoped.autoGenerateProductSeo(product, store);
      return scoped.autoGenerateStoreSeo(store!);
    });
    this.contentChanged();
    return saved;
  }

  async getMetaBySlug(
    kind: SeoKind,
    slug: string,
    storeSlug?: string,
  ): Promise<MetaTags> {
    const manager = this.dataSource.manager;
    if (kind === 'store') {
      const store = await manager.findOneBy(Store, {
        slug,
        ...publicWhere('store'),
      });
      if (!store) throw new NotFoundException('Store not found');
      return this.generateStoreMetaTags(store);
    }
    if (kind === 'product') {
      // Honor optional store context and reject ambiguous legacy slug data.
      const products = await manager.find(Product, {
        where: {
          slug,
          ...publicWhere('product'),
          status: In([...PUBLIC_PRODUCT_STATUSES]),
          ...(storeSlug ? { store: { slug: storeSlug } } : {}),
        },
        relations: ['store'],
        take: 2,
      });
      if (!products.length) throw new NotFoundException('Product not found');
      if (products.length !== 1)
        throw new BadRequestException('Specify storeSlug for this product');
      return this.generateProductMetaTags(products[0]!, products[0]!.store);
    }
    const showcase = await manager.findOne(Showcase, {
      where: {
        slug,
        status: ShowcaseStatus.PUBLISHED,
        ...publicWhere('post'),
      },
      relations: ['store'],
    });
    if (!showcase) throw new NotFoundException('Post not found');
    return this.generateShowcaseMetaTags(showcase, showcase.store ?? null);
  }

  /**
   * Minimal server-rendered page for shared links. With the Vhost crawler rule
   * this answers bots at the clean /stores/... URL; the app's share buttons
   * call the endpoint directly when that rule is not installed. Crawlers read
   * the tags; every other client is forwarded to the SPA page.
   */
  async renderShareHtml(path: string, userAgent?: string): Promise<string> {
    const meta = await this.getPageMeta(path);
    return renderShareDocument(
      meta,
      isShareCrawler(userAgent) || meta.canonical === this.baseUrl
        ? undefined
        : meta.canonical,
    );
  }

  /** One public metadata resolver for browsers and non-JavaScript crawlers. */
  async getPageMeta(path: string): Promise<MetaTags> {
    if (typeof path !== 'string' || path.length > 2048)
      throw new NotFoundException('Page not found');
    const target = path.replace(/[?#].*$/u, '').replace(/^\/+|\/+$/gu, '');
    if (!target) return this.generateSiteMetaTags();
    const pages: Record<string, string> = {
      shops: 'All shops',
      pricing: 'Plans & pricing',
      terms: 'Terms of service',
      privacy: 'Privacy policy',
      favorites: 'Favorite shops',
    };
    if (Object.hasOwn(pages, target)) {
      const site = await this.generateSiteMetaTags();
      return this.generateGenericMetaTags(`/${target}`, {
        title: `${pages[target]} — ${site.og.siteName}`,
        robots:
          target === 'favorites'
            ? RobotsDirective.NOINDEX_NOFOLLOW
            : RobotsDirective.INDEX_FOLLOW,
      });
    }
    const route = SHARE_STORE_ROUTE.exec(target);
    let meta: MetaTags;
    if (route?.[1]) {
      const store = await this.dataSource.manager.findOneBy(Store, {
        slug: route[1],
        ...publicWhere('store'),
      });
      if (!store) throw new NotFoundException('Page not found');
      // Post links carry their shop, so the storefront route answers them too.
      meta = route[4]
        ? await this.generatePostShareMeta(route[4], store.id)
        : await this.shareMetaFor(store, route[2], route[3]);
    } else {
      const post = SHARE_POST_ROUTE.exec(target);
      if (!post?.[1]) throw new NotFoundException('Page not found');
      meta = await this.generatePostShareMeta(post[1]);
    }
    return meta;
  }

  /** Published post metadata by its own slug, optionally scoped to a shop. */
  private async generatePostShareMeta(
    slug: string,
    storeId?: string,
  ): Promise<MetaTags> {
    const showcase = await this.dataSource.manager.findOne(Showcase, {
      where: {
        slug,
        status: ShowcaseStatus.PUBLISHED,
        ...(storeId ? { storeId } : {}),
        ...publicWhere('post'),
      },
      relations: ['store'],
    });
    if (!showcase) throw new NotFoundException('Page not found');
    return this.generateShowcaseMetaTags(showcase, showcase.store ?? null);
  }

  private async shareMetaFor(
    store: Store,
    kind?: string,
    slug?: string,
  ): Promise<MetaTags> {
    if (kind === 'p' && slug) {
      const product = await this.dataSource.manager.findOneBy(Product, {
        slug,
        storeId: store.id,
        status: In([...PUBLIC_PRODUCT_STATUSES]),
        ...publicWhere('product'),
      });
      if (!product) throw new NotFoundException('Page not found');
      return this.generateProductMetaTags(product, store);
    }
    if (kind === 'c' && slug) {
      if (slug === 'more-items') {
        return this.generateUncategorizedShareMeta(store);
      }
      const categories = await this.dataSource.manager.find(StoreCategory, {
        where: { storeId: store.id },
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
      const category = categories.find(
        (entry) => this.categoryPathSlug(entry.name) === slug,
      );
      if (!category) throw new NotFoundException('Page not found');
      return this.generateCategoryMetaTags(store, category);
    }
    return this.generateStoreMetaTags(store);
  }

  /** Meta for the "More items" section (products without an owner category). */
  async generateUncategorizedShareMeta(store: Store): Promise<MetaTags> {
    return this.generateCategoryPageMeta(store, 'More items', {
      storeId: store.id,
      categoryId: IsNull(),
      status: In([...PUBLIC_PRODUCT_STATUSES]),
      ...publicWhere('product'),
    });
  }

  async generateCategoryMetaTags(
    store: Store,
    category: StoreCategory,
  ): Promise<MetaTags> {
    return this.generateCategoryPageMeta(store, category.name, {
      storeId: store.id,
      categoryId: category.id,
      status: In([...PUBLIC_PRODUCT_STATUSES]),
      ...publicWhere('product'),
    });
  }

  private async generateCategoryPageMeta(
    store: Store,
    name: string,
    where: Record<string, unknown>,
  ): Promise<MetaTags> {
    const manager = this.dataSource.manager;
    const settings = await this.getSettings();
    const [count, first] = await Promise.all([
      manager.count(Product, { where }),
      manager.findOne(Product, {
        where,
        order: { sortOrder: 'ASC', createdAt: 'DESC' },
      }),
    ]);
    const title = `${name} — ${store.name}`;
    // Menu sections are shared as menu sections, matching the storefront label.
    const description = this.isMenuStore(store)
      ? `Explore ${count} ${count === 1 ? 'item' : 'items'} in ${name}, a menu section at ${store.name}.`
      : `${count} ${count === 1 ? 'item' : 'items'} in ${name} at ${store.name}.`;
    const canonical = `${this.baseUrl}/stores/${store.slug}/c/${this.categoryPathSlug(name)}`;
    // A current banner leads, then a dish photo, and the logo card last: a
    // replaced banner must not stay hidden behind an older generated card.
    const ogImage =
      (await this.buildStoreImageUrl(store, store.bannerKey)) ??
      (first ? await this.buildProductImageUrl(first) : undefined) ??
      (await this.buildStoreShareImageUrl(store)) ??
      (await this.buildStoreImageUrl(store, store.logoKey)) ??
      (await this.latestStoreImageUrl(store.id)) ??
      (await this.defaultSharingImage(settings)) ??
      this.fallbackSharingImage();
    return {
      title: this.truncate(title, 60),
      description: this.truncate(description, 160),
      robots: RobotsDirective.INDEX_FOLLOW,
      canonical,
      og: {
        title: this.truncate(title, 60),
        description: this.truncate(description, 160),
        image: ogImage,
        type: 'website',
        siteName: settings.siteName,
        url: canonical,
        locale: 'en_US',
      },
      twitter: {
        card: ogImage ? 'summary_large_image' : 'summary',
        title: this.truncate(title, 70),
        description: this.truncate(description, 200),
        image: ogImage,
      },
    };
  }

  /**
   * One canonical shape for a shared post: shop posts stay inside the shop so
   * the crawler rule and the prerendered shells cover them, while posts without
   * a shop use the platform path.
   */
  postPath(
    post: Pick<Showcase, 'slug'>,
    store: Pick<Store, 'slug'> | null,
  ): string {
    return store
      ? `/stores/${store.slug}/post/${post.slug}`
      : `/post/${post.slug}`;
  }

  // Category rows have no slug column; mirror the storefront's name slug so a
  // shared /c/ link resolves to the same section.
  categoryPathSlug(name: string): string {
    const base = name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .slice(0, 80)
      .replace(/^-+|-+$/gu, '');
    if (base) return base;
    let hash = 2166136261;
    for (const char of name.trim() || 'category') {
      hash ^= char.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    return `category-${(hash >>> 0).toString(36).padStart(6, '0').slice(0, 6)}`;
  }

  private assertSiteUrl(value: string): void {
    try {
      const url = new URL(value);
      if (
        url.origin === new URL(this.baseUrl).origin &&
        !url.username &&
        !url.password
      )
        return;
    } catch {
      /* Invalid URLs fail closed. */
    }
    throw new BadRequestException('URL must belong to the application origin');
  }

  private async checkMetadata(
    data: { canonicalUrl?: string | null; ogImageKey?: string | null },
    actorId: string,
  ) {
    if (data.canonicalUrl) this.assertSiteUrl(data.canonicalUrl);
    if (data.ogImageKey) {
      const variant = await this.dataSource.manager.findOne(MediaVariant, {
        where: {
          storageKey: data.ogImageKey,
          asset: {
            showcase: { ownerId: actorId },
            status: MediaStatus.READY,
            ...ownerWhere('media'),
          },
        },
      });
      if (!variant)
        throw new BadRequestException(
          'Image must be an owned ready media variant',
        );
    }
  }

  async getAdminSettings(actorId: string): Promise<SeoSettings> {
    await this.requireAdmin(actorId);
    const [stored, resolved] = await Promise.all([
      this.getSettings(false),
      this.getSettings(true),
    ]);
    // The admin form edits overrides. Show an inherited title or description
    // as empty (its placeholder follows the live branding) so a copy frozen by
    // an earlier rename is not presented as the administrator's own copy.
    return {
      ...stored,
      siteName: resolved.siteName,
      defaultTitle: resolved.defaultTitle,
      defaultDescription: resolved.defaultDescription,
      indexNowKey: null,
    };
  }

  private async getSettings(resolveBranding = true): Promise<SeoSettings> {
    // The migration seeds settings. Reads must not create competing singleton
    // rows, and TypeORM findOne requires a where clause.
    const [settings] = await this.settingsRepo.find({
      take: 1,
      order: { createdAt: 'ASC' },
    });
    if (!settings)
      throw new ServiceUnavailableException('SEO settings are unavailable');
    if (!resolveBranding) return settings;
    const branding = await this.dataSource.manager.findOneBy(WebsiteSettings, {
      id: 1,
    });
    const siteName = branding?.siteName?.trim() || settings.siteName;
    const brandingTitle = [siteName, branding?.tagline?.trim()]
      .filter(Boolean)
      .join(' — ');
    const storedName = settings.siteName?.trim() || '';
    // A title that merely repeats the branding is not an override: earlier
    // forms persisted those copies, which froze the previous website name.
    // The stored SEO name still holds the brand the copy was written under;
    // only while it differs from the live name is a `Name — …` title treated
    // as inherited, so a deliberately branded custom title is preserved after
    // the row has been aligned with the current branding.
    const inheritedPrefixes =
      storedName && storedName !== siteName
        ? [`${storedName} — `, `${storedName} - `]
        : [];
    const tagline = branding?.tagline?.trim() ?? '';
    const inheritedTitles = new Set(
      [
        LEGACY_SEO_TITLE,
        siteName,
        // A title that is only the tagline (an older form could save that
        // when the name was empty) must not hide the website name.
        tagline,
        brandingTitle,
        brandingTitle.replace(' — ', ' - '),
        storedName,
      ].filter(Boolean),
    );
    // Website settings own the brand identity. SEO fields are optional
    // overrides, not a second frozen copy of the website name and images.
    return {
      ...settings,
      siteName,
      defaultTitle:
        inheritedTitles.has(settings.defaultTitle ?? '') ||
        inheritedPrefixes.some((prefix) =>
          (settings.defaultTitle ?? '').startsWith(prefix),
        )
          ? null
          : settings.defaultTitle,
      defaultDescription:
        settings.defaultDescription === LEGACY_SEO_DESCRIPTION ||
        (branding?.description &&
          settings.defaultDescription === branding.description)
          ? null
          : settings.defaultDescription,
      defaultOgImageUrl:
        settings.defaultOgImageUrl ||
        (!settings.defaultOgImageKey
          ? branding?.bannerUrl || '/banner.jpg'
          : null) ||
        null,
      // The organization name was prefilled from the brand by earlier forms;
      // a copy of the stored SEO name is inherited, not a custom override.
      organizationName:
        !settings.organizationName || settings.organizationName === storedName
          ? siteName
          : settings.organizationName,
      organizationLogoUrl:
        settings.organizationLogoUrl ||
        (!settings.organizationLogoKey ? branding?.logoUrl : null) ||
        null,
    };
  }

  async updateSettings(
    data: SeoSettingsDto,
    actorId: string,
  ): Promise<SeoSettings> {
    await this.requireAdmin(actorId);
    data = await this.validated(SeoSettingsDto, data);
    if (data.indexNowKeyLocation) this.assertSiteUrl(data.indexNowKeyLocation);
    for (const key of [data.defaultOgImageKey, data.organizationLogoKey]) {
      if (key && !(await this.buildImageUrl(key)))
        throw new BadRequestException('Image must be a public ready variant');
    }
    const saved = await this.adminWrite(
      actorId,
      'settings.update',
      'global',
      Object.keys(data),
      async (manager) => {
        const [settings] = await manager.find(SeoSettings, {
          take: 1,
          order: { createdAt: 'ASC' },
        });
        if (!settings)
          throw new ServiceUnavailableException('SEO settings are unavailable');
        Object.assign(
          settings,
          Object.fromEntries(
            Object.entries(data).filter(([, value]) => value !== undefined),
          ),
        );
        return { ...(await manager.save(settings)), indexNowKey: null };
      },
    );
    // The home preview and every fallback image read these defaults.
    this.contentChanged();
    return saved;
  }

  // ============================================
  // Store SEO
  // ============================================

  private async getStoreSeo(storeId: string): Promise<StoreSeo | null> {
    return this.storeSeoRepo.findOneBy({ storeId });
  }

  async upsertStoreSeo(
    storeId: string,
    data: StoreSeoDto,
    actorId: string,
  ): Promise<StoreSeo> {
    await this.ownedEntity('store', storeId, actorId);
    data = await this.validated(StoreSeoDto, data);
    await this.checkMetadata(data, actorId);
    let seo = await this.storeSeoRepo.findOneBy({ storeId });
    if (!seo) {
      seo = this.storeSeoRepo.create({ storeId, ...data });
    } else {
      this.applySeoInput(seo, data);
    }
    const saved = await this.ownerWrite('store', storeId, actorId, (manager) =>
      manager.save(seo),
    );
    this.contentChanged();
    return saved;
  }

  async deleteStoreSeo(storeId: string, actorId: string): Promise<void> {
    await this.ownedEntity('store', storeId, actorId);
    await this.ownerWrite('store', storeId, actorId, (manager) =>
      manager.delete(StoreSeo, { storeId }),
    );
    this.contentChanged();
  }

  // ============================================
  // Product SEO
  // ============================================

  private async getProductSeo(productId: string): Promise<ProductSeo | null> {
    return this.productSeoRepo.findOneBy({ productId });
  }

  async upsertProductSeo(
    productId: string,
    data: ProductSeoDto,
    actorId: string,
  ): Promise<ProductSeo> {
    const { product, ownerId } = await this.ownedEntity(
      'product',
      productId,
      actorId,
    );
    const storeId = product!.storeId;
    data = await this.validated(ProductSeoDto, data);
    await this.checkMetadata(data, ownerId);
    let seo = await this.productSeoRepo.findOneBy({ productId });
    if (!seo) {
      seo = this.productSeoRepo.create({ productId, storeId, ...data });
    } else {
      this.applySeoInput(seo, data);
    }
    const saved = await this.ownerWrite(
      'product',
      productId,
      actorId,
      (manager) => manager.save(seo),
    );
    this.contentChanged();
    return saved;
  }

  async deleteProductSeo(productId: string, actorId: string): Promise<void> {
    await this.ownedEntity('product', productId, actorId);
    await this.ownerWrite('product', productId, actorId, (manager) =>
      manager.delete(ProductSeo, { productId }),
    );
    this.contentChanged();
  }

  // ============================================
  // Showcase/Post SEO
  // ============================================

  private async getShowcaseSeo(
    showcaseId: string,
  ): Promise<ShowcaseSeo | null> {
    return this.showcaseSeoRepo.findOneBy({ showcaseId });
  }

  async upsertShowcaseSeo(
    showcaseId: string,
    data: ShowcaseSeoDto,
    actorId: string,
  ): Promise<ShowcaseSeo> {
    const { showcase, ownerId } = await this.ownedEntity(
      'showcase',
      showcaseId,
      actorId,
    );
    const storeId = showcase!.storeId;
    data = await this.validated(ShowcaseSeoDto, data);
    await this.checkMetadata(data, ownerId);
    let seo = await this.showcaseSeoRepo.findOneBy({ showcaseId });
    if (!seo) {
      seo = this.showcaseSeoRepo.create({ showcaseId, storeId, ...data });
    } else {
      this.applySeoInput(seo, data);
    }
    const saved = await this.ownerWrite(
      'showcase',
      showcaseId,
      actorId,
      (manager) => manager.save(seo),
    );
    this.contentChanged();
    return saved;
  }

  async deleteShowcaseSeo(showcaseId: string, actorId: string): Promise<void> {
    await this.ownedEntity('showcase', showcaseId, actorId);
    await this.ownerWrite('showcase', showcaseId, actorId, (manager) =>
      manager.delete(ShowcaseSeo, { showcaseId }),
    );
    this.contentChanged();
  }

  // ============================================
  // Redirects
  // ============================================

  async getRedirect(fromPath: string): Promise<SeoRedirect | null> {
    return this.redirectRepo.findOneBy({ fromPath, isActive: true });
  }

  async getRedirects(
    actorId: string,
    storeId?: string,
  ): Promise<SeoRedirect[]> {
    await this.requireAdmin(actorId);
    const where = storeId ? { storeId, isActive: true } : { isActive: true };
    return this.redirectRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async createRedirect(
    data: CreateRedirectDto,
    actorId: string,
  ): Promise<SeoRedirect> {
    await this.requireAdmin(actorId);
    data = await this.validated(CreateRedirectDto, data);
    this.assertSiteUrl(new URL(data.fromPath, this.baseUrl).href);
    this.assertSiteUrl(new URL(data.toPath, this.baseUrl).href);
    const existing = await this.redirectRepo.findOneBy({
      fromPath: data.fromPath!,
    });
    if (existing) {
      throw new BadRequestException('Redirect for this path already exists');
    }
    const id = randomUUID();
    return this.adminWrite(
      actorId,
      'redirect.create',
      id,
      Object.keys(data),
      async (manager) =>
        manager.save(manager.create(SeoRedirect, { ...data, id })),
    );
  }

  async updateRedirect(
    id: string,
    data: UpdateRedirectDto,
    actorId: string,
  ): Promise<SeoRedirect> {
    await this.requireAdmin(actorId);
    data = await this.validated(UpdateRedirectDto, data);
    if (data.fromPath)
      this.assertSiteUrl(new URL(data.fromPath, this.baseUrl).href);
    if (data.toPath)
      this.assertSiteUrl(new URL(data.toPath, this.baseUrl).href);
    return this.adminWrite(
      actorId,
      'redirect.update',
      id,
      Object.keys(data),
      async (manager) => {
        const redirect = await manager.findOne(SeoRedirect, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!redirect) throw new NotFoundException('Redirect not found');
        Object.assign(redirect, data);
        return manager.save(redirect);
      },
    );
  }

  async deleteRedirect(id: string, actorId: string): Promise<void> {
    await this.requireAdmin(actorId);
    await this.updateRedirect(id, { isActive: false }, actorId);
  }

  // ============================================
  // AUTOMATIC SEO GENERATION (Core Feature)
  // ============================================

  private automaticSeoDraft<T extends StoreSeo | ProductSeo | ShowcaseSeo>(
    saved: T | null,
  ): T | null {
    if (!saved) return null;
    const draft = Object.assign(
      Object.create(Object.getPrototypeOf(saved)),
      saved,
    ) as T;
    // Only recorded automatic fields are replaced. Public reads render fresh
    // defaults without writing rows or overwriting an editor's custom copy.
    const automatic = new Set([
      'metaTitle',
      'metaDescription',
      'metaKeywords',
      'ogTitle',
      'ogDescription',
      'ogImageKey',
      'ogSiteName',
      'twitterSite',
      'articleAuthor',
      'articlePublishedTime',
      'articleModifiedTime',
    ]);
    for (const field of saved.autoGeneratedFields ?? []) {
      if (automatic.has(field)) Reflect.set(draft, field, null);
    }
    return draft;
  }

  private applySeoInput(
    seo: StoreSeo | ProductSeo | ShowcaseSeo,
    data: StoreSeoDto | ProductSeoDto | ShowcaseSeoDto,
  ): void {
    // Full forms also submit untouched generated values. Only changed fields
    // become manual overrides; clearing a value opts back into live defaults.
    const changed = new Set(
      Object.entries(data)
        .filter(
          ([key, value]) =>
            value !== undefined &&
            JSON.stringify(value) !== JSON.stringify(Reflect.get(seo, key)),
        )
        .map(([key]) => key),
    );
    seo.autoGeneratedFields = (seo.autoGeneratedFields ?? []).filter(
      (key) => !changed.has(key),
    );
    Object.assign(
      seo,
      Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined),
      ),
    );
  }

  /**
   * Automatically generates SEO meta tags from entity content.
   * Called when SEO record doesn't exist or when auto-regeneration is triggered.
   * Users never need to manually configure SEO - it works out of the box.
   */
  async autoGenerateStoreSeo(store: Store, persist = true): Promise<StoreSeo> {
    let seo = this.automaticSeoDraft(await this.getStoreSeo(store.id));
    const settings = await this.getSettings();
    const autoFields: string[] = [];

    if (!seo) {
      seo = this.storeSeoRepo.create({ storeId: store.id });
    }

    // A menu shop is shared as a menu, so its generated copy says so from the
    // start instead of reading like a generic product shop.
    const menu = this.isMenuStore(store);
    const menuLine = menu ? await this.menuPreviewLine(store) : '';
    const menuDescription = menu
      ? this.withMenuLine(store.description ?? '', menuLine)
      : store.description || '';

    // Auto-generate meta title from store name
    if (!seo.metaTitle) {
      seo.metaTitle = this.generateMetaTitle(
        menu ? this.withMenuTitle(store.name) : store.name,
        settings.siteName,
      );
      autoFields.push('metaTitle');
    }

    // Auto-generate meta description from store description
    if (!seo.metaDescription) {
      seo.metaDescription = this.generateMetaDescription(menuDescription, 160);
      autoFields.push('metaDescription');
    }

    // Auto-generate keywords from store type and categories
    if (!seo.metaKeywords) {
      seo.metaKeywords = this.generateKeywords([
        store.storeType,
        businessCategoryLabel(store.businessCategory),
        ...(menu ? ['menu', 'restaurant', 'food'] : ['shop', 'online store']),
        settings.siteName,
      ]);
      autoFields.push('metaKeywords');
    }

    // Auto-generate OG tags
    if (!seo.ogTitle) {
      seo.ogTitle = menu ? this.withMenuTitle(store.name) : store.name;
      autoFields.push('ogTitle');
    }
    if (!seo.ogDescription) {
      seo.ogDescription = this.generateMetaDescription(menuDescription, 160);
      autoFields.push('ogDescription');
    }
    // Resolve automatic images at render time. Persisting the logo here made
    // it look like an explicit override and hid the generated share card.
    if (!seo.ogImageKey) autoFields.push('ogImageKey');
    // The website name is not editable per shop. A stored value that differs
    // from the live branding is a leftover from before a rename.
    if (!seo.ogSiteName || seo.ogSiteName !== settings.siteName) {
      seo.ogSiteName = settings.siteName;
      autoFields.push('ogSiteName');
    }

    // Auto-generate Twitter tags
    if (!seo.twitterSite) {
      seo.twitterSite = settings.twitterSite || null;
      autoFields.push('twitterSite');
    }

    // Set defaults for robots and AI
    seo.robots = seo.robots || RobotsDirective.INDEX_FOLLOW;
    seo.aiRobots = seo.aiRobots || AiRobotsDirective.ALLOW;
    seo.aiTraining = seo.aiTraining || AiRobotsDirective.TRAINING_DISALLOW;

    // Compute content hash for change detection
    const contentHash = this.computeContentHash({
      name: store.name,
      description: store.description,
      storeType: store.storeType,
      businessCategory: store.businessCategory,
      logoKey: store.logoKey,
    });
    seo.contentHash = contentHash;
    seo.autoGeneratedFields = autoFields;
    seo.lastAutoGeneratedAt = new Date();

    return persist ? this.storeSeoRepo.save(seo) : seo;
  }

  async autoGenerateProductSeo(
    product: Product,
    store: Store,
    persist = true,
  ): Promise<ProductSeo> {
    let seo = this.automaticSeoDraft(await this.getProductSeo(product.id));
    const settings = await this.getSettings();
    const autoFields: string[] = [];

    if (!seo) {
      seo = this.productSeoRepo.create({
        productId: product.id,
        storeId: store.id,
      });
    }

    // Auto-generate meta title: "Product Name - Store Name"
    if (!seo.metaTitle) {
      seo.metaTitle = this.generateMetaTitle(
        `${product.name} - ${store.name}`,
        settings.siteName,
      );
      autoFields.push('metaTitle');
    }

    // Auto-generate meta description from product description
    if (!seo.metaDescription) {
      seo.metaDescription = this.generateMetaDescription(
        product.description ||
          (this.isMenuStore(store)
            ? `Order ${product.name} from the ${store.name} menu.`
            : `Buy ${product.name} from ${store.name}`),
        160,
      );
      autoFields.push('metaDescription');
    }

    // Auto-generate keywords from product category, name, store
    if (!seo.metaKeywords) {
      seo.metaKeywords = this.generateKeywords([
        product.category,
        product.name,
        store.name,
        store.storeType,
        ...(this.isMenuStore(store) ? ['menu', 'order food'] : ['buy', 'shop']),
      ]);
      autoFields.push('metaKeywords');
    }

    // Auto-generate OG tags
    if (!seo.ogTitle) {
      seo.ogTitle = product.name;
      autoFields.push('ogTitle');
    }
    if (!seo.ogDescription) {
      seo.ogDescription = this.generateMetaDescription(
        product.description || '',
        160,
      );
      autoFields.push('ogDescription');
    }
    if (!seo.ogImageKey) {
      seo.ogImageKey =
        product.imageKeys?.[0] ||
        store.logoKey ||
        settings.defaultOgImageKey ||
        null;
      autoFields.push('ogImageKey');
    }

    // Auto-fill product identifiers if available
    if (!seo.sku) seo.sku = product.sku || null;
    if (!seo.gtin) seo.gtin = null; // Would come from product data
    if (!seo.mpn) seo.mpn = null;
    if (!seo.brand) seo.brand = store.name;

    // Set defaults for robots and AI
    seo.robots = seo.robots || RobotsDirective.INDEX_FOLLOW;
    seo.aiRobots = seo.aiRobots || AiRobotsDirective.ALLOW;
    seo.aiTraining = seo.aiTraining || AiRobotsDirective.TRAINING_DISALLOW;

    const contentHash = this.computeContentHash({
      name: product.name,
      description: product.description,
      category: product.category,
      priceCents: product.priceCents,
      currency: product.currency,
      status: product.status,
      imageKeys: product.imageKeys,
    });
    seo.contentHash = contentHash;
    seo.autoGeneratedFields = autoFields;
    seo.lastAutoGeneratedAt = new Date();

    return persist ? this.productSeoRepo.save(seo) : seo;
  }

  async autoGenerateShowcaseSeo(
    showcase: Showcase,
    store: Store | null,
    persist = true,
  ): Promise<ShowcaseSeo> {
    let seo = this.automaticSeoDraft(await this.getShowcaseSeo(showcase.id));
    const settings = await this.getSettings();
    const autoFields: string[] = [];

    if (!seo) {
      seo = this.showcaseSeoRepo.create({
        showcaseId: showcase.id,
        storeId: showcase.storeId ?? null,
      });
    }

    // Auto-generate meta title from showcase title
    if (!seo.metaTitle) {
      seo.metaTitle = this.generateMetaTitle(showcase.title, settings.siteName);
      autoFields.push('metaTitle');
    }

    // Auto-generate meta description from showcase description
    if (!seo.metaDescription) {
      seo.metaDescription = this.generateMetaDescription(
        showcase.description || showcase.title,
        160,
      );
      autoFields.push('metaDescription');
    }

    // Auto-generate keywords from tags, store, content
    if (!seo.metaKeywords) {
      const keywords = [
        showcase.title,
        store?.name,
        'post',
        'article',
        ...(seo.articleTags || []),
      ].filter(Boolean);
      seo.metaKeywords = this.generateKeywords(keywords);
      autoFields.push('metaKeywords');
    }

    // Auto-generate OG tags
    if (!seo.ogTitle) {
      seo.ogTitle = showcase.title;
      autoFields.push('ogTitle');
    }
    if (!seo.ogDescription) {
      seo.ogDescription = this.generateMetaDescription(
        showcase.description || '',
        160,
      );
      autoFields.push('ogDescription');
    }
    // ogImageKey stays empty on purpose: generateShowcaseMetaTags resolves the
    // post's first photo or video poster at render time, so reordered media
    // never leaves a stale key behind. The shop logo is only a last-resort
    // fallback there.

    // Article-specific auto-generation
    if (!seo.articleAuthor) {
      seo.articleAuthor = store?.name || settings.siteName;
      autoFields.push('articleAuthor');
    }
    if (!seo.articlePublishedTime && showcase.publishedAt) {
      seo.articlePublishedTime = showcase.publishedAt;
      autoFields.push('articlePublishedTime');
    }
    if (!seo.articleModifiedTime) {
      seo.articleModifiedTime = showcase.updatedAt;
      autoFields.push('articleModifiedTime');
    }

    // Set defaults
    seo.robots = seo.robots || RobotsDirective.INDEX_FOLLOW;
    seo.aiRobots = seo.aiRobots || AiRobotsDirective.ALLOW;
    seo.aiTraining = seo.aiTraining || AiRobotsDirective.TRAINING_DISALLOW;

    const contentHash = this.computeContentHash({
      title: showcase.title,
      description: showcase.description,
      status: showcase.status,
      storeId: showcase.storeId,
    });
    seo.contentHash = contentHash;
    seo.autoGeneratedFields = autoFields;
    seo.lastAutoGeneratedAt = new Date();

    return persist ? this.showcaseSeoRepo.save(seo) : seo;
  }

  /**
   * Regenerates SEO for an entity if content has changed (hash mismatch).
   * Can be called periodically or on content update.
   */
  async regenerateIfContentChanged(
    entityType: 'store' | 'product' | 'showcase',
    entityId: string,
    currentContent: Record<string, unknown>,
  ): Promise<void> {
    let seo: StoreSeo | ProductSeo | ShowcaseSeo | null = null;

    if (entityType === 'store') {
      seo = await this.getStoreSeo(entityId);
    } else if (entityType === 'product') {
      seo = await this.getProductSeo(entityId);
    } else {
      seo = await this.getShowcaseSeo(entityId);
    }

    if (!seo) return;

    const newHash = this.computeContentHash(currentContent);
    if (seo.contentHash !== newHash) {
      // Content changed, re-generate auto fields
      // Implementation would re-run auto-generation for auto-managed fields
      // This is a placeholder for the actual logic
    }
  }

  // ============================================
  // Meta Tags Generation (Enhanced with Auto-Fallback)
  // ============================================

  /**
   * Home page metadata. The built index.html is static, so a shared site link
   * would keep advertising whatever title and image it was compiled with; this
   * follows the live website branding and the administrator's sharing defaults.
   */
  async generateSiteMetaTags(): Promise<MetaTags> {
    const settings = await this.getSettings();
    // Branding is edited in its own table; a missing row must not take the
    // home preview down, so SEO defaults remain the fallback.
    const branding = await this.dataSource.manager
      .findOneBy(WebsiteSettings, { id: 1 })
      .catch(() => null);
    const siteName = branding?.siteName?.trim() || settings.siteName;
    const tagline = branding?.tagline?.trim() || '';
    // Explicit SEO copy wins; empty defaults inherit live website branding.
    // A stored copy of only the tagline (possible with older forms) is not a
    // complete title: the website name belongs in front of it.
    const customTitle = settings.defaultTitle?.trim() ?? '';
    const title = this.withNameTitle(customTitle || tagline, siteName);
    const description =
      settings.defaultDescription?.trim() ||
      branding?.description?.trim() ||
      '';
    const brandingImage = branding?.bannerUrl || branding?.logoUrl;
    const ogImage =
      (await this.defaultSharingImage(settings)) ||
      (brandingImage ? await this.publicImageUrl(brandingImage) : undefined) ||
      this.fallbackSharingImage();
    return {
      title: this.truncate(title, 60),
      description: this.truncate(description, 160),
      robots: RobotsDirective.INDEX_FOLLOW,
      canonical: this.baseUrl,
      og: {
        title: this.truncate(title, 60),
        description: this.truncate(description, 160),
        image: ogImage,
        type: 'website',
        siteName,
        url: this.baseUrl,
        locale: 'en_US',
      },
      twitter: {
        card: ogImage ? 'summary_large_image' : 'summary',
        site: settings.twitterSite ?? undefined,
        title: this.truncate(title, 70),
        description: this.truncate(description, 200),
        image: ogImage,
      },
      jsonLd: await this.buildSiteJsonLd(settings),
      verificationMeta: this.buildVerificationMeta(settings),
    };
  }

  async generateStoreMetaTags(store: Store): Promise<MetaTags> {
    const seo = await this.autoGenerateStoreSeo(store, false);
    const settings = await this.getSettings();

    // A menu shop must read as a menu in every preview. Owner copy is kept and
    // the menu line only joins it when the owner did not mention a menu.
    const menu = this.isMenuStore(store);
    const menuLine = menu ? await this.menuPreviewLine(store) : '';
    // Never fall back to a build-time brand: the website settings own the name.
    const title = this.withNameTitle(seo.metaTitle || '', store.name);
    const description =
      seo.metaDescription ||
      store.description ||
      (menu ? '' : settings.defaultDescription) ||
      '';
    const previewTitle = menu ? this.withMenuTitle(title) : title;
    const previewDescription = menu
      ? this.withMenuLine(description, menuLine)
      : description;
    const canonical =
      seo.canonicalUrl || this.baseUrl + '/stores/' + store.slug;

    // Older releases persisted the shop logo in ogImageKey as an automatic
    // value. A row that no longer carries its auto-generated marker would keep
    // that key as a manual override and hide the generated card from every
    // share, so a key that resolves to this shop's own logo is not an override.
    const preferredImageKey =
      seo.ogImageKey && !(await this.isLegacyStoreLogo(store, seo.ogImageKey))
        ? seo.ogImageKey
        : undefined;
    // Explicit overrides win, then the current shop banner. A generated logo
    // card must not hide a banner the owner selected for the shop.
    const ogImage =
      (preferredImageKey
        ? await this.buildImageUrl(preferredImageKey)
        : undefined) ??
      (await this.buildStoreImageUrl(store, store.bannerKey)) ??
      (await this.buildStoreShareImageUrl(store)) ??
      (await this.buildStoreImageUrl(store, store.logoKey)) ??
      // A legacy or stale logo key may no longer resolve; the shop's newest
      // ready image still gives the shared link something to show.
      (await this.latestStoreImageUrl(store.id)) ??
      (await this.defaultSharingImage(settings)) ??
      this.fallbackSharingImage();
    const ogTitle = this.withNameTitle(seo.ogTitle || '', store.name);
    const ogDescription = seo.ogDescription || store.description || description;
    const previewOgTitle = menu ? this.withMenuTitle(ogTitle) : ogTitle;
    const previewOgDescription = menu
      ? this.withMenuLine(ogDescription, menuLine)
      : ogDescription;

    // Build AI robots meta
    const aiRobots = this.buildAiRobotsMeta(
      seo.aiRobots ?? undefined,
      seo.aiTraining ?? undefined,
    );

    return {
      title: this.truncate(previewTitle, 60),
      description: this.truncate(previewDescription, 160),
      keywords: seo.metaKeywords ?? undefined,
      robots: seo.robots || RobotsDirective.INDEX_FOLLOW,
      canonical,
      og: {
        title: this.truncate(previewOgTitle, 60),
        description: this.truncate(previewOgDescription, 160),
        image: ogImage,
        type: seo.ogType || 'website',
        // Branding is the single source of the displayed website name; a row
        // stored before a rename must not keep advertising the old one.
        siteName: settings.siteName,
        url: canonical,
        locale: 'en_US',
      },
      twitter: {
        card: seo.twitterCard || 'summary_large_image',
        site: seo.twitterSite ?? settings.twitterSite ?? undefined,
        creator: seo.twitterCreator ?? undefined,
        title: this.truncate(previewOgTitle, 70),
        description: this.truncate(previewOgDescription, 200),
        image: ogImage,
      },
      jsonLd: await this.buildStoreJsonLd(store, seo, settings),
      verificationMeta: this.buildVerificationMeta(settings),
      aiRobots,
      aiTraining: seo.aiTraining || undefined,
    };
  }

  async generateProductMetaTags(
    product: Product,
    store: Store,
  ): Promise<MetaTags> {
    if (!isPublicProductStatus(product.status))
      throw new NotFoundException('Product not found');
    const seo = await this.autoGenerateProductSeo(product, store, false);
    const settings = await this.getSettings();

    const title = seo.metaTitle || product.name + ' - ' + store.name;
    const description =
      seo.metaDescription ||
      product.description ||
      (this.isMenuStore(store)
        ? `${product.name} on the menu at ${store.name}.`
        : `${product.name} at ${store.name}.`);
    const canonical =
      seo.canonicalUrl ||
      `${this.baseUrl}/stores/${store.slug}/p/${product.slug}`;

    // Honor an explicitly saved image only while it is still one of the
    // product's images; a replaced image leaves a stale key that would 404.
    const preferredImageKey =
      seo.ogImageKey && product.imageKeys?.includes(seo.ogImageKey)
        ? seo.ogImageKey
        : undefined;
    const ogImage =
      (preferredImageKey
        ? await this.buildImageUrl(preferredImageKey)
        : undefined) ??
      (await this.buildProductImageUrl(product)) ??
      (await this.buildStoreImageUrl(store, store.bannerKey)) ??
      (await this.buildStoreShareImageUrl(store)) ??
      (await this.buildStoreImageUrl(store, store.logoKey)) ??
      (await this.latestStoreImageUrl(store.id)) ??
      (await this.defaultSharingImage(settings)) ??
      this.fallbackSharingImage();
    const ogTitle = seo.ogTitle || product.name;
    const ogDescription =
      seo.ogDescription || product.description || description;

    const lowestPriceCents = productFromPriceCents(
      product.priceCents,
      readProductOptions(product.options),
    );
    const price = (parseInt(lowestPriceCents, 10) / 100).toFixed(2);
    const isInStock =
      product.status === 'active' &&
      (product.stockQuantity === null || product.stockQuantity > 0);
    const aiRobots = this.buildAiRobotsMeta(
      seo.aiRobots ?? undefined,
      seo.aiTraining ?? undefined,
    );

    return {
      title: this.truncate(title, 60),
      description: this.truncate(description, 160),
      keywords: seo.metaKeywords ?? undefined,
      robots: seo.robots || RobotsDirective.INDEX_FOLLOW,
      canonical,
      og: {
        title: this.truncate(ogTitle, 60),
        description: this.truncate(ogDescription, 160),
        image: ogImage,
        type: seo.ogType || 'product',
        siteName: settings.siteName,
        url: canonical,
        locale: 'en_US',
      },
      twitter: {
        card: seo.twitterCard || 'summary_large_image',
        site: settings.twitterSite ?? undefined,
        title: this.truncate(ogTitle, 70),
        description: this.truncate(ogDescription, 200),
        image: ogImage,
      },
      jsonLd: await this.buildProductJsonLd(
        product,
        store,
        seo,
        price,
        isInStock,
      ),
      verificationMeta: this.buildVerificationMeta(settings),
      aiRobots,
      aiTraining: seo.aiTraining || undefined,
    };
  }

  async generateShowcaseMetaTags(
    showcase: Showcase,
    store: Store | null,
  ): Promise<MetaTags> {
    if (showcase.status !== ShowcaseStatus.PUBLISHED)
      throw new NotFoundException('Post not found');
    const seo = await this.autoGenerateShowcaseSeo(showcase, store, false);
    const settings = await this.getSettings();

    const title = seo.metaTitle || showcase.title;
    const description = seo.metaDescription || showcase.description || '';
    const canonical =
      seo.canonicalUrl || this.baseUrl + this.postPath(showcase, store);

    // A post previews with its own media. An explicitly saved image only
    // counts while it still belongs to this post: auto-generated rows from
    // older releases stored the shop logo here, and that must never outrank
    // the post's own photo or video poster.
    const preferredImageKey =
      seo.ogImageKey && (await this.showcaseOwnsImage(showcase, seo.ogImageKey))
        ? seo.ogImageKey
        : undefined;
    const ogImage =
      (preferredImageKey
        ? await this.buildImageUrl(preferredImageKey)
        : undefined) ??
      (await this.buildShowcaseImageUrl(showcase)) ??
      (store
        ? await this.buildStoreImageUrl(store, store.bannerKey)
        : undefined) ??
      (store ? await this.buildStoreShareImageUrl(store) : undefined) ??
      (store
        ? await this.buildStoreImageUrl(store, store.logoKey)
        : undefined) ??
      (store ? await this.latestStoreImageUrl(store.id) : undefined) ??
      (await this.defaultSharingImage(settings)) ??
      this.fallbackSharingImage();
    const ogTitle = seo.ogTitle || showcase.title;
    const ogDescription =
      seo.ogDescription || showcase.description || description;

    const aiRobots = this.buildAiRobotsMeta(
      seo.aiRobots ?? undefined,
      seo.aiTraining ?? undefined,
    );

    return {
      title: this.truncate(title, 60),
      description: this.truncate(description, 160),
      keywords: seo.metaKeywords ?? undefined,
      robots: seo.robots || RobotsDirective.INDEX_FOLLOW,
      canonical,
      og: {
        title: this.truncate(ogTitle, 60),
        description: this.truncate(ogDescription, 160),
        image: ogImage,
        type: seo.ogType || 'article',
        siteName: settings.siteName,
        url: canonical,
        locale: 'en_US',
      },
      twitter: {
        card: seo.twitterCard || 'summary_large_image',
        site: settings.twitterSite ?? undefined,
        title: this.truncate(ogTitle, 70),
        description: this.truncate(ogDescription, 200),
        image: ogImage,
      },
      jsonLd: await this.buildArticleJsonLd(
        showcase,
        store,
        seo,
        settings,
        ogImage,
      ),
      verificationMeta: this.buildVerificationMeta(settings),
      aiRobots,
      aiTraining: seo.aiTraining || undefined,
    };
  }

  async generateGenericMetaTags(
    path: string,
    options: {
      title?: string;
      description?: string;
      robots?: RobotsDirective;
      ogType?: string;
    } = {},
  ): Promise<MetaTags> {
    const site = await this.generateSiteMetaTags();
    const canonical = this.baseUrl + path;
    const title = this.truncate(options.title || site.title, 60);
    const description = this.truncate(
      options.description ?? site.description,
      160,
    );
    return {
      ...site,
      title,
      description,
      canonical,
      robots: options.robots || RobotsDirective.INDEX_FOLLOW,
      og: {
        ...site.og,
        title,
        description,
        url: canonical,
        type: options.ogType || 'website',
      },
      twitter: { ...site.twitter, title, description },
    };
  }

  // ============================================
  // JSON-LD Structured Data Builders (Enhanced 2026)
  // ============================================

  /** Organization and WebSite schema shared by the home page and shop pages. */
  private async buildSiteJsonLd(
    settings: SeoSettings,
  ): Promise<Record<string, unknown>[]> {
    const jsonLd: Record<string, unknown>[] = [];

    // Organization schema
    if (settings.organizationName) {
      jsonLd.push({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: settings.organizationName,
        url: settings.organizationUrl || this.baseUrl,
        logo: await this.organizationLogo(settings),
        sameAs: settings.organizationSameAs || [],
      });
    }

    // WebSite schema with SearchAction
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: settings.siteName,
      url: this.baseUrl,
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: this.baseUrl + '/search?q={search_term_string}',
        },
        'query-input': 'required name=search_term_string',
      },
    });

    return jsonLd;
  }

  private async buildStoreJsonLd(
    store: Store,
    seo: StoreSeo | null,
    settings: SeoSettings,
  ): Promise<Record<string, unknown>[]> {
    const jsonLd = await this.buildSiteJsonLd(settings);

    // Store/Restaurant schema
    if (seo?.structuredData) {
      jsonLd.push(seo.structuredData);
    } else {
      const storeSchema: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': store.storeType === 'restaurant_menu' ? 'Restaurant' : 'Store',
        name: store.name,
        url: this.baseUrl + '/stores/' + store.slug,
        description: store.description,
        image: await this.buildImageUrl(store.logoKey),
        address: {
          '@type': 'PostalAddress',
          // Address fields would come from store entity if available
        },
        priceRange: store.storeType === 'restaurant_menu' ? '$$' : undefined,
      };

      // Add opening hours for restaurants if available
      if (store.storeType === 'restaurant_menu') {
        storeSchema.servesCuisine = 'Various';
      }

      jsonLd.push(storeSchema);
    }

    // BreadcrumbList
    jsonLd.push(
      this.buildBreadcrumbJsonLd([
        { name: 'Home', url: this.baseUrl },
        { name: store.name, url: this.baseUrl + '/stores/' + store.slug },
      ]),
    );

    return jsonLd;
  }

  private async buildProductJsonLd(
    product: Product,
    store: Store,
    seo: ProductSeo | null,
    price: string,
    isInStock: boolean,
  ): Promise<Record<string, unknown>[]> {
    const jsonLd: Record<string, unknown>[] = [];

    const offers = {
      '@type': 'Offer',
      url: this.baseUrl + '/stores/' + store.slug + '/p/' + product.slug,
      priceCurrency: product.currency,
      price,
      availability: isInStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      seller: {
        '@type': 'Store',
        name: store.name,
      },
      // 2026: Add shipping details, return policy
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: {
          '@type': 'MonetaryAmount',
          value: '0',
          currency: product.currency,
        },
        shippingDestination: {
          '@type': 'DefinedRegion',
          addressCountry: 'US',
        },
      },
    };

    const productSchema: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description: product.description,
      image: (
        await Promise.all(
          (product.imageKeys ?? []).map((key) => this.buildImageUrl(key)),
        )
      ).filter(Boolean),
      sku: seo?.sku || product.sku,
      mpn: seo?.mpn,
      gtin: seo?.gtin,
      brand: seo?.brand
        ? { '@type': 'Brand', name: seo.brand }
        : { '@type': 'Brand', name: store.name },
      offers,
      aggregateRating: undefined, // Would be populated from reviews
      // 2026: Additional product properties
      category: product.category,
      // color, size, material would come from product variants
    };

    if (seo?.structuredData) {
      Object.assign(productSchema, seo.structuredData);
    }

    jsonLd.push(productSchema);

    // FAQPage schema if product has FAQs (placeholder for future)
    // HowTo schema for assembly instructions (placeholder)

    // BreadcrumbList
    jsonLd.push(
      this.buildBreadcrumbJsonLd([
        { name: 'Home', url: this.baseUrl },
        { name: store.name, url: this.baseUrl + '/stores/' + store.slug },
        {
          name: 'Products',
          url: this.baseUrl + '/stores/' + store.slug,
        },
        {
          name: product.name,
          url: this.baseUrl + '/stores/' + store.slug + '/p/' + product.slug,
        },
      ]),
    );

    return jsonLd;
  }

  private async buildArticleJsonLd(
    showcase: Showcase,
    store: Store | null,
    seo: ShowcaseSeo | null,
    settings: SeoSettings,
    image?: string,
  ): Promise<Record<string, unknown>[]> {
    const jsonLd: Record<string, unknown>[] = [];
    const logo = await this.organizationLogo(settings);

    const articleSchema: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: showcase.title,
      description: showcase.description,
      // Structured data needs a real image; the caller resolved the post's own
      // photo or video poster, which beats a logo.
      image,
      datePublished:
        seo?.articlePublishedTime?.toISOString() ||
        showcase.publishedAt?.toISOString() ||
        showcase.createdAt.toISOString(),
      dateModified:
        seo?.articleModifiedTime?.toISOString() ||
        showcase.updatedAt.toISOString(),
      author: {
        '@type': 'Person',
        name: seo?.articleAuthor || store?.name || settings.siteName,
      },
      publisher: {
        '@type': 'Organization',
        name: settings.organizationName || settings.siteName,
        logo: logo ? { '@type': 'ImageObject', url: logo } : undefined,
      },
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': this.baseUrl + this.postPath(showcase, store),
      },
      // 2026: Speakable schema for voice/AI assistants
      speakable: this.buildSpeakableSchema(showcase),
      // Article section and tags
      articleSection: seo?.articleSection,
      keywords: seo?.articleTags?.join(', '),
    };

    if (seo?.structuredData) Object.assign(articleSchema, seo.structuredData);

    jsonLd.push(articleSchema);

    // BreadcrumbList
    const breadcrumbs = [{ name: 'Home', url: this.baseUrl }];
    if (store) {
      breadcrumbs.push({
        name: store.name,
        url: this.baseUrl + '/stores/' + store.slug,
      });
      breadcrumbs.push({
        name: 'Posts',
        url: this.baseUrl + '/stores/' + store.slug,
      });
    }
    breadcrumbs.push({
      name: showcase.title,
      url: this.baseUrl + this.postPath(showcase, store),
    });
    jsonLd.push(this.buildBreadcrumbJsonLd(breadcrumbs));

    return jsonLd;
  }

  private buildSpeakableSchema(
    showcase: Showcase,
  ): Record<string, unknown> | undefined {
    // 2026: Speakable schema for AI/voice assistants
    // Identifies content suitable for text-to-speech
    if (!showcase.description) return undefined;

    return {
      '@type': 'SpeakableSpecification',
      cssSelector: ['.article-content', '.post-description', 'article p'],
      xpath: ['//article//p', '//div[@class="post-content"]//p'],
    };
  }

  private buildBreadcrumbJsonLd(
    items: { name: string; url: string }[],
  ): Record<string, unknown> {
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        item: item.url,
      })),
    };
  }

  // ============================================
  // GEO / AI Optimization Features (2026)
  // ============================================

  /**
   * Generates llms.txt content for AI crawlers.
   * This file helps LLMs understand your site structure and content.
   * See: https://github.com/AnswerDotAI/llms-txt
   */
  async generateLlmsTxt(): Promise<string> {
    return this.cachedDocument('llms.txt', () => this.buildLlmsTxt());
  }

  private async buildLlmsTxt(): Promise<string> {
    const settings = await this.getSettings();
    if (!settings.llmsTxtEnabled) {
      return '# llms.txt disabled\n';
    }

    // If custom content provided, use it
    if (settings.llmsTxtContent) {
      return settings.llmsTxtContent;
    }

    // Auto-generate llms.txt from site content
    const entries: LlmsTxtEntry[] = [];

    // Home page
    entries.push({
      title: settings.siteName,
      url: this.baseUrl,
      description:
        settings.defaultDescription ||
        `Welcome to ${settings.siteName} - Your Showcase Platform`,
      priority: 'high',
    });

    // Stores
    const stores = await this.storeSeoRepo
      .createQueryBuilder('ss')
      .leftJoinAndSelect('ss.store', 'store')
      .andWhere(publicVisibilitySql('store', 'store'))
      .getMany();

    for (const seo of stores) {
      if (seo.store && !seo.robots?.includes('noindex')) {
        entries.push({
          title: seo.store.name,
          url: this.baseUrl + '/stores/' + seo.store.slug,
          description: seo.store.description || `Shop by ${seo.store.name}`,
          priority: 'high',
        });

        entries.push({
          title: `${seo.store.name} - Products`,
          url: this.baseUrl + '/stores/' + seo.store.slug,
          description: `Browse products from ${seo.store.name}`,
          priority: 'medium',
        });

        entries.push({
          title: `${seo.store.name} - Posts`,
          url: this.baseUrl + '/stores/' + seo.store.slug,
          description: `Read posts from ${seo.store.name}`,
          priority: 'medium',
        });
      }
    }

    // Products: one read for every visible product instead of a lookup per
    // SEO row. The catalogue can be large, so the ids are chunked.
    const productSeos = await this.productSeoRepo.find();
    const visibleProducts = await this.publicProducts(
      productSeos
        .filter((seo) => !seo.robots?.includes('noindex'))
        .map((seo) => seo.productId),
    );
    for (const seo of productSeos) {
      if (seo.robots?.includes('noindex')) continue;
      const product = visibleProducts.get(seo.productId);
      if (product) {
        entries.push({
          title: product.name,
          url: `${this.baseUrl}/stores/${product.store.slug}/p/${product.slug}`,
          description: product.description?.substring(0, 200) || product.name,
          priority: 'medium',
        });
      }
    }

    // Showcases/Posts
    const showcaseSeos = await this.showcaseSeoRepo.find();
    const visiblePosts = await this.publicPostRows(
      showcaseSeos
        .filter((seo) => !seo.robots?.includes('noindex'))
        .map((seo) => seo.showcaseId),
    );
    for (const seo of showcaseSeos) {
      if (seo.robots?.includes('noindex')) continue;
      const showcase = visiblePosts.get(seo.showcaseId);
      if (showcase) {
        entries.push({
          title: showcase.title,
          url: this.baseUrl + '/post/' + showcase.slug,
          description:
            showcase.description?.substring(0, 200) || showcase.title,
          priority: 'low',
        });
      }
    }

    // Build llms.txt
    let content = `# ${settings.siteName} - llms.txt\n\n`;
    content += `## Overview\n${settings.defaultDescription || 'A platform for showcases, products, and posts.'}\n\n`;
    content += `## Important Pages\n\n`;

    for (const entry of entries) {
      const priorityMarker =
        entry.priority === 'high'
          ? '⭐ '
          : entry.priority === 'medium'
            ? '📄 '
            : '📝 ';
      content += `- [${priorityMarker}${entry.title}](${entry.url})`;
      if (entry.description) {
        content += ` - ${entry.description}`;
      }
      content += '\n';
    }

    content += `\n## API Documentation\n- [API Reference](${this.baseUrl}/api/docs) - REST API for developers\n\n`;
    content += `## Contact\n- [Contact Us](${this.baseUrl}/contact)\n`;

    return content;
  }

  /**
   * Generates ai.txt / ai-robots.txt for AI crawler permissions.
   * Controls which AI bots can crawl and use content for training.
   */
  async generateAiRobotsTxt(): Promise<string> {
    return this.cachedDocument('ai.txt', () => this.buildAiRobotsTxt());
  }

  private async buildAiRobotsTxt(): Promise<string> {
    const settings = await this.getSettings();

    let robots = '# AI Robots.txt - Controls AI crawler access\n\n';

    // Default AI crawler rules
    const aiCrawlers = settings.aiCrawlerUserAgents || [
      'GPTBot',
      'ChatGPT-User',
      'CCBot',
      'anthropic-ai',
      'Claude-Web',
      'PerplexityBot',
      'Google-Extended',
      'BingChat',
      'YouBot',
    ];

    if (settings.aiCrawlersAllowed) {
      robots += 'User-agent: *\n';
      robots += 'Allow: /\n\n';

      // Explicitly allow known AI crawlers
      for (const bot of aiCrawlers) {
        robots += `User-agent: ${bot}\n`;
        robots += 'Allow: /\n\n';
      }
    } else {
      robots += 'User-agent: *\n';
      robots += 'Disallow: /\n\n';

      for (const bot of aiCrawlers) {
        robots += `User-agent: ${bot}\n`;
        robots += 'Disallow: /\n\n';
      }
    }

    // Training permissions
    if (settings.aiTrainingAllowed) {
      robots += '# Training allowed\n';
      for (const bot of aiCrawlers) {
        robots += `User-agent: ${bot}\n`;
        robots += 'Allow: /\n';
        robots += '# training-allow\n\n';
      }
    } else {
      robots += '# Training disallowed\n';
      for (const bot of aiCrawlers) {
        robots += `User-agent: ${bot}\n`;
        robots += 'Disallow: /\n';
        robots += '# training-disallow\n\n';
      }
    }

    // Sitemap reference
    robots += `Sitemap: ${this.baseUrl}/sitemap.xml\n`;
    robots += `# llms.txt: ${this.baseUrl}/llms.txt\n`;

    return robots;
  }

  /**
   * IndexNow protocol support for instant indexing.
   * Notifies search engines of URL changes instantly.
   * See: https://www.indexnow.org/
   */
  async submitAdminIndexNow(data: IndexNowDto, actorId: string) {
    await this.requireAdmin(actorId);
    data = await this.validated(IndexNowDto, data);
    const operationId = randomUUID();
    await this.adminWrite(
      actorId,
      'indexnow.started',
      operationId,
      [],
      async () => undefined,
    );
    const result = await this.submitToIndexNow(data.urls);
    await this.adminWrite(
      actorId,
      result.success ? 'indexnow.completed' : 'indexnow.failed',
      operationId,
      [],
      async () => undefined,
    );
    return result;
  }

  private async submitToIndexNow(
    urls: string[],
  ): Promise<{ success: boolean; results: Record<string, boolean> }> {
    const settings = await this.getSettings();
    if (!settings.indexNowEnabled || !settings.indexNowKey) {
      return { success: false, results: {} };
    }

    urls.forEach((url) => this.assertSiteUrl(url));
    const key = settings.indexNowKey;
    const keyLocation =
      settings.indexNowKeyLocation || this.baseUrl + '/' + key + '.txt';
    const host = new URL(this.baseUrl).hostname;

    const payload = {
      host,
      key,
      keyLocation,
      urlList: urls,
    };

    const endpoints = [
      'https://api.indexnow.org/indexnow',
      'https://www.bing.com/indexnow',
      'https://search.yandex.com/indexnow',
    ];

    const results: Record<string, boolean> = {};

    // Fire requests in parallel with individual timeouts
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    await Promise.allSettled(
      endpoints.map(async (endpoint) => {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
          });
          results[endpoint] = response.ok;
          if (!response.ok) {
            this.logger.warn(
              `IndexNow submission to ${endpoint} failed: ${response.status} ${response.statusText}`,
            );
          }
        } catch (error) {
          results[endpoint] = false;
          if (error instanceof DOMException && error.name === 'AbortError') {
            this.logger.warn(`IndexNow submission to ${endpoint} timed out`);
          } else {
            this.logger.warn(
              `IndexNow submission to ${endpoint} failed: ${(error as Error).message}`,
            );
          }
        }
      }),
    );

    clearTimeout(timeout);

    return { success: Object.values(results).some((v) => v), results };
  }

  /**
   * Auto-submits changed URLs to IndexNow when content is updated.
   * Called from store/product/showcase update operations.
   */
  async notifyIndexNowOnChange(
    entityType: 'store' | 'product' | 'showcase',
    entity: Store | Product | Showcase,
  ): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.indexNowEnabled) return;

    const kind = entityType === 'showcase' ? 'post' : entityType;
    const target = { store: Store, product: Product, post: Showcase }[kind];
    if (
      !(await this.dataSource.manager
        .getRepository(target)
        .findOneBy({ id: entity.id, ...publicWhere(kind) }))
    )
      return;
    let url: string;
    if (entityType === 'store') {
      url = this.baseUrl + '/stores/' + (entity as Store).slug;
    } else if (entityType === 'product') {
      const product = entity as Product;
      // Out of stock pages stay indexed; only hidden items are skipped.
      if (!isPublicProductStatus(product.status)) return;
      const store = await this.dataSource.manager.findOneBy(Store, {
        id: product.storeId,
      });
      if (!store) return;
      url = this.baseUrl + '/stores/' + store.slug + '/p/' + product.slug;
    } else {
      if ((entity as Showcase).status !== ShowcaseStatus.PUBLISHED) return;
      url = this.baseUrl + '/post/' + (entity as Showcase).slug;
    }

    await this.submitToIndexNow([url]);
  }

  // ============================================
  // Sitemap Generation (Enhanced)
  // ============================================

  async generateSitemapUrls(kind?: SeoKind): Promise<SitemapUrl[]> {
    const settings = await this.getSettings();
    if (!settings.sitemapEnabled) return [];
    const urls: SitemapUrl[] = [];
    const indexable = (seo: { robots: RobotsDirective } | null) =>
      !seo?.robots?.includes('noindex');
    const manager = this.dataSource.manager;
    if (!kind)
      urls.push({
        url: this.baseUrl,
        changefreq: settings.sitemapChangefreq,
        priority: 1,
      });
    if (!kind || kind === 'store') {
      const stores = await manager.find(Store, {
        where: publicWhere('store'),
      });
      // One SEO read for the whole collection instead of one per shop.
      const seoByStore = await this.seoRows(
        this.storeSeoRepo,
        'storeId',
        stores.map((store) => store.id),
      );
      for (const store of stores) {
        const seo = seoByStore.get(store.id) ?? null;
        if (!indexable(seo)) continue;
        urls.push({
          url: seo?.canonicalUrl || `${this.baseUrl}/stores/${store.slug}`,
          lastmod: store.updatedAt.toISOString().split('T')[0],
          changefreq: 'weekly',
          priority: 0.8,
        });
      }
    }
    if (!kind || kind === 'product') {
      const products = await manager.find(Product, {
        where: {
          status: In([...PUBLIC_PRODUCT_STATUSES]),
          ...publicWhere('product'),
        },
        relations: ['store'],
      });
      const seoByProduct = await this.seoRows(
        this.productSeoRepo,
        'productId',
        products.map((product) => product.id),
      );
      // Product images are resolved in bounded chunks: two reads per chunk
      // instead of a variant lookup (plus siblings) per saved image key.
      for (
        let index = 0;
        index < products.length;
        index += SeoService.READ_CHUNK
      ) {
        const chunk = products.slice(index, index + SeoService.READ_CHUNK);
        const visible = chunk.filter((product) =>
          indexable(seoByProduct.get(product.id) ?? null),
        );
        if (!visible.length) continue;
        const previewUrls = await this.previewUrlsByKey(
          visible.flatMap((product) => product.imageKeys ?? []),
        );
        for (const product of visible) {
          const seo = seoByProduct.get(product.id) ?? null;
          const images: SitemapImage[] = [];
          for (const key of product.imageKeys ?? []) {
            const url = previewUrls.get(key);
            if (url) images.push({ url, title: product.name });
          }
          urls.push({
            url:
              seo?.canonicalUrl ||
              `${this.baseUrl}/stores/${product.store.slug}/p/${product.slug}`,
            lastmod: product.updatedAt.toISOString().split('T')[0],
            changefreq: 'weekly',
            priority: 0.6,
            images,
          });
        }
      }
    }
    if (!kind || kind === 'showcase') {
      const showcases = await manager.find(Showcase, {
        where: { status: ShowcaseStatus.PUBLISHED, ...publicWhere('post') },
        relations: ['store'],
      });
      const seoByPost = await this.seoRows(
        this.showcaseSeoRepo,
        'showcaseId',
        showcases.map((showcase) => showcase.id),
      );
      for (const showcase of showcases) {
        const seo = seoByPost.get(showcase.id) ?? null;
        if (!indexable(seo)) continue;
        urls.push({
          url:
            seo?.canonicalUrl ||
            this.baseUrl + this.postPath(showcase, showcase.store ?? null),
          lastmod: showcase.updatedAt.toISOString().split('T')[0],
          changefreq: 'monthly',
          priority: 0.5,
        });
      }
    }
    return urls;
  }

  /**
   * Reads the SEO rows for many entities in one query per chunk. Catalogue
   * documents used to issue a lookup for every shop, product, and post.
   */
  private async seoRows<T extends { id: string }>(
    repo: Repository<T>,
    field: 'storeId' | 'productId' | 'showcaseId',
    ids: string[],
  ): Promise<Map<string, T>> {
    const rows = new Map<string, T>();
    for (let index = 0; index < ids.length; index += SeoService.READ_CHUNK) {
      const found = await repo.find({
        where: {
          [field]: In(ids.slice(index, index + SeoService.READ_CHUNK)),
        } as never,
      });
      for (const row of found) {
        const owner = (row as unknown as Record<string, unknown>)[field];
        if (typeof owner === 'string') rows.set(owner, row);
      }
    }
    return rows;
  }

  /**
   * Maps many saved image keys to public preview URLs with two reads per
   * chunk: the matching variants, then the siblings used to pick a compact
   * JPEG/PNG. Keys that are not public, READY images are omitted.
   */
  private async previewUrlsByKey(keys: string[]): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    const wanted = [...new Set(keys)];
    for (let index = 0; index < wanted.length; index += SeoService.READ_CHUNK) {
      const chunk = wanted.slice(index, index + SeoService.READ_CHUNK);
      const matched = await this.dataSource.manager.find(MediaVariant, {
        where: {
          storageKey: In(chunk),
          asset: {
            ...publicWhere('media'),
            status: MediaStatus.READY,
          },
        },
      });
      const images = matched.filter((variant) =>
        variant.mimeType.startsWith('image/'),
      );
      if (!images.length) continue;
      const siblings = await this.dataSource.manager.find(MediaVariant, {
        where: {
          assetId: In([...new Set(images.map((variant) => variant.assetId))]),
        },
        order: { width: 'DESC' },
      });
      const byAsset = new Map<string, MediaVariant[]>();
      for (const variant of siblings) {
        const list = byAsset.get(variant.assetId);
        if (list) list.push(variant);
        else byAsset.set(variant.assetId, [variant]);
      }
      for (const variant of images) {
        const preview =
          choosePreviewImage(byAsset.get(variant.assetId) ?? []) ?? variant;
        urls.set(
          variant.storageKey,
          await this.storage.presignedGetUrl(preview.storageKey),
        );
      }
    }
    return urls;
  }

  /** Public products for a set of ids, one read per chunk. */
  private async publicProducts(ids: string[]): Promise<Map<string, Product>> {
    const products = new Map<string, Product>();
    for (let index = 0; index < ids.length; index += SeoService.READ_CHUNK) {
      const found = await this.dataSource.manager.find(Product, {
        where: {
          id: In(ids.slice(index, index + SeoService.READ_CHUNK)),
          status: In([...PUBLIC_PRODUCT_STATUSES]),
          ...publicWhere('product'),
        },
        relations: ['store'],
      });
      for (const product of found) products.set(product.id, product);
    }
    return products;
  }

  /**
   * Publicly visible published posts for a set of ids, one read per chunk.
   * Posts skip encoding media and drafts through the shared visibility SQL.
   */
  private async publicPostRows(
    ids: string[],
  ): Promise<Map<string, PublicPostRow>> {
    const rows = new Map<string, PublicPostRow>();
    for (let index = 0; index < ids.length; index += SeoService.READ_CHUNK) {
      const chunk = ids.slice(index, index + SeoService.READ_CHUNK);
      const found = await this.dataSource.manager
        .createQueryBuilder(Showcase, 'post')
        .select(['post.id', 'post.slug', 'post.title', 'post.description'])
        .where('post.id IN (:...ids)', { ids: chunk })
        .andWhere('post.status = :status', {
          status: ShowcaseStatus.PUBLISHED,
        })
        .andWhere(publicVisibilitySql('post', 'post'))
        .getRawMany<{
          post_id: string;
          post_slug: string;
          post_title: string;
          post_description: string | null;
        }>();
      for (const row of found)
        rows.set(row.post_id, {
          slug: row.post_slug,
          title: row.post_title,
          description: row.post_description,
        });
    }
    return rows;
  }

  async generateSitemapXml(kind?: SeoKind): Promise<string> {
    return this.cachedDocument(`sitemap:${kind ?? 'all'}`, () =>
      this.buildSitemapXml(kind),
    );
  }

  private async buildSitemapXml(kind?: SeoKind): Promise<string> {
    const urls = await this.generateSitemapUrls(kind);
    const settings = await this.getSettings();

    if (!settings.sitemapEnabled) {
      return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ';
    xml += 'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" ';
    xml += 'xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n';

    for (const url of urls) {
      xml += '  <url>\n';
      xml += '    <loc>' + this.escapeXml(url.url) + '</loc>\n';
      if (url.lastmod) xml += '    <lastmod>' + url.lastmod + '</lastmod>\n';
      if (url.changefreq)
        xml += '    <changefreq>' + url.changefreq + '</changefreq>\n';
      if (url.priority !== undefined)
        xml += '    <priority>' + url.priority.toFixed(1) + '</priority>\n';

      if (url.images?.length) {
        for (const img of url.images) {
          xml += '    <image:image>\n';
          xml +=
            '      <image:loc>' + this.escapeXml(img.url) + '</image:loc>\n';
          if (img.title)
            xml +=
              '      <image:title>' +
              this.escapeXml(img.title) +
              '</image:title>\n';
          if (img.caption)
            xml +=
              '      <image:caption>' +
              this.escapeXml(img.caption) +
              '</image:caption>\n';
          xml += '    </image:image>\n';
        }
      }

      if (url.videos?.length) {
        for (const vid of url.videos) {
          xml += '    <video:video>\n';
          xml +=
            '      <video:thumbnail_loc>' +
            this.escapeXml(vid.thumbnail) +
            '</video:thumbnail_loc>\n';
          xml +=
            '      <video:title>' +
            this.escapeXml(vid.title) +
            '</video:title>\n';
          xml +=
            '      <video:description>' +
            this.escapeXml(vid.description) +
            '</video:description>\n';
          xml +=
            '      <video:content_loc>' +
            this.escapeXml(vid.url) +
            '</video:content_loc>\n';
          if (vid.duration)
            xml +=
              '      <video:duration>' + vid.duration + '</video:duration>\n';
          if (vid.uploadDate)
            xml +=
              '      <video:publication_date>' +
              vid.uploadDate +
              '</video:publication_date>\n';
          xml += '    </video:video>\n';
        }
      }

      xml += '  </url>\n';
    }

    xml += '</urlset>';
    return xml;
  }

  // ============================================
  // Robots.txt Generation (Enhanced)
  // ============================================

  async generateRobotsTxt(): Promise<string> {
    return this.cachedDocument('robots.txt', () => this.buildRobotsTxt());
  }

  private async buildRobotsTxt(): Promise<string> {
    const settings = await this.getSettings();
    const sitemapUrl = this.baseUrl + '/sitemap.xml';
    const llmsTxtUrl = this.baseUrl + '/llms.txt';
    const aiRobotsUrl = this.baseUrl + '/ai.txt';

    let robots = 'User-agent: *\n';
    robots += 'Allow: /\n\n';

    if (settings.robotsTxtCustom) {
      robots += settings.robotsTxtCustom + '\n\n';
    }

    // AI crawler directives
    robots += '# AI Crawler Directives\n';
    robots += 'User-agent: GPTBot\n';
    robots += settings.aiCrawlersAllowed ? 'Allow: /\n' : 'Disallow: /\n';
    robots += settings.aiTrainingAllowed
      ? '# training-allow\n'
      : '# training-disallow\n\n';

    robots += 'User-agent: ChatGPT-User\n';
    robots += settings.aiCrawlersAllowed ? 'Allow: /\n' : 'Disallow: /\n\n';

    robots += 'User-agent: Google-Extended\n';
    robots += settings.aiCrawlersAllowed ? 'Allow: /\n' : 'Disallow: /\n\n';

    robots += 'User-agent: CCBot\n';
    robots += settings.aiCrawlersAllowed ? 'Allow: /\n' : 'Disallow: /\n\n';

    robots += 'User-agent: anthropic-ai\n';
    robots += settings.aiCrawlersAllowed ? 'Allow: /\n' : 'Disallow: /\n\n';

    robots += 'User-agent: PerplexityBot\n';
    robots += settings.aiCrawlersAllowed ? 'Allow: /\n' : 'Disallow: /\n\n';

    // Sitemap and llms.txt references
    robots += 'Sitemap: ' + sitemapUrl + '\n';
    robots += 'Sitemap: ' + this.baseUrl + '/sitemap-stores.xml\n';
    robots += 'Sitemap: ' + this.baseUrl + '/sitemap-products.xml\n';
    robots += 'Sitemap: ' + this.baseUrl + '/sitemap-posts.xml\n';
    robots += 'LLMS-TXT: ' + llmsTxtUrl + '\n';
    robots += 'AI-ROBOTS: ' + aiRobotsUrl + '\n';

    return robots;
  }

  // ============================================
  // Helpers
  // ============================================

  private async buildStoreImageUrl(
    store: Store,
    key: string | null | undefined,
  ): Promise<string | undefined> {
    return this.buildOwnedImageUrl({ storeId: store.id }, key);
  }

  private async buildProductImageUrl(
    product: Product,
  ): Promise<string | undefined> {
    for (const key of product.imageKeys ?? []) {
      const url = await this.buildOwnedImageUrl({ productId: product.id }, key);
      if (url) return url;
    }
    return undefined;
  }

  /**
   * Resolve a store- or product-owned image variant and advertise a format and
   * width that link previews render reliably. The worker creates a branded
   * logo card for shares; this is the fallback for shops without one.
   */
  private async buildOwnedImageUrl(
    owner: { storeId?: string; productId?: string; showcaseId?: string },
    key: string | null | undefined,
  ): Promise<string | undefined> {
    if (!key) return undefined;
    const variant = await this.dataSource.manager.findOne(MediaVariant, {
      where: {
        storageKey: key,
        asset: {
          ...(owner.storeId ? { storeId: owner.storeId } : {}),
          ...(owner.productId ? { productId: owner.productId } : {}),
          ...(owner.showcaseId ? { showcaseId: owner.showcaseId } : {}),
          ...publicWhere('media'),
          status: MediaStatus.READY,
        },
      },
    });
    if (!variant) return undefined;
    return this.buildPreviewVariantUrl(variant);
  }

  /**
   * First shareable frame of the post, in the order the post shows its media:
   * a photo, or the poster the worker cuts from a video. Covering videos here
   * keeps a shared post previewing with its own thumbnail instead of the shop
   * logo, which says nothing about what was posted.
   */
  private async buildShowcaseImageUrl(
    showcase: Showcase,
  ): Promise<string | undefined> {
    const assets = await this.dataSource.manager.find(MediaAsset, {
      where: {
        showcaseId: showcase.id,
        status: MediaStatus.READY,
        ...publicWhere('media'),
      },
      order: { position: 'ASC' },
      take: 4,
    });
    for (const asset of assets) {
      // A video asset has no image variant of its own; its JPEG poster is the
      // only frame a preview client can render.
      const variants = await this.dataSource.manager.find(MediaVariant, {
        where: { assetId: asset.id },
        order: { width: 'DESC' },
        take: 12,
      });
      const image = choosePreviewImage(variants);
      if (!image) continue;
      const url = await this.buildOwnedImageUrl(
        { showcaseId: showcase.id },
        image.storageKey,
      );
      if (url) return url;
    }
    return undefined;
  }

  /** True when a variant key belongs to one of the post's own media assets. */
  private async showcaseOwnsImage(
    showcase: Showcase,
    key: string,
  ): Promise<boolean> {
    const assetId = mediaAssetIdFromKey(key);
    if (!assetId) return false;
    return this.dataSource.manager.exists(MediaAsset, {
      where: { id: assetId, showcaseId: showcase.id },
    });
  }

  /**
   * The auto-generated card for a shop. The logo card wins; a shop without a
   * logo still gets a generated name card, so every shop link has a picture.
   * The worker stores both at deterministic keys.
   */
  private async buildStoreShareImageUrl(
    store: Store,
  ): Promise<string | undefined> {
    const assetId = await this.storeLogoAssetId(store);
    if (assetId) {
      const logoCard = await this.cardUrl(store, assetId);
      if (logoCard) return logoCard;
    }
    return this.cardUrl(store, this.brandCardVersion(store));
  }

  private brandCardVersion(store: Store): string {
    return `brand-${storeBrandCardVersion(store.name, store.brandColor)}`;
  }

  private async cardUrl(
    store: Store,
    version: string,
  ): Promise<string | undefined> {
    const key = version.startsWith('brand-')
      ? storeBrandCardKey(store.id, version.slice('brand-'.length))
      : storeShareCardKey(store.id, version);
    try {
      const { size } = await this.storage.statObject(key);
      // The version busts caches after a logo or name change; the size also
      // changes when a missing card is generated after an early share, so a
      // preview client that cached "no image" fetches the new one.
      return `${this.baseUrl}/api/v1/seo/og/${encodeURIComponent(store.slug)}.jpg?v=${version}-${size}`;
    } catch {
      return undefined;
    }
  }

  /** Public stream of the card referenced by a store's share metadata. */
  async openShareCard(
    storeSlug: string,
    version?: string,
  ): Promise<{ stream: Readable; size: number } | undefined> {
    const store = await this.dataSource.manager.findOneBy(Store, {
      slug: storeSlug,
      ...publicWhere('store'),
    });
    if (!store) return undefined;
    // A shell generated before a logo/name change still points at the older
    // card; serving it keeps an in-flight share preview from going blank.
    // Only keys under this store's own card directory are ever opened.
    const candidates = [
      version,
      await this.storeLogoAssetId(store),
      this.brandCardVersion(store),
    ].filter((value): value is string => Boolean(value));
    for (const candidate of new Set(candidates)) {
      const key = candidate.startsWith('brand-')
        ? storeBrandCardKey(store.id, candidate.slice('brand-'.length))
        : storeShareCardKey(store.id, candidate);
      try {
        const { size } = await this.storage.statObject(key);
        return { stream: await this.storage.openReadStream(key), size };
      } catch {
        // Try the next candidate.
      }
    }
    return undefined;
  }

  /**
   * The logo asset whose generated card represents the shop. Older rows may
   * store a key that no longer encodes an asset id, so the shop's newest ready
   * logo is used as a fallback instead of dropping the preview image.
   */
  private async storeLogoAssetId(store: Store): Promise<string | null> {
    const fromKey = mediaAssetIdFromKey(store.logoKey);
    if (fromKey) return fromKey;
    const asset = await this.dataSource.manager
      .findOne(MediaAsset, {
        where: {
          storeId: store.id,
          purpose: 'store_logo',
          status: MediaStatus.READY,
          ...publicWhere('media'),
        },
        order: { createdAt: 'DESC' },
      })
      .catch(() => null);
    return asset?.id ?? null;
  }

  /**
   * True when a saved OG key is one of this shop's logo variants. Older
   * releases stored the logo automatically; a row that lost its auto-generated
   * marker must not let that key outrank the generated share card.
   */
  private async isLegacyStoreLogo(store: Store, key: string): Promise<boolean> {
    if (key === store.logoKey) return true;
    const assetId = mediaAssetIdFromKey(key);
    if (!assetId) return false;
    return this.dataSource.manager
      .exists(MediaAsset, {
        where: { id: assetId, storeId: store.id, purpose: 'store_logo' },
      })
      .catch(() => false);
  }

  /** Newest ready shop image, used when a saved logo/banner key is stale. */
  private async latestStoreImageUrl(
    storeId: string,
  ): Promise<string | undefined> {
    const asset = await this.dataSource.manager
      .findOne(MediaAsset, {
        where: {
          storeId,
          purpose: In(['store_logo', 'store_banner']),
          status: MediaStatus.READY,
          ...publicWhere('media'),
        },
        order: { createdAt: 'DESC' },
      })
      .catch(() => null);
    if (!asset) return undefined;
    const variants = await this.dataSource.manager.find(MediaVariant, {
      where: { assetId: asset.id },
      order: { width: 'DESC' },
      take: 12,
    });
    const image = choosePreviewImage(variants);
    return image ? this.storage.presignedGetUrl(image.storageKey) : undefined;
  }

  /**
   * The most reliable image a link preview can render, resolved from any
   * attached variant of the same asset (JPEG/PNG, compact, wide enough).
   */
  private async buildPreviewVariantUrl(variant: MediaVariant): Promise<string> {
    const siblings = await this.dataSource.manager.find(MediaVariant, {
      where: { assetId: variant.assetId },
      order: { width: 'DESC' },
      take: 12,
    });
    const image = choosePreviewImage(siblings) ?? variant;
    return this.storage.presignedGetUrl(image.storageKey);
  }

  // Administrators point sharing images at a public address (the website logo
  // lives outside shop media), while older rows keep a variant storage key.
  // The URL wins so a changed logo does not require a new upload per share.
  private async defaultSharingImage(
    settings: SeoSettings,
  ): Promise<string | undefined> {
    // A configured address wins, but a local upload is checked and narrowed
    // to a public JPEG/PNG variant; an unreadable local one falls through to
    // the live branding instead of advertising a broken or unsupported image.
    if (settings.defaultOgImageUrl)
      return this.publicImageUrl(settings.defaultOgImageUrl);
    return this.buildImageUrl(
      settings.defaultOgImageKey || this.defaultImageKey,
    );
  }

  /**
   * Resolve one public image address. Media variants served by the API are
   * verified and narrowed to a JPEG/PNG sibling; static paths and external
   * HTTPS addresses are used as given.
   */
  private async publicImageUrl(
    value: string | null | undefined,
  ): Promise<string | undefined> {
    if (!value) return undefined;
    const local = /^\/api\/v1\/uploads\/([^?#]+)/u.exec(value)?.[1];
    if (local) {
      try {
        return await this.buildImageUrl(decodeURIComponent(local));
      } catch {
        // A malformed encoded key must not become an absolute broken URL.
        return undefined;
      }
    }
    return this.absoluteImageUrl(value);
  }

  /**
   * Last-resort preview image shipped with the published frontend. A shared
   * shop must never advertise an empty `og:image`, because most clients then
   * render a text-only card with no picture at all.
   */
  private fallbackSharingImage(): string {
    return this.absoluteImageUrl('/banner.jpg');
  }

  private async organizationLogo(
    settings: SeoSettings,
  ): Promise<string | undefined> {
    return settings.organizationLogoUrl
      ? this.publicImageUrl(settings.organizationLogoUrl)
      : this.buildImageUrl(settings.organizationLogoKey);
  }

  // Meta tags and structured data need absolute image addresses; a logo path
  // such as /logo.png is resolved against the public origin.
  private absoluteImageUrl(value: string): string {
    return /^https:\/\//u.test(value)
      ? value
      : `${this.baseUrl.replace(/\/+$/u, '')}${value}`;
  }

  private async buildImageUrl(
    key: string | null | undefined,
  ): Promise<string | undefined> {
    if (!key) return undefined;
    // Never advertise originals, arbitrary keys, or media belonging to drafts.
    const variant = await this.dataSource.manager.findOne(MediaVariant, {
      where: {
        storageKey: key,
        asset: {
          ...publicWhere('media'),
          status: MediaStatus.READY,
        },
      },
    });
    if (!variant || !variant.mimeType.startsWith('image/')) return undefined;
    return this.buildPreviewVariantUrl(variant);
  }

  // Keep the shop/website identity even when saved SEO copy is only a tagline.
  // Match whole words so a name like "Art" is not mistaken for "cart".
  private withNameTitle(title: string, name: string): string {
    const identity = name.trim();
    const copy = title.trim();
    if (!copy) return identity;
    const words = (value: string) =>
      value
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)
        .join(' ');
    const normalizedName = words(identity);
    return normalizedName && ` ${words(copy)} `.includes(` ${normalizedName} `)
      ? copy
      : `${identity} — ${copy}`;
  }

  private truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 3).trim() + '...';
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private buildVerificationMeta(settings: SeoSettings): string[] {
    const tags: string[] = [];
    if (settings.googleSiteVerification) {
      tags.push(
        '<meta name="google-site-verification" content="' +
          this.escapeXml(settings.googleSiteVerification) +
          '">',
      );
    }
    if (settings.bingSiteVerification) {
      tags.push(
        '<meta name="msvalidate.01" content="' +
          this.escapeXml(settings.bingSiteVerification) +
          '">',
      );
    }
    if (settings.yandexSiteVerification) {
      tags.push(
        '<meta name="yandex-verification" content="' +
          this.escapeXml(settings.yandexSiteVerification) +
          '">',
      );
    }
    return tags;
  }

  /**
   * Builds AI robots meta tag for HTML head
   */
  private buildAiRobotsMeta(
    aiRobots?: AiRobotsDirective,
    aiTraining?: AiRobotsDirective,
  ): string {
    const directives: string[] = [];
    if (aiRobots) directives.push(aiRobots);
    if (aiTraining) directives.push(aiTraining);
    return directives.join(', ');
  }

  /** Restaurant-menu shops present themselves as a menu, not a catalogue. */
  private isMenuStore(store: Pick<Store, 'storeType'>): boolean {
    return store.storeType === StoreType.RESTAURANT_MENU;
  }

  /**
   * Menu titles keep a reserved tail so 60-character previews cannot truncate
   * the word that tells a reader this is a menu.
   */
  private withMenuTitle(title: string): string {
    if (/\bmenus?\b/iu.test(title)) return title;
    const label = ' — Menu';
    return `${this.truncate(title, 60 - label.length)}${label}`;
  }

  /**
   * The menu line leads the description so it survives preview truncation;
   * owner copy follows unchanged when the owner did not mention a menu.
   */
  private withMenuLine(text: string, line: string): string {
    const clean = text.trim();
    if (!line || /\bmenus?\b/iu.test(clean)) return clean;
    return clean ? `${line} ${clean}` : line;
  }

  /** Public item count; a menu preview should say how much there is to browse. */
  private async menuPreviewLine(store: Store): Promise<string> {
    const count = await this.dataSource.manager.count(Product, {
      where: {
        storeId: store.id,
        status: In([...PUBLIC_PRODUCT_STATUSES]),
        ...publicWhere('product'),
      },
    });
    return count > 0
      ? `Browse the menu — ${count} ${count === 1 ? 'item' : 'items'} with prices and photos.`
      : 'Browse the menu with prices and photos.';
  }

  /**
   * Generates a meta title from content, respecting length limits
   */
  private generateMetaTitle(content: string, siteName?: string): string {
    const maxLen = 60;
    const suffix = siteName ? ` | ${siteName}` : '';
    const available = maxLen - suffix.length;
    let title =
      content.length > available
        ? content.slice(0, available - 3).trim() + '...'
        : content;
    return title + suffix;
  }

  /**
   * Generates a meta description from content, respecting length limits
   */
  private generateMetaDescription(
    content: string,
    maxLen: number = 160,
  ): string {
    // Strip HTML tags if any
    const clean = content
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean.length <= maxLen) return clean;
    return clean.slice(0, maxLen - 3).trim() + '...';
  }

  /**
   * Generates comma-separated keywords from an array of terms
   */
  private generateKeywords(terms: (string | null | undefined)[]): string {
    const filtered = terms.filter((t): t is string => !!t && t.length > 0);
    const unique = [...new Set(filtered.map((t) => t.toLowerCase()))];
    return unique.slice(0, 20).join(', ');
  }

  /**
   * Computes SHA-256 hash of content for change detection and AI attribution
   */
  private computeContentHash(content: Record<string, unknown>): string {
    const str = JSON.stringify(content, Object.keys(content).sort());
    return createHash('sha256').update(str).digest('hex');
  }

  /**
   * Generates FAQPage structured data from Q&A pairs
   */
  buildFaqJsonLd(
    faqs: { question: string; answer: string }[],
  ): Record<string, unknown> {
    return {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer,
        },
      })),
    };
  }

  /**
   * Generates HowTo structured data
   */
  async buildHowToJsonLd(data: {
    name: string;
    description: string;
    steps: { name: string; text: string; image?: string }[];
    totalTime?: string;
    estimatedCost?: { currency: string; value: number };
    supply?: { '@type': 'HowToSupply'; name: string }[];
    tool?: { '@type': 'HowToTool'; name: string }[];
  }): Promise<Record<string, unknown>> {
    return {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: data.name,
      description: data.description,
      step: await Promise.all(
        data.steps.map(async (step, index) => ({
          '@type': 'HowToStep',
          position: index + 1,
          name: step.name,
          text: step.text,
          image: await this.buildImageUrl(step.image),
        })),
      ),
      totalTime: data.totalTime,
      estimatedCost: data.estimatedCost,
      supply: data.supply,
      tool: data.tool,
    };
  }
}
