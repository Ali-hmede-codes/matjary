import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';

export enum ShowcaseStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

export enum MediaKind {
  IMAGE = 'image',
  VIDEO = 'video',
}

export enum MediaStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

export enum StoreSubscriptionTier {
  FREE = 'free',
  BASIC = 'basic',
  PREMIUM = 'premium',
}

export enum SubscriptionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  PENDING = 'pending',
}

export enum BillingCycle {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
  LIFETIME = 'lifetime',
}

export interface SubscriptionLimits {
  // Video limits
  maxVideoDurationSeconds?: number; // null = unlimited
  maxVideoSizeBytes?: number; // null = unlimited
  maxVideoQuality?: string; // e.g., '1080p', '720p', '480p'

  // Image limits
  maxImageCount?: number; // null = unlimited
  maxImageSizeBytes?: number; // null = unlimited
  maxImageWidth?: number; // null = unlimited
  maxImageHeight?: number; // null = unlimited

  // Post limits
  maxPostsPerMonth?: number; // null = unlimited
  maxTotalPosts?: number; // null = unlimited

  // Product limits (for ecommerce)
  maxProducts?: number; // null = unlimited (for ecommerce shops)

  // Storage limits
  maxStorageBytes?: number; // null = unlimited

  // Feature flags
  enableCart?: boolean;
  enableWhatsAppCheckout?: boolean;
  enableAnalytics?: boolean;
  enableCustomDomain?: boolean;
  enablePrioritySupport?: boolean;

  // Verification Badge limits
  maxVerificationBadges?: number; // null = unlimited, 0 = no badges allowed
  verificationBadgePriceCents?: number; // price per badge in cents (0 or null = free)
}

export interface DesignSettings {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  borderRadius?: string;
  layout?: 'grid' | 'list' | 'masonry';
  showProductImages?: boolean;
  showProductDescriptions?: boolean;
  customCss?: string;
}

export enum StoreType {
  ECOMMERCE = 'ecommerce',
  RESTAURANT_MENU = 'restaurant_menu',
}

export interface SocialMediaLinks {
  instagram?: string;
  facebook?: string;
  twitter?: string;
  tiktok?: string;
  youtube?: string;
  website?: string;
  whatsapp?: string;
  telegram?: string;
}

abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 })
  updatedAt!: Date;
}

@Entity({ name: 'users', engine: 'InnoDB' })
@Index('uq_users_email', ['email'], { unique: true })
@Index('uq_users_google_subject', ['googleSubject'], { unique: true })
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 254 })
  email!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 120 })
  displayName!: string;

  // Google accounts have no local password. Preserve hashes for existing accounts.
  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    select: false,
    nullable: true,
  })
  passwordHash!: string | null;

  @Column({
    name: 'google_subject',
    type: 'varchar',
    length: 255,
    collation: 'utf8mb4_bin',
    nullable: true,
    select: false,
  })
  googleSubject!: string | null;

  @OneToMany(() => Showcase, (showcase) => showcase.owner)
  showcases!: Relation<Showcase[]>;

  @OneToMany(() => Store, (store) => store.owner)
  stores!: Relation<Store[]>;
}

@Entity({ name: 'showcases', engine: 'InnoDB' })
@Index('uq_showcases_slug', ['slug'], { unique: true })
@Index('idx_showcases_owner_created', ['ownerId', 'createdAt'])
@Index('idx_showcases_status_published', ['status', 'publishedAt'])
@Index('idx_showcases_store', ['storeId'])
@Index('idx_showcases_owner_status_created', ['ownerId', 'status', 'createdAt'])
@Index('idx_showcases_store_created', ['storeId', 'createdAt'])
export class Showcase extends BaseEntity {
  @Column({ name: 'owner_id', type: 'varchar', length: 36 })
  ownerId!: string;

  @Column({ name: 'store_id', type: 'varchar', length: 36, nullable: true })
  storeId!: string | null;

  @ManyToOne(() => User, (user) => user.showcases, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'fk_showcases_owner',
  })
  owner!: Relation<User>;

  @ManyToOne(() => Store, (store) => store.posts, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'store_id',
    foreignKeyConstraintName: 'fk_showcases_store',
  })
  store!: Relation<Store | null>;

  @Column({ type: 'varchar', length: 191 })
  slug!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'enum', enum: ShowcaseStatus, default: ShowcaseStatus.DRAFT })
  status!: ShowcaseStatus;

  @Column({
    name: 'published_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  publishedAt!: Date | null;

  // Denormalized counters for performance (updated by worker/flusher)
  @Column({ name: 'media_count', type: 'int', unsigned: true, default: 0 })
  mediaCount!: number;

  @Column({ name: 'likes_count', type: 'int', unsigned: true, default: 0 })
  likesCount!: number;

  @Column({ name: 'views_count', type: 'int', unsigned: true, default: 0 })
  viewsCount!: number;

  @OneToMany(() => MediaAsset, (asset) => asset.showcase)
  mediaAssets!: Relation<MediaAsset[]>;
}

@Entity({ name: 'stores', engine: 'InnoDB' })
@Index('uq_stores_slug', ['slug'], { unique: true })
@Index('idx_stores_owner', ['ownerId'])
export class Store extends BaseEntity {
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 191 })
  slug!: string;

  @Column({ name: 'owner_id', type: 'varchar', length: 36 })
  ownerId!: string;

  @ManyToOne(() => User, (user) => user.stores, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'fk_stores_owner',
  })
  owner!: Relation<User>;

  // Branding fields
  @Column({ name: 'brand_color', type: 'varchar', length: 7, nullable: true })
  brandColor!: string | null; // Hex color like #FF5733

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({
    name: 'social_media_links',
    type: 'json',
    nullable: true,
  })
  socialMediaLinks!: SocialMediaLinks | null;

  // Media references (storage keys for logo/banner images)
  @Column({ name: 'logo_key', type: 'varchar', length: 512, nullable: true })
  logoKey!: string | null;

  @Column({ name: 'banner_key', type: 'varchar', length: 512, nullable: true })
  bannerKey!: string | null;

  @Column({
    type: 'enum',
    enum: StoreSubscriptionTier,
    default: StoreSubscriptionTier.FREE,
  })
  subscriptionTier!: StoreSubscriptionTier;

  @Column({
    name: 'subscription_expires_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  subscriptionExpiresAt!: Date | null;

  @Column({
    name: 'store_type',
    type: 'enum',
    enum: StoreType,
    default: StoreType.ECOMMERCE,
  })
  storeType!: StoreType;

  @Column({ name: 'posts_count_this_month', type: 'int', default: 0 })
  postsCountThisMonth!: number;

  // Feature flags
  @Column({ name: 'enable_cart', type: 'boolean', default: true })
  enableCart!: boolean;

  @Column({ name: 'enable_whatsapp_checkout', type: 'boolean', default: true })
  enableWhatsAppCheckout!: boolean;

  // Design/theme settings (colors, layout, fonts, etc.)
  @Column({ name: 'design_settings', type: 'json', nullable: true })
  designSettings!: DesignSettings | null;

  // Location fields (optional - for map display)
  @Column({
    name: 'latitude',
    type: 'decimal',
    precision: 10,
    scale: 8,
    nullable: true,
  })
  latitude!: number | null; // Decimal degrees, e.g., 33.8938

  @Column({
    name: 'longitude',
    type: 'decimal',
    precision: 11,
    scale: 8,
    nullable: true,
  })
  longitude!: number | null; // Decimal degrees, e.g., 35.5018

  @Column({ name: 'address', type: 'varchar', length: 500, nullable: true })
  address!: string | null; // Full street address

  @Column({ name: 'city', type: 'varchar', length: 100, nullable: true })
  city!: string | null; // City name (e.g., "Beirut")

  @Column({
    name: 'country',
    type: 'varchar',
    length: 100,
    nullable: true,
    default: 'Lebanon',
  })
  country!: string | null; // Country name (default: Lebanon)

  @Column({ name: 'postal_code', type: 'varchar', length: 20, nullable: true })
  postalCode!: string | null; // Postal/ZIP code

  @Column({
    name: 'location_name',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  locationName!: string | null; // Custom location name (e.g., "Beirut Mall")

  @Column({ name: 'phone', type: 'varchar', length: 30, nullable: true })
  phone!: string | null; // Store phone number

  @Column({ name: 'website', type: 'varchar', length: 500, nullable: true })
  website!: string | null; // Store website URL

  @Column({ name: 'opening_hours', type: 'json', nullable: true })
  openingHours!: Record<string, string> | null; // e.g., {"mon": "9:00-18:00", "tue": "9:00-18:00"}

  // Verification Badge fields
  @Column({ name: 'has_verification_badge', type: 'boolean', default: false })
  hasVerificationBadge!: boolean;

  @Column({
    name: 'verification_badge_granted_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  verificationBadgeGrantedAt!: Date | null;

  @Column({
    name: 'verification_badge_granted_by',
    type: 'varchar',
    length: 36,
    nullable: true,
  })
  verificationBadgeGrantedBy!: string | null; // Admin user ID who granted the badge

  @Column({
    name: 'verification_badge_expires_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  verificationBadgeExpiresAt!: Date | null; // Optional: badge expiration

  @OneToMany(() => Showcase, (showcase) => showcase.store)
  posts!: Relation<Showcase[]>;

  @OneToMany(() => Product, (product) => product.store)
  products!: Relation<Product[]>;
}

export interface DesignSettings {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  borderRadius?: string;
  layout?: 'grid' | 'list' | 'masonry';
  showProductImages?: boolean;
  showProductDescriptions?: boolean;
  customCss?: string;
}

@Entity({ name: 'subscription_plans', engine: 'InnoDB' })
@Index('uq_subscription_plans_slug', ['slug'], { unique: true })
@Index('idx_subscription_plans_active', ['isActive'])
export class SubscriptionPlan extends BaseEntity {
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 100 })
  slug!: string; // e.g., 'free', 'basic', 'premium', 'enterprise'

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // Price in cents (0 for free plans)
  @Column({ name: 'price_cents', type: 'bigint', unsigned: true, default: 0 })
  priceCents!: string;

  @Column({ name: 'currency', type: 'varchar', length: 3, default: 'USD' })
  currency!: string;

  @Column({
    type: 'enum',
    enum: BillingCycle,
    default: BillingCycle.MONTHLY,
  })
  billingCycle!: BillingCycle;

  // Limits as JSON
  @Column({ name: 'limits', type: 'json' })
  limits!: SubscriptionLimits;

  // Whether this plan is available for new subscriptions
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  // Sort order for display
  @Column({ name: 'sort_order', type: 'int', unsigned: true, default: 0 })
  sortOrder!: number;

  // Legacy tier mapping (for backward compatibility)
  @Column({
    name: 'legacy_tier',
    type: 'enum',
    enum: StoreSubscriptionTier,
    nullable: true,
  })
  legacyTier!: StoreSubscriptionTier | null;

  @OneToMany(() => UserSubscription, (us) => us.plan)
  userSubscriptions!: Relation<UserSubscription[]>;
}

@Entity({ name: 'user_subscriptions', engine: 'InnoDB' })
@Index('idx_user_subscriptions_user', ['userId'])
@Index('idx_user_subscriptions_plan', ['planId'])
@Index('idx_user_subscriptions_status', ['status'])
@Index('idx_user_subscriptions_expires', ['expiresAt'])
export class UserSubscription extends BaseEntity {
  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_user_subscriptions_user',
  })
  user!: Relation<User>;

  @Column({ name: 'plan_id', type: 'varchar', length: 36 })
  planId!: string;

  @ManyToOne(() => SubscriptionPlan, (plan) => plan.userSubscriptions, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'plan_id',
    foreignKeyConstraintName: 'fk_user_subscriptions_plan',
  })
  plan!: Relation<SubscriptionPlan>;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.PENDING,
  })
  status!: SubscriptionStatus;

  @Column({
    name: 'starts_at',
    type: 'datetime',
    precision: 6,
  })
  startsAt!: Date;

  @Column({
    name: 'expires_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  expiresAt!: Date | null;

  // For manual admin assignment
  @Column({ name: 'assigned_by', type: 'varchar', length: 36, nullable: true })
  assignedBy!: string | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  // Stripe/subscription provider reference
  @Column({ name: 'external_id', type: 'varchar', length: 255, nullable: true })
  externalId!: string | null;

  @Column({
    name: 'external_status',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  externalStatus!: string | null;
}

export enum ProductStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
  OUT_OF_STOCK = 'out_of_stock',
}

export enum ProductCategory {
  FOOD = 'food',
  BEVERAGE = 'beverage',
  MERCHANDISE = 'merchandise',
  SERVICE = 'service',
  OTHER = 'other',
}

@Entity({ name: 'products', engine: 'InnoDB' })
@Index('uq_products_slug', ['slug'], { unique: true })
@Index('idx_products_store', ['storeId'])
@Index('idx_products_status', ['status'])
@Index('idx_products_category', ['category'])
@Index('idx_products_store_status_created', ['storeId', 'status', 'createdAt'])
export class Product extends BaseEntity {
  @Column({ name: 'store_id', type: 'varchar', length: 36 })
  storeId!: string;

  @ManyToOne(() => Store, (store) => store.products, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'store_id',
    foreignKeyConstraintName: 'fk_products_store',
  })
  store!: Relation<Store>;

  @Column({ type: 'varchar', length: 191 })
  slug!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // Price in smallest currency unit (e.g., cents for USD, fils for SAR)
  @Column({ name: 'price_cents', type: 'bigint', unsigned: true })
  priceCents!: string;

  @Column({ name: 'currency', type: 'varchar', length: 3, default: 'USD' })
  currency!: string;

  @Column({
    type: 'enum',
    enum: ProductCategory,
    default: ProductCategory.OTHER,
  })
  category!: ProductCategory;

  @Column({ type: 'enum', enum: ProductStatus, default: ProductStatus.DRAFT })
  status!: ProductStatus;

  // SKU for inventory management
  @Column({ name: 'sku', type: 'varchar', length: 100, nullable: true })
  sku!: string | null;

  // Stock quantity (null = unlimited/track disabled)
  @Column({
    name: 'stock_quantity',
    type: 'int',
    unsigned: true,
    nullable: true,
  })
  stockQuantity!: number | null;

  // Weight in grams for shipping
  @Column({ name: 'weight_grams', type: 'int', unsigned: true, nullable: true })
  weightGrams!: number | null;

  // Media references for product images
  @Column({ name: 'image_keys', type: 'json', nullable: true })
  imageKeys!: string[] | null; // Array of storage keys

  // Tags for filtering/search
  @Column({ type: 'json', nullable: true })
  tags!: string[] | null;

  // Sort order within store
  @Column({ name: 'sort_order', type: 'int', unsigned: true, default: 0 })
  sortOrder!: number;

  // Whether product requires shipping
  @Column({ name: 'requires_shipping', type: 'boolean', default: true })
  requiresShipping!: boolean;
}

export enum CartStatus {
  ACTIVE = 'active',
  CHECKED_OUT = 'checked_out',
  ABANDONED = 'abandoned',
  EXPIRED = 'expired',
}

@Entity({ name: 'carts', engine: 'InnoDB' })
@Index('idx_carts_user', ['userId'])
@Index('idx_carts_visitor', ['visitorId'])
@Index('idx_carts_store', ['storeId'])
@Index('idx_carts_status', ['status'])
export class Cart extends BaseEntity {
  @Column({ name: 'user_id', type: 'varchar', length: 36, nullable: true })
  userId!: string | null;

  @Column({ name: 'visitor_id', type: 'varchar', length: 255, nullable: true })
  visitorId!: string | null;

  @Column({ name: 'store_id', type: 'varchar', length: 36 })
  storeId!: string;

  @ManyToOne(() => Store, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'store_id',
    foreignKeyConstraintName: 'fk_carts_store',
  })
  store!: Relation<Store>;

  @Column({ name: 'currency', type: 'varchar', length: 3, default: 'USD' })
  currency!: string;

  @Column({
    type: 'enum',
    enum: CartStatus,
    default: CartStatus.ACTIVE,
  })
  status!: CartStatus;

  @Column({ name: 'customer_notes', type: 'text', nullable: true })
  customerNotes!: string | null;

  @Column({
    name: 'expires_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  expiresAt!: Date | null;

  @OneToMany(() => CartItem, (item) => item.cart)
  items!: Relation<CartItem[]>;
}

@Entity({ name: 'cart_items', engine: 'InnoDB' })
@Index('idx_cart_items_cart', ['cartId'])
@Index('idx_cart_items_product', ['productId'])
export class CartItem extends BaseEntity {
  @Column({ name: 'cart_id', type: 'varchar', length: 36 })
  cartId!: string;

  @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'cart_id',
    foreignKeyConstraintName: 'fk_cart_items_cart',
  })
  cart!: Relation<Cart>;

  @Column({ name: 'product_id', type: 'varchar', length: 36 })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'fk_cart_items_product',
  })
  product!: Relation<Product>;

  @Column({ name: 'quantity', type: 'int', unsigned: true, default: 1 })
  quantity!: number;

  @Column({ name: 'unit_price_cents', type: 'bigint', unsigned: true })
  unitPriceCents!: string;

  @Column({ name: 'product_name', type: 'varchar', length: 200 })
  productName!: string;

  @Column({ name: 'product_slug', type: 'varchar', length: 191 })
  productSlug!: string;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;
}

@Entity({ name: 'media_assets', engine: 'InnoDB' })
@Index('idx_media_assets_showcase_position', ['showcaseId', 'position'])
@Index('idx_media_assets_status_created', ['status', 'createdAt'])
@Index('uq_media_assets_original_key', ['originalKey'], { unique: true })
export class MediaAsset extends BaseEntity {
  // Ownership is inherited from the showcase, avoiding conflicting owner IDs.
  @Column({ name: 'showcase_id', type: 'varchar', length: 36 })
  showcaseId!: string;

  // Explicit cleanup must remove storage objects before metadata is deleted.
  @ManyToOne(() => Showcase, (showcase) => showcase.mediaAssets, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'showcase_id',
    foreignKeyConstraintName: 'fk_media_showcase',
  })
  showcase!: Relation<Showcase>;

  @Column({ type: 'enum', enum: MediaKind })
  kind!: MediaKind;

  @Column({ type: 'enum', enum: MediaStatus, default: MediaStatus.PENDING })
  status!: MediaStatus;

  @Column({
    name: 'original_key',
    type: 'varchar',
    length: 512,
    collation: 'utf8mb4_bin',
    nullable: true,
  })
  originalKey!: string | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType!: string;

  // MySQL BIGINT values stay strings to avoid JavaScript integer precision loss.
  @Column({ name: 'size_bytes', type: 'bigint', unsigned: true })
  sizeBytes!: string;

  @Column({ type: 'int', unsigned: true, nullable: true })
  width!: number | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  height!: number | null;

  @Column({ name: 'duration_ms', type: 'int', unsigned: true, nullable: true })
  durationMs!: number | null;

  @Column({ name: 'alt_text', type: 'varchar', length: 500, nullable: true })
  altText!: string | null;

  @Column({ type: 'int', unsigned: true, default: 0 })
  position!: number;

  @OneToMany(() => MediaVariant, (variant) => variant.asset)
  variants!: Relation<MediaVariant[]>;
}

@Entity({ name: 'media_variants', engine: 'InnoDB' })
@Index('uq_media_variants_asset_label', ['assetId', 'label'], { unique: true })
@Index('uq_media_variants_storage_key', ['storageKey'], { unique: true })
export class MediaVariant extends BaseEntity {
  @Column({ name: 'asset_id', type: 'varchar', length: 36 })
  assetId!: string;

  @ManyToOne(() => MediaAsset, (asset) => asset.variants, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'asset_id',
    foreignKeyConstraintName: 'fk_variants_asset',
  })
  asset!: Relation<MediaAsset>;

  // Examples: avif-480, webp-1080, mp4-720, poster-jpeg.
  @Column({ type: 'varchar', length: 64 })
  label!: string;

  @Column({
    name: 'storage_key',
    type: 'varchar',
    length: 512,
    collation: 'utf8mb4_bin',
  })
  storageKey!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'bigint', unsigned: true })
  sizeBytes!: string;

  @Column({ type: 'int', unsigned: true })
  width!: number;

  @Column({ type: 'int', unsigned: true })
  height!: number;

  @Column({ name: 'duration_ms', type: 'int', unsigned: true, nullable: true })
  durationMs!: number | null;
}

@Entity({ name: 'post_engagement', engine: 'InnoDB' })
export class PostEngagement extends BaseEntity {
  @Column({ name: 'post_id', type: 'varchar', length: 36 })
  postId!: string;

  @ManyToOne(() => Showcase, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'post_id',
    foreignKeyConstraintName: 'fk_engagement_post',
  })
  post!: Relation<Showcase>;

  @Column({ name: 'likes_count', type: 'int', unsigned: true, default: 0 })
  likesCount!: number;

  @Column({ name: 'views_count', type: 'int', unsigned: true, default: 0 })
  viewsCount!: number;
}

@Entity({ name: 'post_likes', engine: 'InnoDB' })
@Index('uq_post_likes_post_voter', ['postId', 'voterId'], { unique: true })
@Index('idx_post_likes_post', ['postId'])
export class PostLike extends BaseEntity {
  @Column({ name: 'post_id', type: 'varchar', length: 36 })
  postId!: string;

  @Column({ name: 'voter_id', type: 'varchar', length: 255 })
  voterId!: string;

  @Column({
    name: 'voter_type',
    type: 'enum',
    enum: ['user', 'visitor'],
  })
  voterType!: 'user' | 'visitor';

  @ManyToOne(() => Showcase, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'post_id',
    foreignKeyConstraintName: 'fk_postlike_post',
  })
  post!: Relation<Showcase>;
}

// ============================================
// Boost System Entities
// ============================================

export enum BoostTransactionType {
  PURCHASE = 'purchase',
  ADMIN_GRANT = 'admin_grant',
  ADMIN_DEDUCT = 'admin_deduct',
  CAMPAIGN_SPEND = 'campaign_spend',
  REFUND = 'refund',
  EXPIRED = 'expired',
}

export enum BoostTransactionReferenceType {
  CAMPAIGN = 'campaign',
  PAYMENT = 'payment',
  ADMIN = 'admin',
  SYSTEM = 'system',
}

export enum BoostCampaignStatus {
  DRAFT = 'draft',
  PENDING_REVIEW = 'pending_review',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

export enum BoostTargetType {
  SHOWCASE = 'showcase',
  STORE = 'store',
}

export enum BoostBidStrategy {
  CPC = 'cpc',
  CPM = 'cpm',
  AUTO = 'auto',
}

@Entity({ name: 'boost_coins', engine: 'InnoDB' })
export class BoostCoin extends BaseEntity {
  @Column({ name: 'user_id', type: 'varchar', length: 36, unique: true })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_boost_coins_user',
  })
  user!: Relation<User>;

  @Column({ name: 'balance', type: 'bigint', unsigned: true, default: '0' })
  balance!: string; // BIGINT as string
}

export interface BoostTransactionMetadata {
  paymentProvider?: string;
  paymentId?: string;
  paymentMethod?: string;
  adminNotes?: string;
  campaignName?: string;
  [key: string]: unknown;
}

@Entity({ name: 'boost_transactions', engine: 'InnoDB' })
@Index('idx_boost_transactions_user', ['userId'])
@Index('idx_boost_transactions_reference', ['referenceId', 'referenceType'])
@Index('idx_boost_transactions_created', ['createdAt'])
export class BoostTransaction extends BaseEntity {
  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_boost_transactions_user',
  })
  user!: Relation<User>;

  @Column({
    name: 'type',
    type: 'enum',
    enum: BoostTransactionType,
  })
  type!: BoostTransactionType;

  @Column({ name: 'amount', type: 'bigint' }) // signed BIGINT
  amount!: string; // Can be negative

  @Column({ name: 'balance_before', type: 'bigint', unsigned: true })
  balanceBefore!: string;

  @Column({ name: 'balance_after', type: 'bigint', unsigned: true })
  balanceAfter!: string;

  @Column({ name: 'reference_id', type: 'varchar', length: 36, nullable: true })
  referenceId!: string | null;

  @Column({
    name: 'reference_type',
    type: 'enum',
    enum: BoostTransactionReferenceType,
    nullable: true,
  })
  referenceType!: BoostTransactionReferenceType | null;

  @Column({ name: 'description', type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ name: 'metadata', type: 'json', nullable: true })
  metadata!: BoostTransactionMetadata | null;
}

export interface BoostTargeting {
  // Geographic targeting
  countries?: string[]; // Country codes
  cities?: string[];
  // Lebanon-specific: districts, areas
  districts?: string[];
  radiusKm?: number; // From lat/lng
  latitude?: number;
  longitude?: number;

  // Interest targeting
  interests?: string[]; // e.g., 'fashion', 'food', 'electronics'

  // Demographic targeting
  ageMin?: number;
  ageMax?: number;
  genders?: ('male' | 'female' | 'other')[];

  // Behavioral targeting
  // e.g., users who engaged with similar content
  lookalikeOfStoreId?: string;
  retargeting?: boolean; // Show to users who visited the store

  // Device/Platform targeting
  devices?: ('mobile' | 'desktop' | 'tablet')[];
  platforms?: ('web' | 'ios' | 'android')[];

  // Schedule targeting
  daysOfWeek?: number[]; // 0-6 (Sun-Sat)
  hoursOfDay?: number[]; // 0-23 UTC
}

export interface BoostCreative {
  headline?: string; // Override showcase/store title
  description?: string; // Override description
  callToAction?:
    'shop_now' | 'learn_more' | 'visit_store' | 'contact' | 'book_now';
  mediaKey?: string; // Override media (storage key)
  displayUrl?: string; // Custom display URL
}

@Entity({ name: 'boost_campaigns', engine: 'InnoDB' })
@Index('idx_boost_campaigns_user', ['userId'])
@Index('idx_boost_campaigns_target', ['targetType', 'targetId'])
@Index('idx_boost_campaigns_status', ['status'])
@Index('idx_boost_campaigns_schedule', ['startAt', 'endAt'])
export class BoostCampaign extends BaseEntity {
  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_boost_campaigns_user',
  })
  user!: Relation<User>;

  @Column({ name: 'name', type: 'varchar', length: 100 })
  name!: string;

  @Column({
    name: 'target_type',
    type: 'enum',
    enum: BoostTargetType,
  })
  targetType!: BoostTargetType;

  @Column({ name: 'target_id', type: 'varchar', length: 36 })
  targetId!: string; // Showcase ID or Store ID

  @Column({
    name: 'status',
    type: 'enum',
    enum: BoostCampaignStatus,
    default: BoostCampaignStatus.DRAFT,
  })
  status!: BoostCampaignStatus;

  @Column({ name: 'budget_coins', type: 'bigint', unsigned: true })
  budgetCoins!: string; // Total budget in coins

  @Column({ name: 'spent_coins', type: 'bigint', unsigned: true, default: '0' })
  spentCoins!: string;

  @Column({
    name: 'daily_budget_coins',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  dailyBudgetCoins!: string | null;

  @Column({
    name: 'bid_strategy',
    type: 'enum',
    enum: BoostBidStrategy,
    default: BoostBidStrategy.AUTO,
  })
  bidStrategy!: BoostBidStrategy;

  @Column({
    name: 'bid_amount_coins',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  bidAmountCoins!: string | null; // Manual bid for CPC/CPM

  @Column({ name: 'targeting', type: 'json' })
  targeting!: BoostTargeting;

  @Column({ name: 'creative', type: 'json', nullable: true })
  creative!: BoostCreative | null;

  @Column({ name: 'start_at', type: 'datetime', precision: 6, nullable: true })
  startAt!: Date | null;

  @Column({ name: 'end_at', type: 'datetime', precision: 6, nullable: true })
  endAt!: Date | null;

  @Column({ name: 'paused_at', type: 'datetime', precision: 6, nullable: true })
  pausedAt!: Date | null;

  @Column({
    name: 'rejected_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  rejectedAt!: Date | null;

  @Column({
    name: 'rejection_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  rejectionReason!: string | null;

  @Column({
    name: 'completed_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  completedAt!: Date | null;
}

export interface BoostCampaignPerformanceData {
  impressions: number;
  clicks: number;
  spendCoins: number;
}

@Entity({ name: 'boost_campaign_performance', engine: 'InnoDB' })
@Index('idx_boost_performance_date', ['date'])
export class BoostCampaignPerformance extends BaseEntity {
  @Column({ name: 'campaign_id', type: 'varchar', length: 36 })
  campaignId!: string;

  @ManyToOne(() => BoostCampaign, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'campaign_id',
    foreignKeyConstraintName: 'fk_boost_performance_campaign',
  })
  campaign!: Relation<BoostCampaign>;

  @Column({ type: 'date' })
  date!: Date; // UTC date

  @Column({ name: 'impressions', type: 'bigint', unsigned: true, default: '0' })
  impressions!: string;

  @Column({ name: 'clicks', type: 'bigint', unsigned: true, default: '0' })
  clicks!: string;

  @Column({ name: 'spend_coins', type: 'bigint', unsigned: true, default: '0' })
  spendCoins!: string;
}

@Entity({ name: 'boost_settings', engine: 'InnoDB' })
export class BoostSetting extends BaseEntity {
  @Column({ name: 'key', type: 'varchar', length: 100, unique: true })
  key!: string;

  @Column({ name: 'value', type: 'json' })
  value!: Record<string, unknown>;

  @Column({ name: 'description', type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ name: 'updated_by', type: 'varchar', length: 36, nullable: true })
  updatedBy!: string | null; // Admin user ID

  // Note: createdAt/updatedAt from BaseEntity
  // No user relation to avoid circular deps
}

export const databaseEntities = [
  User,
  Showcase,
  Store,
  Product,
  Cart,
  CartItem,
  MediaAsset,
  MediaVariant,
  PostEngagement,
  PostLike,
  SubscriptionPlan,
  UserSubscription,
  BoostCoin,
  BoostTransaction,
  BoostCampaign,
  BoostCampaignPerformance,
  BoostSetting,
];
