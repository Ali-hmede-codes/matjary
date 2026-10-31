import {
  Store,
  StoreStatus,
  Showcase,
  Product,
  UserSubscription,
  SubscriptionLimits,
  ProductOptionGroup,
  readProductOptions,
} from '@app/database';

export class UserStoreSummaryDto {
  status!: StoreStatus;
  trashedAt!: Date | null;
  id!: string;
  name!: string;
  slug!: string;
  brandColor!: string | null;
  description!: string | null;
  logoKey!: string | null;
  bannerKey!: string | null;
  storeType!: 'ecommerce' | 'restaurant_menu';
  subscriptionTier!: string;
  subscriptionExpiresAt!: Date | null;
  postsCount!: number;
  productsCount!: number;
  enableCart!: boolean;
  enableWhatsAppCheckout!: boolean;
  // Sections the owner turned off. The storefront hides them and the plan
  // allowance moves to the section that stays on.
  enablePostsSection!: boolean;
  enableProductsSection!: boolean;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(
    store: Store,
    postsCount: number,
    productsCount: number,
  ): UserStoreSummaryDto {
    const dto = new UserStoreSummaryDto();
    dto.id = store.id;
    dto.status = store.status;
    dto.trashedAt = store.trashedAt;
    dto.name = store.name;
    dto.slug = store.slug;
    dto.brandColor = store.brandColor;
    dto.description = store.description;
    dto.logoKey = store.logoKey;
    dto.bannerKey = store.bannerKey;
    dto.storeType = store.storeType;
    dto.subscriptionTier = store.subscriptionTier;
    dto.subscriptionExpiresAt = store.subscriptionExpiresAt;
    dto.postsCount = postsCount;
    dto.productsCount = productsCount;
    dto.enableCart = store.enableCart;
    dto.enableWhatsAppCheckout = store.enableWhatsAppCheckout;
    dto.enablePostsSection = store.enablePostsSection !== false;
    dto.enableProductsSection = store.enableProductsSection !== false;
    dto.createdAt = store.createdAt;
    dto.updatedAt = store.updatedAt;
    return dto;
  }
}

export class UserPostSummaryDto {
  id!: string;
  slug!: string;
  title!: string;
  description!: string | null;
  status!: 'draft' | 'published' | 'archived';
  publishedAt!: Date | null;
  storeId!: string | null;
  storeSlug!: string | null;
  storeName!: string | null;
  mediaCount!: number;
  likesCount!: number;
  viewsCount!: number;
  viewerLiked!: boolean;
  // First ready media thumbnail so the panel list can render posts without
  // fetching each showcase's media separately.
  thumbnailKey!: string | null;
  // Shoppable post targets; the editor prefills its link picker from these.
  linkedProductId!: string | null;
  linkedCategoryId!: string | null;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(
    post: Showcase,
    storeSlug: string | null,
    storeName: string | null,
    mediaCount: number,
    likesCount: number,
    viewsCount: number,
    viewerLiked: boolean,
    thumbnailKey: string | null = null,
  ): UserPostSummaryDto {
    const dto = new UserPostSummaryDto();
    dto.id = post.id;
    dto.slug = post.slug;
    dto.title = post.title;
    dto.description = post.description;
    dto.status = post.status;
    dto.publishedAt = post.publishedAt;
    dto.storeId = post.storeId;
    dto.storeSlug = storeSlug;
    dto.storeName = storeName;
    dto.mediaCount = mediaCount;
    dto.likesCount = likesCount;
    dto.viewsCount = viewsCount;
    dto.viewerLiked = viewerLiked;
    dto.thumbnailKey = thumbnailKey;
    dto.linkedProductId = post.linkedProductId ?? null;
    dto.linkedCategoryId = post.linkedCategoryId ?? null;
    dto.createdAt = post.createdAt;
    dto.updatedAt = post.updatedAt;
    return dto;
  }
}

export class UserProductSummaryDto {
  id!: string;
  slug!: string;
  name!: string;
  description!: string | null;
  priceCents!: string;
  compareAtPriceCents!: string | null;
  currency!: string;
  category!: string;
  categoryId!: string | null;
  categoryName!: string | null;
  status!: 'draft' | 'active' | 'archived' | 'out_of_stock';
  sku!: string | null;
  stockQuantity!: number | null;
  weightGrams!: number | null;
  imageKeys!: string[] | null;
  tags!: string[] | null;
  options!: ProductOptionGroup[] | null;
  storeId!: string;
  storeSlug!: string;
  sortOrder!: number;
  requiresShipping!: boolean;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(
    product: Product,
    storeSlug: string,
  ): UserProductSummaryDto {
    const dto = new UserProductSummaryDto();
    dto.id = product.id;
    dto.slug = product.slug;
    dto.name = product.name;
    dto.description = product.description;
    dto.priceCents = product.priceCents;
    dto.compareAtPriceCents = product.compareAtPriceCents ?? null;
    dto.currency = product.currency;
    dto.category = product.category;
    dto.categoryId = product.categoryId ?? null;
    dto.categoryName = product.categoryRef?.name ?? null;
    dto.status = product.status;
    dto.sku = product.sku ?? null;
    dto.stockQuantity = product.stockQuantity;
    dto.weightGrams = product.weightGrams ?? null;
    dto.imageKeys = product.imageKeys;
    dto.tags = product.tags ?? null;
    dto.options = readProductOptions(product.options);
    dto.storeId = product.storeId;
    dto.storeSlug = storeSlug;
    dto.sortOrder = product.sortOrder;
    dto.requiresShipping = product.requiresShipping !== false;
    dto.createdAt = product.createdAt;
    dto.updatedAt = product.updatedAt;
    return dto;
  }
}

export class UserSubscriptionInfoDto {
  planId!: string;
  planName!: string;
  planSlug!: string;
  status!: 'active' | 'expired' | 'cancelled' | 'pending';
  startsAt!: Date;
  expiresAt!: Date | null;
  limits!: SubscriptionLimits;
  legacyTier!: string | null;

  static fromSubscription(sub: UserSubscription): UserSubscriptionInfoDto {
    const dto = new UserSubscriptionInfoDto();
    dto.planId = sub.plan?.id ?? '';
    dto.planName = sub.plan?.name ?? '';
    dto.planSlug = sub.plan?.slug ?? '';
    dto.status = sub.status;
    dto.startsAt = sub.startsAt;
    dto.expiresAt = sub.expiresAt;
    dto.limits = sub.plan?.limits ?? {};
    dto.legacyTier = sub.plan?.legacyTier ?? null;
    return dto;
  }
}

export class SubscriptionStateDto {
  state!: 'trial' | 'paid' | 'expired';
  planName!: string | null;
  planSlug!: string | null;
  expiresAt!: Date | null;
  daysRemaining!: number | null;
  // active, the seven-day grace window, or locked (shops hidden until renewed).
  phase!: 'active' | 'grace' | 'locked';
  graceEndsAt!: Date | null;
  renewalRequestedAt!: Date | null;
}

// Effective content allowance per section after trading a turned-off section's
// unused quota. `used` matches the counts the API enforces on create.
export class ContentSectionSummaryDto {
  enabled!: boolean;
  used!: number;
  limit!: number | null;
}

export class ContentSectionsSummaryDto {
  posts!: ContentSectionSummaryDto;
  products!: ContentSectionSummaryDto;
}

export class DashboardSummaryDto {
  stores!: UserStoreSummaryDto[];
  posts!: UserPostSummaryDto[];
  products!: UserProductSummaryDto[];
  subscription!: UserSubscriptionInfoDto | null;
  subscriptionState!: SubscriptionStateDto;
  limits!: SubscriptionLimits;
  sections!: ContentSectionsSummaryDto;
  stats!: {
    totalStores: number;
    totalPosts: number;
    totalProducts: number;
    publishedPosts: number;
    activeProducts: number;
    totalMedia: number;
    totalCategories: number;
  };
}
