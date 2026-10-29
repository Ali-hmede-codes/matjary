import { mediaUrl, parseLikeResponse, parseViewResponse } from './website';
import type { DesignSettingsInput } from './design';

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
  // True when the signed-in viewer can manage this shop (owner or team);
  // backs the story and quick-add controls on the storefront.
  viewerIsOwner?: boolean;
  // Set in the owner panel: "member" shops are helped with, not owned.
  teamRole?: 'owner' | 'member';
  hasVerificationBadge?: boolean;
  verificationBadgeExpiresAt?: string | null;
  storeType?: 'ecommerce' | 'restaurant_menu';
  businessCategory?: string | null;
  businessCategoryLabel?: string | null;
  // The owner's saved visual system; the storefront renders this exact look.
  designSettings?: DesignSettingsInput | null;
  // Owner opt-in: prices also appear in LBP at the platform rate.
  showPricesInLbp?: boolean;
  // Section switches; a turned-off section is hidden on the shop page.
  enablePostsSection?: boolean;
  enableProductsSection?: boolean;
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

// Compact shop record for the public directory. It omits the storefront design
// payload on purpose, so listing every shop stays one small request.
export interface StoreDirectoryItem {
  id: string;
  name: string;
  slug: string;
  logoKey: string | null;
  brandColor: string | null;
  storeType: 'ecommerce' | 'restaurant_menu';
  businessCategory: string;
  businessCategoryLabel: string;
  categoryGroup: string;
  categoryGroupLabel: string;
  city: string | null;
  country: string | null;
  hasVerificationBadge: boolean;
  verificationBadgeExpiresAt: string | null;
  postsCount: number;
  productsCount: number;
}

export interface StoreDirectory {
  items: StoreDirectoryItem[];
  total: number;
}

export interface ProductOptionValue {
  label: string;
  // This value's own price in cents, or null when it uses the base price.
  priceCents: string | null;
}

export interface ProductOptionGroup {
  name: string;
  values: ProductOptionValue[];
}

export interface SelectedProductOption {
  name: string;
  value: string;
  priceCents: string | null;
}

/** Out of stock stays published: it is shown, but it cannot be bought. */
export type ProductStatus = 'draft' | 'active' | 'archived' | 'out_of_stock';

export interface Product {
  id: string;
  storeId: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: string;
  // Old price while the item is on sale; null when there is no sale.
  compareAtPriceCents?: string | null;
  currency: string;
  status?: ProductStatus;
  category: string;
  categoryId?: string | null;
  categoryName?: string | null;
  sku?: string | null;
  stockQuantity: number | null;
  weightGrams?: number | null;
  imageKeys: string[] | null;
  tags: string[] | null;
  options?: ProductOptionGroup[] | null;
  sortOrder?: number;
  requiresShipping?: boolean;
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
  // Intrinsic size of the processed asset; used to reserve space while the
  // bytes are still in flight.
  width?: number;
  height?: number;
  variants: {
    url: string;
    width: number;
    height: number;
    mimeType: string;
    label: string;
  }[];
}

// A shoppable post points at one own product or one of its categories. The API
// resolves the display fields and drops links that are no longer public.
export interface PostLink {
  type: 'product' | 'category';
  name: string;
  slug: string | null;
  priceCents: string | null;
  currency: string | null;
  // Old price while the linked item is on sale.
  compareAtPriceCents?: string | null;
}

export interface Post {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  publishedAt: string | null;
  store?: Store;
  media: Media[];
  link?: PostLink;
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
  targetHasVerificationBadge?: boolean;
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

export interface StoryMedia {
  id: string;
  kind: 'image' | 'video';
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  primaryUrl: string;
  posterUrl: string | null;
}

// A story points at one product or one section, never both.
export interface StoryLink {
  type: 'product' | 'category';
  name: string;
  slug: string | null;
  priceCents: string | null;
  currency: string | null;
  // Old price while the linked item is on sale.
  compareAtPriceCents?: string | null;
}

export interface Story {
  id: string;
  createdAt: string;
  expiresAt: string;
  media: StoryMedia;
  link?: StoryLink;
}

// The shop fields a story needs, shaped like a Store so every avatar/badge
// helper accepts it unchanged.
export interface StoryStore {
  id: string;
  name: string;
  slug: string;
  logoKey: string | null;
  brandColor: string | null;
  hasVerificationBadge: boolean;
  verificationBadgeExpiresAt: string | null;
  businessCategoryLabel: string;
}

export interface StoryGroup {
  store: StoryStore;
  stories: Story[];
}

export interface StoryList {
  groups: StoryGroup[];
  total: number;
}

export interface MyStories {
  storeId: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  stories: Story[];
}

/** Live stories grouped per shop; `shops` narrows to known favorites or one shop. */
export function getStories(shops?: string, signal?: AbortSignal) {
  const query = shops ? `?shops=${encodeURIComponent(shops)}` : '';
  return getJson<StoryList>(`stories${query}`, signal);
}

/** Owner view: live stories plus this shop's remaining slots. */
export function getMyStories(storeSlug: string, signal?: AbortSignal) {
  return getJson<MyStories>(
    `stories/mine?storeSlug=${encodeURIComponent(storeSlug)}`,
    signal,
  );
}

async function sendJson<T>(
  path: string,
  method: 'POST' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function createStory(body: {
  storeSlug: string;
  mediaId: string;
  linkedProductId?: string;
  linkedCategoryId?: string;
}) {
  return sendJson<Story>('stories', 'POST', body);
}

export function deleteStory(id: string) {
  return sendJson<void>(`stories/${encodeURIComponent(id)}`, 'DELETE');
}

/** One published post, addressed by the slug its shared link carries. */
export function getPost(slug: string, signal?: AbortSignal) {
  return getJson<Post>(`feed/post/${encodeURIComponent(slug)}`, signal);
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
