import {
  Store,
  StoreBranch,
  StoreStatus,
  StoreSubscriptionTier,
  StoreType,
  SocialMediaLinks,
  businessCategoryDefinition,
  businessCategoryLabel,
} from '@app/database';

function coordinateValue(value: number | string | null | undefined) {
  // MySQL DECIMAL columns can surface as strings; empty values are not zero.
  if (typeof value === 'string' && /^[+-]?\d+(?:\.\d+)?$/u.test(value.trim()))
    value = Number(value);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mapUrlFor(latitude: number | null, longitude: number | null) {
  return latitude !== null && longitude !== null
    ? `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`
    : null;
}

function whatsAppUrlFor(value: string | null | undefined) {
  const digits = value?.replace(/\D/gu, '') ?? '';
  return /^\d{7,15}$/u.test(digits) ? `https://wa.me/${digits}` : null;
}

export class StoreBranchResponseDto {
  id!: string;
  name!: string;
  address!: string | null;
  city!: string | null;
  country!: string | null;
  postalCode!: string | null;
  latitude!: number | null;
  longitude!: number | null;
  phone!: string | null;
  whatsapp!: string | null;
  whatsappUrl!: string | null;
  openingHours!: Record<string, string> | null;
  googleMapsUrl!: string | null;
  isPrimary!: boolean;
  hasCoordinates!: boolean;
  mapUrl!: string | null;
}

export function toStoreBranchResponseDto(
  branch: StoreBranch,
): StoreBranchResponseDto {
  const latitude = coordinateValue(branch.latitude);
  const longitude = coordinateValue(branch.longitude);
  return {
    id: branch.id,
    name: branch.name,
    address: branch.address,
    city: branch.city,
    country: branch.country,
    postalCode: branch.postalCode,
    latitude,
    longitude,
    phone: branch.phone,
    whatsapp: branch.whatsapp,
    whatsappUrl: whatsAppUrlFor(branch.whatsapp),
    openingHours: branch.openingHours,
    googleMapsUrl: branch.googleMapsUrl ?? null,
    isPrimary: branch.isPrimary,
    hasCoordinates: latitude !== null && longitude !== null,
    mapUrl: mapUrlFor(latitude, longitude),
  };
}

export function sortedBranches(store: Store): StoreBranch[] {
  return [...(store.branches ?? [])].sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      a.sortOrder - b.sortOrder ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

export class StoreLocationResponseDto {
  latitude!: number | null;
  longitude!: number | null;
  address!: string | null;
  city!: string | null;
  country!: string | null;
  postalCode!: string | null;
  locationName!: string | null;
  phone!: string | null;
  website!: string | null;
  openingHours!: Record<string, string> | null;

  // Computed fields for map display
  hasCoordinates!: boolean;
  mapUrl!: string | null; // OpenStreetMap URL for the location
}

export class StoreResponseDto {
  status!: StoreStatus;
  trashedAt!: Date | null;
  restricted?: boolean;
  id!: string;
  name!: string;
  slug!: string;
  brandColor!: string | null;
  description!: string | null;
  storeType!: StoreType;
  // Public business taxonomy shared by shop creation, storefronts and feed filters.
  businessCategory!: string;
  businessCategoryLabel!: string;
  enableCart!: boolean;
  enableWhatsAppCheckout!: boolean;
  socialMediaLinks!: SocialMediaLinks | null;
  logoKey!: string | null;
  bannerKey!: string | null;
  subscriptionTier!: StoreSubscriptionTier;
  subscriptionExpiresAt!: Date | null;
  postsCountThisMonth!: number;
  ownerId!: string;
  createdAt!: Date;
  updatedAt!: Date;

  // Verification Badge fields
  hasVerificationBadge!: boolean;
  verificationBadgeGrantedAt!: Date | null;
  verificationBadgeExpiresAt!: Date | null;

  // Location fields
  location!: StoreLocationResponseDto | null;

  // Public branch list in display order. Omitted when the caller supplied an
  // entity that was not loaded with the relation (e.g. lifecycle updates), so
  // cached branch details are never silently erased.
  branches?: StoreBranchResponseDto[];

  // Optional: include posts/products count
  postsCount?: number;
  productsCount?: number;
}

export class StoreListResponseDto {
  items!: StoreResponseDto[];
  total!: number;
}

export function toStoreResponseDto(
  store: Store,
  includeOwnerId = false,
  postsCount?: number,
  productsCount?: number,
): StoreResponseDto {
  const hasCoordinates = store.latitude != null && store.longitude != null;
  const hasLocation =
    hasCoordinates ||
    [
      store.address,
      store.city,
      store.country,
      store.postalCode,
      store.locationName,
      store.phone,
      store.website,
    ].some(Boolean) ||
    Object.keys(store.openingHours ?? {}).length > 0;
  const mapUrl = hasCoordinates
    ? `https://www.openstreetmap.org/?mlat=${store.latitude}&mlon=${store.longitude}#map=16/${store.latitude}/${store.longitude}`
    : null;

  return {
    id: store.id,
    status: store.status,
    trashedAt: store.trashedAt,
    ...(includeOwnerId ? { restricted: Boolean(store.adminArchivedAt) } : {}),
    name: store.name,
    slug: store.slug,
    brandColor: store.brandColor,
    description: store.description,
    storeType: store.storeType,
    businessCategory: businessCategoryDefinition(store.businessCategory).slug,
    businessCategoryLabel: businessCategoryLabel(store.businessCategory),
    enableCart: store.enableCart,
    enableWhatsAppCheckout: store.enableWhatsAppCheckout,
    socialMediaLinks: store.socialMediaLinks,
    logoKey: store.logoKey,
    bannerKey: store.bannerKey,
    subscriptionTier: store.subscriptionTier,
    subscriptionExpiresAt: store.subscriptionExpiresAt,
    postsCountThisMonth: store.postsCountThisMonth,
    ownerId: store.ownerId,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
    // Verification Badge fields
    hasVerificationBadge:
      store.hasVerificationBadge &&
      (!store.verificationBadgeExpiresAt ||
        store.verificationBadgeExpiresAt > new Date()),
    verificationBadgeGrantedAt: store.verificationBadgeGrantedAt,
    verificationBadgeExpiresAt: store.verificationBadgeExpiresAt,
    location: hasLocation
      ? {
          latitude: store.latitude,
          longitude: store.longitude,
          address: store.address,
          city: store.city,
          country: store.country,
          postalCode: store.postalCode,
          locationName: store.locationName,
          phone: store.phone,
          website: store.website,
          openingHours: store.openingHours,
          hasCoordinates,
          mapUrl,
        }
      : null,
    ...(Array.isArray(store.branches)
      ? { branches: sortedBranches(store).map(toStoreBranchResponseDto) }
      : {}),
    postsCount,
    productsCount,
  };
}
