import {
  Store,
  StoreSubscriptionTier,
  StoreType,
  SocialMediaLinks,
} from '@app/database';

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
  id!: string;
  name!: string;
  slug!: string;
  brandColor!: string | null;
  description!: string | null;
  storeType!: StoreType;
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
  const hasCoordinates = store.latitude !== null && store.longitude !== null;
  const mapUrl = hasCoordinates
    ? `https://www.openstreetmap.org/?mlat=${store.latitude}&mlon=${store.longitude}#map=16/${store.latitude}/${store.longitude}`
    : null;

  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    brandColor: store.brandColor,
    description: store.description,
    storeType: store.storeType,
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
    hasVerificationBadge: store.hasVerificationBadge && (!store.verificationBadgeExpiresAt || store.verificationBadgeExpiresAt > new Date()),
    verificationBadgeGrantedAt: store.verificationBadgeGrantedAt,
    verificationBadgeExpiresAt: store.verificationBadgeExpiresAt,
    location:
      store.latitude || store.longitude
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
    postsCount,
    productsCount,
  };
}
