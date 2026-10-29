import {
  Store,
  StoreType,
  businessCategoryDefinition,
  businessCategoryGroupLabel,
  verificationBadgeInfo,
} from '@app/database';

// The directory paints one compact card per shop. It deliberately leaves out
// the storefront design system, branches and social links: loading those for
// every shop would make the all-shops page heavy for no visual gain.
export class StoreDirectoryItemDto {
  id!: string;
  name!: string;
  slug!: string;
  logoKey!: string | null;
  brandColor!: string | null;
  storeType!: StoreType;
  businessCategory!: string;
  businessCategoryLabel!: string;
  categoryGroup!: string;
  categoryGroupLabel!: string;
  city!: string | null;
  country!: string | null;
  hasVerificationBadge!: boolean;
  verificationBadgeExpiresAt!: Date | null;
  postsCount!: number;
  productsCount!: number;
}

export class StoreDirectoryResponseDto {
  items!: StoreDirectoryItemDto[];
  total!: number;
}

// Only the columns the directory actually renders are selected, so the query
// stays cheap even when the platform hosts many shops.
export type StoreDirectorySource = Pick<
  Store,
  | 'id'
  | 'name'
  | 'slug'
  | 'logoKey'
  | 'brandColor'
  | 'storeType'
  | 'businessCategory'
  | 'city'
  | 'country'
  | 'hasVerificationBadge'
  | 'verificationBadgeExpiresAt'
>;

export function toStoreDirectoryItemDto(
  store: StoreDirectorySource,
  postsCount = 0,
  productsCount = 0,
): StoreDirectoryItemDto {
  const category = businessCategoryDefinition(store.businessCategory);
  // An expired badge must never keep looking like an active one; the grace
  // window is part of the visible period until the tick disappears.
  const badgeActive = verificationBadgeInfo(store).visible;
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    logoKey: store.logoKey,
    brandColor: store.brandColor,
    storeType: store.storeType,
    businessCategory: category.slug,
    businessCategoryLabel: category.label,
    categoryGroup: category.group,
    categoryGroupLabel: businessCategoryGroupLabel(store.businessCategory),
    city: store.city,
    country: store.country,
    hasVerificationBadge: badgeActive,
    verificationBadgeExpiresAt: store.verificationBadgeExpiresAt,
    postsCount,
    productsCount,
  };
}
