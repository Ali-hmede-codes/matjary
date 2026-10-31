import { ApiError, getJson, toApiError } from '../../lib/api';

export { getJson };
export interface Session {
  user: {
    id: string;
    email: string;
    displayName: string;
    // Store-scoped administrators only reach the shops assigned to them.
    adminScope?: 'all' | 'stores';
  };
  isAdmin: boolean;
}
export interface Page<T> {
  items: T[];
  total: number;
  limit?: number;
  offset?: number;
}
export interface Person {
  id: string;
  displayName: string;
  email: string;
  phone?: string | null;
}
// A candidate for receiving a shop. The admin owner picker shows the live plan
// and the shop slots it still has left, so the choice follows the subscription.
export interface StoreOwnerOption extends Person {
  planName: string | null;
  planSlug: string | null;
  planState: 'trial' | 'paid' | 'expired';
  expiresAt: string | null;
  shopsUsed: number;
  maxShops: number | null;
  remainingShops: number | null;
  administrator: boolean;
  eligible: boolean;
}
// Mirrors SubscriptionLimits in @app/database; null means unlimited.
export interface PlanLimits {
  maxVideoDurationSeconds?: number | null;
  maxVideoSizeBytes?: number | null;
  maxVideoQuality?: string | null;
  maxImageCount?: number | null;
  maxImageSizeBytes?: number | null;
  maxImageWidth?: number | null;
  maxImageHeight?: number | null;
  maxPostsPerMonth?: number | null;
  maxTotalPosts?: number | null;
  maxShops?: number | null;
  maxProducts?: number | null;
  maxStories?: number | null;
  maxCategories?: number | null;
  maxStorageBytes?: number | null;
  enableCart?: boolean;
  enableWhatsAppCheckout?: boolean;
  enableAnalytics?: boolean;
  enableCustomDomain?: boolean;
  enablePrioritySupport?: boolean;
  maxVerificationBadges?: number | null;
  verificationBadgePriceCents?: number | null;
}
export interface PanelRecord {
  id: string;
  name?: string;
  title?: string;
  displayName?: string;
  email?: string;
  // Contact number recorded when a plan is assigned by an administrator.
  phone?: string | null;
  slug?: string;
  description?: string | null;
  brandColor?: string | null;
  status?: string;
  storeId?: string;
  owner?: Person;
  store?: { id: string; name: string; slug: string };
  plan?: { id: string; name: string };
  userId?: string;
  planId?: string;
  ownerId?: string;
  hasVerificationBadge?: boolean;
  verificationBadgeExpiresAt?: string | null;
  adminArchivedAt?: string | null;
  suspendedAt?: string | null;
  // Plan lifecycle of a shop: when the grace window ended, where its media
  // lives, and whether the owner asked to renew a badge or a plan.
  subscriptionLockedAt?: string | null;
  mediaArchiveState?: string | null;
  mediaArchivedAt?: string | null;
  renewalRequestedAt?: string | null;
  logoKey?: string | null;
  bannerKey?: string | null;
  imageKeys?: string[] | null;
  priceCents?: string;
  currency?: string;
  expiresAt?: string | null;
  startsAt?: string;
  createdAt?: string;
  billingCycle?: string;
  isActive?: boolean;
  sortOrder?: number;
  limits?: PlanLimits;
  role?: 'admin' | 'user';
  roleManagedByEnvironment?: boolean;
  adminScope?: 'all' | 'stores';
  adminStoreIds?: string[];
  adminStores?: { id: string; name: string; slug: string }[];
  storeType?: string;
  businessCategory?: string;
  media?: { id: string; kind: string; status: string; key: string | null }[];
}

export async function mutate<T = void>(
  path: string,
  body: unknown = {},
  method = 'POST',
): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function panelError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'TRIAL_EXPIRED')
      return 'This billing period has ended, so the dashboard is read-only. Renew to keep editing; your shop stays online during the 7-day grace window.';
    if (error.code === 'SHOP_RENEWAL_REQUIRED')
      return 'This shop is locked because its plan ended. Renew to open your shop again.';
    if (error.code === 'FREE_TRIAL_CAP')
      return 'Free-plan assignments are limited to the trial length. Assign a paid plan for longer access.';
    if (error.code === 'FREE_PLAN_NO_RENEWAL')
      return 'The free trial cannot be renewed. Choose a paid plan instead.';
    if (error.code === 'PRODUCT_SLUG_TAKEN')
      return 'That web address is already used by another product. Choose a different one.';
    if (error.code === 'STORE_SLUG_TAKEN')
      return 'That web address is already used by another shop. Choose a different one.';
    if (error.code === 'PRODUCT_OPTIONS_INVALID')
      return 'Check the options: every option needs a name and at least one value, and names must be unique.';
    if (error.code === 'PRODUCT_SALE_PRICE_INVALID')
      return 'The old price must be higher than the price shoppers pay.';
    if (error.code === 'SECTION_DISABLED')
      return 'This section is turned off for the shop. Turn it back on in the shop settings first.';
    if (error.code === 'SECTION_NO_ROOM')
      return 'Not enough plan allowance to turn this section back on. Delete some items first, then try again.';
    if (error.code === 'SECTION_LAST_ENABLED')
      return 'Keep at least one section on for this shop.';
    if (error.code === 'STORY_LIMIT')
      return 'Every live story slot for this shop is in use. Delete a story or wait for one to end.';
    if (error.code === 'STORY_STORE_OFFLINE')
      return 'Bring the shop online before sharing a story.';
    if (error.code === 'TEAM_LIMIT')
      return 'This shop already has the maximum number of team members. Remove someone before adding another.';
    if (error.code === 'TEAM_ALREADY_MEMBER')
      return 'This person already has access to this shop.';
    if (error.code === 'TEAM_OWN_EMAIL')
      return 'That is your own account. Team access is for other people.';
    if (error.code === 'TEAM_ACCOUNT_UNAVAILABLE')
      return 'This account cannot be added right now.';
    if (error.code === 'VERIFICATION_PHONE_INVALID')
      return 'Enter a valid Lebanese phone number, for example 03 123 456.';
    if (error.code === 'SUBSCRIPTION_PHONE_INVALID')
      return 'Enter a phone number with its country code, or choose the right country first.';
    if (error.code === 'OWNER_PLAN_INACTIVE')
      return 'The chosen account has no active plan. Assign a subscription before giving it a shop.';
    if (error.code === 'OWNER_PLAN_FULL')
      return 'The chosen account has no free shop slot in its plan. Assign a bigger plan or move one of its shops first.';
    if (error.code === 'VERIFICATION_NOT_AVAILABLE')
      return 'Verification is not available on your current plan. Choose another plan or contact an administrator.';
    if (error.code === 'VERIFICATION_NOT_GRANTED')
      return 'This shop has no verification badge to extend.';
    if (error.status === 401)
      return 'Your session has ended. Please sign in again.';
    if (error.status === 403) return 'Your account cannot perform this action.';
    if (error.status === 404) return 'This item is no longer available.';
    if (error.status === 409)
      return 'This action is unavailable. Check your plan limits, image status, or refresh this item.';
    if (error.status === 400 || error.status === 413)
      return 'Check the highlighted details and file limits, then try again.';
    if (error.status === 429)
      return 'Please wait a moment before trying again.';
  }
  return 'Could not finish this request. Check your connection and try again.';
}

export const recordName = (item: PanelRecord) =>
  item.name ||
  item.title ||
  item.displayName ||
  item.email ||
  item.plan?.name ||
  'Item';
export const dateLabel = (date?: string | null) =>
  date && Number.isFinite(Date.parse(date))
    ? new Date(date).toLocaleDateString('en-US', { dateStyle: 'medium' })
    : 'No expiry';
export { priceInput, decimalPrice } from '../../lib/storefront';
