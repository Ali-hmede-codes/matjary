import { mediaUrl, parseLikeResponse, parseViewResponse } from './website';

export interface StoreBranch {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  postalCode?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  phone?: string | null;
  whatsapp?: string | null;
  whatsappUrl?: string | null;
  openingHours?: Record<string, string | null> | null;
  googleMapsUrl?: string | null;
  isPrimary?: boolean;
  hasCoordinates?: boolean;
  mapUrl?: string | null;
}

export interface Store {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  brandColor: string | null;
  hasVerificationBadge?: boolean;
  verificationBadgeExpiresAt?: string | null;
  storeType?: 'ecommerce' | 'restaurant_menu';
  businessCategory?: string | null;
  businessCategoryLabel?: string | null;
  logoKey?: string | null;
  bannerKey?: string | null;
  socialMediaLinks?: Record<string, string> | null;
  branches?: StoreBranch[] | null;
  location?: {
    latitude?: number | string | null;
    longitude?: number | string | null;
    locationName?: string | null;
    city: string | null;
    country: string | null;
    address?: string | null;
    phone?: string | null;
    website?: string | null;
    openingHours?: Record<string, string> | null;
    mapUrl?: string | null;
  } | null;
}

export interface ProductOptionGroup {
  name: string;
  values: string[];
}

export interface SelectedProductOption {
  name: string;
  value: string;
}

export interface Product {
  id: string;
  storeId: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: string;
  currency: string;
  category: string;
  categoryId?: string | null;
  categoryName?: string | null;
  stockQuantity: number | null;
  imageKeys: string[] | null;
  tags: string[] | null;
  options?: ProductOptionGroup[] | null;
}

export interface ProductList {
  items: Product[];
  total: number;
}

// Owner-defined shop category, returned in the shop's own sort order.
export interface StoreCategory {
  id: string;
  name: string;
  sortOrder: number;
  productCount?: number;
}

export interface StoreCategoryList {
  items: StoreCategory[];
  total: number;
  limit?: number | null;
  // Public: active products without an owner-defined category.
  uncategorized?: number;
}

export interface Media {
  id: string;
  kind: 'image' | 'video';
  primaryUrl: string;
  posterUrl: string | null;
  variants: {
    url: string;
    width: number;
    height: number;
    mimeType: string;
    label: string;
  }[];
}

export interface Post {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  publishedAt: string | null;
  store?: Store;
  media: Media[];
  engagement: { likes: number; views: number; viewerLiked: boolean };
}

export interface Feed {
  items: Post[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface ShopCategoryGroup {
  slug: string;
  label: string;
}

export interface ShopCategoryDefinition {
  slug: string;
  label: string;
  group: string;
}

// Full code-owned catalog used by the shop editor. Static and public.
export interface ShopCategoryCatalog {
  groups: ShopCategoryGroup[];
  categories: ShopCategoryDefinition[];
}

// Public feed facet: a business category that currently has published posts.
export interface ShopCategoryFacet extends ShopCategoryDefinition {
  groupLabel: string;
  count: number;
}

export type AdCallToAction =
  'shop_now' | 'learn_more' | 'visit_store' | 'contact' | 'book_now';

export interface BoostAd {
  id: string;
  type: 'ad';
  targetType: 'showcase' | 'store';
  targetId: string;
  targetName: string;
  targetSlug: string;
  targetStoreSlug?: string;
  targetImageKey?: string;
  creative?: {
    headline?: string;
    description?: string;
    callToAction?: AdCallToAction;
  };
  sponsoredBy: string;
  sponsoredById: string;
  cta?: string;
}

export interface TrendingBoostStore {
  campaignId: string;
  id: string;
  name: string;
  slug: string;
  logoKey?: string;
  brandColor?: string;
  city?: string;
  country?: string;
  headline?: string;
  sponsoredBy: string;
  cta?: string;
}

export interface BoostBalance {
  balance: string;
  balanceNumber: number;
  pendingSpend: string;
  availableBalance: string;
  availableBalanceNumber: number;
}

export interface BoostTransaction {
  id: string;
  type: string;
  amount: string;
  amountNumber: number;
  balanceBefore: string;
  balanceAfter: string;
  referenceId?: string;
  referenceType?: string;
  description?: string;
  createdAt: string;
}

export interface BoostCampaign {
  id: string;
  userId: string;
  name: string;
  targetType: 'showcase' | 'store';
  targetId: string;
  targetName?: string;
  targetSlug?: string;
  targetImageKey?: string;
  status:
    | 'draft'
    | 'pending_review'
    | 'active'
    | 'paused'
    | 'completed'
    | 'rejected'
    | 'cancelled';
  budgetCoins: string;
  spentCoins: string;
  remainingCoins: string;
  dailyBudgetCoins?: string;
  bidStrategy: 'cpc' | 'cpm' | 'auto';
  bidAmountCoins?: string;
  creative?: {
    headline?: string;
    description?: string;
    callToAction?: AdCallToAction;
  };
  startAt?: string;
  endAt?: string;
  rejectionReason?: string;
  createdAt: string;
}

export interface BoostCampaignStats {
  campaignId: string;
  totalImpressions: number;
  totalClicks: number;
  totalSpendCoins: number;
  avgCtr: number;
  avgCpcCoins: number;
}

export interface BoostPublicSettings {
  coinPriceCents: number;
  minPurchaseCoins: number;
  maxPurchaseCoins: number;
  minCampaignBudgetCoins: number;
  maxCampaignDurationDays: number;
  cpcMinBidCoins: number;
  cpmMinBidCoins: number;
}

export const loginUrl = '/login';
export const assetUrl = (value: string | null | undefined) =>
  mediaUrl(value, __DEV_BACKEND_ORIGIN__);

export async function togglePostLike(postId: string) {
  // This endpoint takes the post ID, even though its route parameter is named slug.
  // Do not retry a toggle automatically: the first request may have succeeded.
  const response = await fetch(
    `/api/v1/posts/${encodeURIComponent(postId)}/like`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) throw new Error('Could not update this like.');
  return parseLikeResponse(await response.json());
}

export async function registerPostView(postId: string) {
  // Best-effort telemetry: callers ignore failures so opening a post never
  // depends on the view counter being writable.
  const response = await fetch(
    `/api/v1/posts/${encodeURIComponent(postId)}/view`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) throw new Error('Could not record this view.');
  return parseViewResponse(await response.json());
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code?: string) {
    super('This content is temporarily unavailable.');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// Only uppercase business codes are read from the body. Messages and other
// response details stay hidden, matching the API's sanitized error contract.
export async function toApiError(response: Response): Promise<ApiError> {
  let code: string | undefined;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object') {
      const value = (body as { code?: unknown }).code;
      if (typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/u.test(value))
        code = value;
    }
  } catch {
    /* Non-JSON failures keep the generic message. */
  }
  return new ApiError(response.status, code);
}

export async function getJson<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
      : AbortSignal.timeout(12_000),
  });
  // Never display driver errors, response bodies, or credentials in the UI.
  if (!response.ok) throw await toApiError(response);
  return response.json() as Promise<T>;
}

export function getFeedAds(signal?: AbortSignal) {
  return getJson<BoostAd[]>('boost/feed/ads?limit=6', signal);
}

export function getTrendingBoostStores(signal?: AbortSignal) {
  return getJson<TrendingBoostStore[]>('boost/trending/stores?limit=6', signal);
}

// Ad telemetry is best effort: a tracking failure must never block the click
// or interrupt someone browsing the feed.
export async function trackAdEvent(
  campaignId: string,
  event: 'impression' | 'click',
): Promise<void> {
  try {
    await fetch(
      `/api/v1/boost/ads/${encodeURIComponent(campaignId)}/${event}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        // keepalive lets the click beacon finish after the ad navigates away.
        keepalive: true,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch {
    /* Delivery telemetry is optional. */
  }
}
