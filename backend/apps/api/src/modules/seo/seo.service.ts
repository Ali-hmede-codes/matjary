import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { plainToInstance, ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminGuard } from '../auth/guards/auth.guards';
import { StorageService } from '@app/storage';
import { StoreSeoDto, ProductSeoDto, ShowcaseSeoDto, SeoSettingsDto, CreateRedirectDto, UpdateRedirectDto, IndexNowDto } from './seo.dto';

type SeoKind = 'store' | 'product' | 'showcase';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
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
  Product,
  Showcase,
  ShowcaseStatus,
  MediaAsset,
  MediaVariant,
  MediaStatus,
  ProductStatus,
  User,
} from '@app/database';

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

export interface IndexNowUrl {
  url: string;
  lastmod?: string;
}

@Injectable()
export class SeoService {
  private readonly logger = new Logger(SeoService.name);
  private readonly baseUrl: string;
  private readonly defaultImageKey: string | null;

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
  ) {
    this.baseUrl =
      this.configService.get<string>('APP_ORIGIN') || 'http://localhost:3000';
    this.defaultImageKey =
      this.configService.get<string>('DEFAULT_OG_IMAGE_KEY') || null;
  }

  // ============================================
  // Settings
  // ============================================

  private async validated<T extends object>(type: ClassConstructor<T>, data: T): Promise<T> {
    const dto = plainToInstance(type, data);
    if ((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length) {
      throw new BadRequestException('Invalid SEO fields');
    }
    return dto;
  }

  private async requireAdmin(actorId: string): Promise<void> {
    const actor = await this.dataSource.manager.findOneBy(User, { id: actorId });
    if (!actor || !this.admin.isAdmin(actor)) throw new ForbiddenException('Admin access required');
  }

  private async ownedEntity(kind: SeoKind, id: string, actorId: string) {
    const manager = this.dataSource.manager;
    if (kind === 'store') {
      const store = await manager.findOneBy(Store, { id, ownerId: actorId });
      if (!store) throw new NotFoundException('Store not found');
      return { store, product: null, showcase: null };
    }
    if (kind === 'product') {
      const product = await manager.findOne(Product, { where: { id, store: { ownerId: actorId } }, relations: ['store'] });
      if (!product) throw new NotFoundException('Product not found');
      return { store: product.store, product, showcase: null };
    }
    const showcase = await manager.findOne(Showcase, { where: { id, ownerId: actorId }, relations: ['store'] });
    if (!showcase) throw new NotFoundException('Post not found');
    return { store: showcase.store ?? null, product: null, showcase };
  }

  async getOwnedSeo(kind: SeoKind, id: string, actorId: string) {
    await this.ownedEntity(kind, id, actorId);
    if (kind === 'store') return this.getStoreSeo(id);
    if (kind === 'product') return this.getProductSeo(id);
    return this.getShowcaseSeo(id);
  }

  async autoGenerateOwnedSeo(kind: SeoKind, id: string, actorId: string) {
    const { store, product, showcase } = await this.ownedEntity(kind, id, actorId);
    if (showcase) return this.autoGenerateShowcaseSeo(showcase, store);
    if (product && store) return this.autoGenerateProductSeo(product, store);
    return this.autoGenerateStoreSeo(store!);
  }

  async getMetaBySlug(kind: SeoKind, slug: string, storeSlug?: string): Promise<MetaTags> {
    const manager = this.dataSource.manager;
    if (kind === 'store') {
      const store = await manager.findOneBy(Store, { slug });
      if (!store) throw new NotFoundException('Store not found');
      return this.generateStoreMetaTags(store);
    }
    if (kind === 'product') {
      // Honor optional store context and reject ambiguous legacy slug data.
      const products = await manager.find(Product, { where: { slug, status: ProductStatus.ACTIVE, ...(storeSlug ? { store: { slug: storeSlug } } : {}) }, relations: ['store'], take: 2 });
      if (!products.length) throw new NotFoundException('Product not found');
      if (products.length !== 1) throw new BadRequestException('Specify storeSlug for this product');
      return this.generateProductMetaTags(products[0]!, products[0]!.store);
    }
    const showcase = await manager.findOne(Showcase, { where: { slug, status: ShowcaseStatus.PUBLISHED }, relations: ['store'] });
    if (!showcase) throw new NotFoundException('Post not found');
    return this.generateShowcaseMetaTags(showcase, showcase.store ?? null);
  }

  private assertSiteUrl(value: string): void {
    try {
      const url = new URL(value);
      if (url.origin === new URL(this.baseUrl).origin && !url.username && !url.password) return;
    } catch { /* Invalid URLs fail closed. */ }
    throw new BadRequestException('URL must belong to the application origin');
  }

  private async checkMetadata(data: { canonicalUrl?: string | null; ogImageKey?: string | null }, actorId: string) {
    if (data.canonicalUrl) this.assertSiteUrl(data.canonicalUrl);
    if (data.ogImageKey) {
      const variant = await this.dataSource.manager.findOne(MediaVariant, { where: { storageKey: data.ogImageKey, asset: { showcase: { ownerId: actorId }, status: MediaStatus.READY } } });
      if (!variant) throw new BadRequestException('Image must be an owned ready media variant');
    }
  }

  async getAdminSettings(actorId: string): Promise<SeoSettings> {
    await this.requireAdmin(actorId);
    return this.getSettings();
  }

  private async getSettings(): Promise<SeoSettings> {
    // The migration seeds settings. Reads must not create competing singleton
    // rows, and TypeORM findOne requires a where clause.
    const [settings] = await this.settingsRepo.find({ take: 1, order: { createdAt: 'ASC' } });
    if (!settings) throw new ServiceUnavailableException('SEO settings are unavailable');
    return settings;
  }

  async updateSettings(data: SeoSettingsDto, actorId: string): Promise<SeoSettings> {
    await this.requireAdmin(actorId);
    data = await this.validated(SeoSettingsDto, data);
    if (data.indexNowKeyLocation) this.assertSiteUrl(data.indexNowKeyLocation);
    for (const key of [data.defaultOgImageKey, data.organizationLogoKey]) {
      if (key && !(await this.buildImageUrl(key))) throw new BadRequestException('Image must be a public ready variant');
    }
    const settings = await this.getSettings();
    Object.assign(settings, data);
    return this.settingsRepo.save(settings);
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
      Object.assign(seo, data);
    }
    return this.storeSeoRepo.save(seo);
  }

  async deleteStoreSeo(storeId: string, actorId: string): Promise<void> {
    await this.ownedEntity('store', storeId, actorId);
    await this.storeSeoRepo.delete({ storeId });
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
    const { product } = await this.ownedEntity('product', productId, actorId);
    const storeId = product!.storeId;
    data = await this.validated(ProductSeoDto, data);
    await this.checkMetadata(data, actorId);
    let seo = await this.productSeoRepo.findOneBy({ productId });
    if (!seo) {
      seo = this.productSeoRepo.create({ productId, storeId, ...data });
    } else {
      Object.assign(seo, data);
    }
    return this.productSeoRepo.save(seo);
  }

  async deleteProductSeo(productId: string, actorId: string): Promise<void> {
    await this.ownedEntity('product', productId, actorId);
    await this.productSeoRepo.delete({ productId });
  }

  // ============================================
  // Showcase/Post SEO
  // ============================================

  private async getShowcaseSeo(showcaseId: string): Promise<ShowcaseSeo | null> {
    return this.showcaseSeoRepo.findOneBy({ showcaseId });
  }

  async upsertShowcaseSeo(
    showcaseId: string,
    data: ShowcaseSeoDto,
    actorId: string,
  ): Promise<ShowcaseSeo> {
    const { showcase } = await this.ownedEntity('showcase', showcaseId, actorId);
    const storeId = showcase!.storeId;
    data = await this.validated(ShowcaseSeoDto, data);
    await this.checkMetadata(data, actorId);
    let seo = await this.showcaseSeoRepo.findOneBy({ showcaseId });
    if (!seo) {
      seo = this.showcaseSeoRepo.create({ showcaseId, storeId, ...data });
    } else {
      Object.assign(seo, data);
    }
    return this.showcaseSeoRepo.save(seo);
  }

  async deleteShowcaseSeo(showcaseId: string, actorId: string): Promise<void> {
    await this.ownedEntity('showcase', showcaseId, actorId);
    await this.showcaseSeoRepo.delete({ showcaseId });
  }

  // ============================================
  // Redirects
  // ============================================

  async getRedirect(fromPath: string): Promise<SeoRedirect | null> {
    return this.redirectRepo.findOneBy({ fromPath, isActive: true });
  }

  async getRedirects(actorId: string, storeId?: string): Promise<SeoRedirect[]> {
    await this.requireAdmin(actorId);
    const where = storeId ? { storeId, isActive: true } : { isActive: true };
    return this.redirectRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async createRedirect(data: CreateRedirectDto, actorId: string): Promise<SeoRedirect> {
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
    const redirect = this.redirectRepo.create(data);
    return this.redirectRepo.save(redirect);
  }

  async updateRedirect(
    id: string,
    data: UpdateRedirectDto,
    actorId: string,
  ): Promise<SeoRedirect> {
    await this.requireAdmin(actorId);
    data = await this.validated(UpdateRedirectDto, data);
    if (data.fromPath) this.assertSiteUrl(new URL(data.fromPath, this.baseUrl).href);
    if (data.toPath) this.assertSiteUrl(new URL(data.toPath, this.baseUrl).href);
    const redirect = await this.redirectRepo.findOneBy({ id });
    if (!redirect) {
      throw new NotFoundException('Redirect not found');
    }
    Object.assign(redirect, data);
    return this.redirectRepo.save(redirect);
  }

  async deleteRedirect(id: string, actorId: string): Promise<void> {
    await this.requireAdmin(actorId);
    await this.redirectRepo.delete(id);
  }

  // ============================================
  // AUTOMATIC SEO GENERATION (Core Feature)
  // ============================================

  /**
   * Automatically generates SEO meta tags from entity content.
   * Called when SEO record doesn't exist or when auto-regeneration is triggered.
   * Users never need to manually configure SEO - it works out of the box.
   */
  async autoGenerateStoreSeo(store: Store): Promise<StoreSeo> {
    let seo = await this.getStoreSeo(store.id);
    const settings = await this.getSettings();
    const autoFields: string[] = [];

    if (!seo) {
      seo = this.storeSeoRepo.create({ storeId: store.id });
    }

    // Auto-generate meta title from store name
    if (!seo.metaTitle) {
      seo.metaTitle = this.generateMetaTitle(store.name, settings.siteName);
      autoFields.push('metaTitle');
    }

    // Auto-generate meta description from store description
    if (!seo.metaDescription) {
      seo.metaDescription = this.generateMetaDescription(
        store.description || '',
        160,
      );
      autoFields.push('metaDescription');
    }

    // Auto-generate keywords from store type and categories
    if (!seo.metaKeywords) {
      seo.metaKeywords = this.generateKeywords([
        store.storeType,
        'shop',
        'online store',
        settings.siteName,
      ]);
      autoFields.push('metaKeywords');
    }

    // Auto-generate OG tags
    if (!seo.ogTitle) {
      seo.ogTitle = store.name;
      autoFields.push('ogTitle');
    }
    if (!seo.ogDescription) {
      seo.ogDescription = this.generateMetaDescription(
        store.description || '',
        160,
      );
      autoFields.push('ogDescription');
    }
    if (!seo.ogImageKey) {
      seo.ogImageKey = store.logoKey || settings.defaultOgImageKey || null;
      autoFields.push('ogImageKey');
    }
    if (!seo.ogSiteName) {
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
      logoKey: store.logoKey,
    });
    seo.contentHash = contentHash;
    seo.autoGeneratedFields = autoFields;
    seo.lastAutoGeneratedAt = new Date();

    return this.storeSeoRepo.save(seo);
  }

  async autoGenerateProductSeo(
    product: Product,
    store: Store,
  ): Promise<ProductSeo> {
    let seo = await this.getProductSeo(product.id);
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
        product.description || `Buy ${product.name} from ${store.name}`,
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
        'buy',
        'shop',
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

    return this.productSeoRepo.save(seo);
  }

  async autoGenerateShowcaseSeo(
    showcase: Showcase,
    store: Store | null,
  ): Promise<ShowcaseSeo> {
    let seo = await this.getShowcaseSeo(showcase.id);
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
    if (!seo.ogImageKey) {
      // Try to get first media asset image
      seo.ogImageKey = store?.logoKey || settings.defaultOgImageKey || null;
      autoFields.push('ogImageKey');
    }

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

    return this.showcaseSeoRepo.save(seo);
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

  async generateStoreMetaTags(store: Store): Promise<MetaTags> {
    // Ensure SEO exists (auto-generate if needed)
    let seo = await this.getStoreSeo(store.id);
    if (!seo) {
      seo = await this.autoGenerateStoreSeo(store);
    }
    const settings = await this.getSettings();

    const title =
      seo.metaTitle || store.name || settings.defaultTitle || 'Matjary';
    const description =
      seo.metaDescription ||
      store.description ||
      settings.defaultDescription ||
      '';
    const canonical = seo.canonicalUrl || this.baseUrl + '/shop/' + store.slug;

    const ogImage = await this.buildImageUrl(
      seo.ogImageKey || store.logoKey || settings.defaultOgImageKey,
    );
    const ogTitle = seo.ogTitle || store.name;
    const ogDescription = seo.ogDescription || store.description || description;

    // Build AI robots meta
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
        type: seo.ogType || 'website',
        siteName: seo.ogSiteName || settings.siteName,
        url: canonical,
        locale: 'en_US',
      },
      twitter: {
        card: seo.twitterCard || 'summary_large_image',
        site: seo.twitterSite ?? settings.twitterSite ?? undefined,
        creator: seo.twitterCreator ?? undefined,
        title: this.truncate(ogTitle, 70),
        description: this.truncate(ogDescription, 200),
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
    if (product.status !== ProductStatus.ACTIVE) throw new NotFoundException('Product not found');
    // Ensure SEO exists (auto-generate if needed)
    let seo = await this.getProductSeo(product.id);
    if (!seo) {
      seo = await this.autoGenerateProductSeo(product, store);
    }
    const settings = await this.getSettings();

    const title = seo.metaTitle || product.name + ' - ' + store.name;
    const description = seo.metaDescription || product.description || '';
    const canonical =
      seo.canonicalUrl ||
      this.baseUrl + '/shop/' + store.slug + '/product/' + product.slug;

    const ogImage = await this.buildImageUrl(
      seo.ogImageKey ??
        product.imageKeys?.[0] ??
        store.logoKey ??
        settings.defaultOgImageKey,
    );
    const ogTitle = seo.ogTitle || product.name;
    const ogDescription =
      seo.ogDescription || product.description || description;

    const price = (parseInt(product.priceCents, 10) / 100).toFixed(2);
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
      jsonLd: await this.buildProductJsonLd(product, store, seo, price, isInStock),
      verificationMeta: this.buildVerificationMeta(settings),
      aiRobots,
      aiTraining: seo.aiTraining || undefined,
    };
  }

  async generateShowcaseMetaTags(
    showcase: Showcase,
    store: Store | null,
  ): Promise<MetaTags> {
    if (showcase.status !== ShowcaseStatus.PUBLISHED) throw new NotFoundException('Post not found');
    // Ensure SEO exists (auto-generate if needed)
    let seo = await this.getShowcaseSeo(showcase.id);
    if (!seo) {
      seo = await this.autoGenerateShowcaseSeo(showcase, store);
    }
    const settings = await this.getSettings();

    const title = seo.metaTitle || showcase.title;
    const description = seo.metaDescription || showcase.description || '';
    const canonical =
      seo.canonicalUrl ||
      (store
        ? this.baseUrl + '/shop/' + store.slug + '/post/' + showcase.slug
        : this.baseUrl + '/post/' + showcase.slug);

    const ogImage = await this.buildImageUrl(
      seo.ogImageKey ?? store?.logoKey ?? settings.defaultOgImageKey,
    );
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
      jsonLd: await this.buildArticleJsonLd(showcase, store, seo),
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
    const canonical = this.baseUrl + path;

    return {
      title: options.title ? this.truncate(options.title, 60) : 'Matjary',
      description: options.description
        ? this.truncate(options.description, 160)
        : '',
      robots: options.robots || RobotsDirective.INDEX_FOLLOW,
      canonical,
      og: {
        title: options.title || 'Matjary',
        description: options.description || '',
        image: await this.buildImageUrl(this.defaultImageKey),
        type: options.ogType || 'website',
        siteName: 'Matjary',
        url: canonical,
        locale: 'en_US',
      },
      twitter: {
        card: 'summary_large_image',
        title: options.title || 'Matjary',
        description: options.description || '',
        image: await this.buildImageUrl(this.defaultImageKey),
      },
    };
  }

  // ============================================
  // JSON-LD Structured Data Builders (Enhanced 2026)
  // ============================================

  private async buildStoreJsonLd(
    store: Store,
    seo: StoreSeo | null,
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
        logo: settings.organizationLogoKey
          ? await this.buildImageUrl(settings.organizationLogoKey)
          : undefined,
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

    // Store/Restaurant schema
    if (seo?.structuredData) {
      jsonLd.push(seo.structuredData);
    } else {
      const storeSchema: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': store.storeType === 'restaurant_menu' ? 'Restaurant' : 'Store',
        name: store.name,
        url: this.baseUrl + '/shop/' + store.slug,
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
        { name: store.name, url: this.baseUrl + '/shop/' + store.slug },
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
      url: this.baseUrl + '/shop/' + store.slug + '/product/' + product.slug,
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
      image: (await Promise.all((product.imageKeys ?? []).map((key) => this.buildImageUrl(key)))).filter(Boolean),
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
        { name: store.name, url: this.baseUrl + '/shop/' + store.slug },
        {
          name: 'Products',
          url: this.baseUrl + '/shop/' + store.slug + '/products',
        },
        {
          name: product.name,
          url:
            this.baseUrl + '/shop/' + store.slug + '/product/' + product.slug,
        },
      ]),
    );

    return jsonLd;
  }

  private async buildArticleJsonLd(
    showcase: Showcase,
    store: Store | null,
    seo: ShowcaseSeo | null,
  ): Promise<Record<string, unknown>[]> {
    const jsonLd: Record<string, unknown>[] = [];

    const articleSchema: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: showcase.title,
      description: showcase.description,
      image: await this.buildImageUrl(seo?.ogImageKey),
      datePublished:
        seo?.articlePublishedTime?.toISOString() ||
        showcase.publishedAt?.toISOString() ||
        showcase.createdAt.toISOString(),
      dateModified:
        seo?.articleModifiedTime?.toISOString() ||
        showcase.updatedAt.toISOString(),
      author: {
        '@type': 'Person',
        name: seo?.articleAuthor || (store ? store.name : 'Matjary'),
      },
      publisher: {
        '@type': 'Organization',
        name: 'Matjary',
        logo: {
          '@type': 'ImageObject',
          url: (await this.buildImageUrl(this.defaultImageKey)) || this.baseUrl,
        },
      },
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id':
          this.baseUrl +
          (store
            ? '/shop/' + store.slug + '/post/' + showcase.slug
            : '/post/' + showcase.slug),
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
        url: this.baseUrl + '/shop/' + store.slug,
      });
      breadcrumbs.push({
        name: 'Posts',
        url: this.baseUrl + '/shop/' + store.slug + '/posts',
      });
    }
    breadcrumbs.push({
      name: showcase.title,
      url:
        this.baseUrl +
        (store
          ? '/shop/' + store.slug + '/post/' + showcase.slug
          : '/post/' + showcase.slug),
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
        'Welcome to Matjary - Your Showcase Platform',
      priority: 'high',
    });

    // Stores
    const stores = await this.storeSeoRepo
      .createQueryBuilder('ss')
      .leftJoinAndSelect('ss.store', 'store')
      .getMany();

    for (const seo of stores) {
      if (seo.store && !seo.robots?.includes('noindex')) {
        entries.push({
          title: seo.store.name,
          url: this.baseUrl + '/shop/' + seo.store.slug,
          description: seo.store.description || `Shop by ${seo.store.name}`,
          priority: 'high',
        });

        entries.push({
          title: `${seo.store.name} - Products`,
          url: this.baseUrl + '/shop/' + seo.store.slug + '/products',
          description: `Browse products from ${seo.store.name}`,
          priority: 'medium',
        });

        entries.push({
          title: `${seo.store.name} - Posts`,
          url: this.baseUrl + '/shop/' + seo.store.slug + '/posts',
          description: `Read posts from ${seo.store.name}`,
          priority: 'medium',
        });
      }
    }

    // Products
    const productSeos = await this.productSeoRepo.find();
    for (const seo of productSeos) {
      if (
        seo.robots === RobotsDirective.NOINDEX_NOFOLLOW ||
        seo.robots === RobotsDirective.NOINDEX_FOLLOW
      )
        continue;
      const product = await this.dataSource.manager.findOne(Product, { where: { id: seo.productId, status: ProductStatus.ACTIVE }, relations: ['store'] });
      if (product) {
        entries.push({
          title: product.name,
          url: `${this.baseUrl}/shop/${product.store.slug}/product/${product.slug}`,
          description: product.description?.substring(0, 200) || product.name,
          priority: 'medium',
        });
      }
    }

    // Showcases/Posts
    const showcaseSeos = await this.showcaseSeoRepo.find();
    for (const seo of showcaseSeos) {
      if (
        seo.robots === RobotsDirective.NOINDEX_NOFOLLOW ||
        seo.robots === RobotsDirective.NOINDEX_FOLLOW
      )
        continue;
      const showcase = await this.showcaseSeoRepo.manager
        .createQueryBuilder(Showcase, 's')
        .select(['s.id', 's.slug', 's.title', 's.description', 's.status'])
        .where('s.id = :id', { id: seo.showcaseId })
        .andWhere('s.status = :status', { status: ShowcaseStatus.PUBLISHED })
        .getRawOne();
      if (showcase) {
        entries.push({
          title: showcase.s_title,
          url: this.baseUrl + '/post/' + showcase.s_slug,
          description:
            showcase.s_description?.substring(0, 200) || showcase.s_title,
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
    return this.submitToIndexNow(data.urls);
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

    let url: string;
    if (entityType === 'store') {
      url = this.baseUrl + '/shop/' + (entity as Store).slug;
    } else if (entityType === 'product') {
      const product = entity as Product;
      if (product.status !== ProductStatus.ACTIVE) return;
      const store = await this.dataSource.manager.findOneBy(Store, { id: product.storeId });
      if (!store) return;
      url = this.baseUrl + '/shop/' + store.slug + '/product/' + product.slug;
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
    const indexable = (seo: { robots: RobotsDirective } | null) => !seo?.robots?.includes('noindex');
    const manager = this.dataSource.manager;
    if (!kind) urls.push({ url: this.baseUrl, changefreq: settings.sitemapChangefreq, priority: 1 });
    if (!kind || kind === 'store') {
      for (const store of await manager.find(Store)) {
        const seo = await this.getStoreSeo(store.id);
        if (!indexable(seo)) continue;
        urls.push({ url: seo?.canonicalUrl || `${this.baseUrl}/shop/${store.slug}`, lastmod: store.updatedAt.toISOString().split('T')[0], changefreq: 'weekly', priority: 0.8 });
      }
    }
    if (!kind || kind === 'product') {
      for (const product of await manager.find(Product, { where: { status: ProductStatus.ACTIVE }, relations: ['store'] })) {
        const seo = await this.getProductSeo(product.id);
        if (!indexable(seo)) continue;
        const images: SitemapImage[] = [];
        for (const key of product.imageKeys ?? []) {
          const url = await this.buildImageUrl(key);
          if (url) images.push({ url, title: product.name });
        }
        urls.push({ url: seo?.canonicalUrl || `${this.baseUrl}/shop/${product.store.slug}/product/${product.slug}`, lastmod: product.updatedAt.toISOString().split('T')[0], changefreq: 'weekly', priority: 0.6, images });
      }
    }
    if (!kind || kind === 'showcase') {
      for (const showcase of await manager.find(Showcase, { where: { status: ShowcaseStatus.PUBLISHED } })) {
        const seo = await this.getShowcaseSeo(showcase.id);
        if (!indexable(seo)) continue;
        urls.push({ url: seo?.canonicalUrl || `${this.baseUrl}/post/${showcase.slug}`, lastmod: showcase.updatedAt.toISOString().split('T')[0], changefreq: 'monthly', priority: 0.5 });
      }
    }
    return urls;
  }

  async generateSitemapXml(kind?: SeoKind): Promise<string> {
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

  private async buildImageUrl(key: string | null | undefined): Promise<string | undefined> {
    if (!key) return undefined;
    // Never advertise originals, arbitrary keys, or media belonging to drafts.
    const variant = await this.dataSource.manager.findOne(MediaVariant, {
      where: { storageKey: key, asset: { status: MediaStatus.READY, showcase: { status: ShowcaseStatus.PUBLISHED } } },
    });
    if (!variant || !variant.mimeType.startsWith('image/')) return undefined;
    return this.storage.presignedGetUrl(key);
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
      step: await Promise.all(data.steps.map(async (step, index) => ({
        '@type': 'HowToStep',
        position: index + 1,
        name: step.name,
        text: step.text,
        image: await this.buildImageUrl(step.image),
      }))),
      totalTime: data.totalTime,
      estimatedCost: data.estimatedCost,
      supply: data.supply,
      tool: data.tool,
    };
  }
}
