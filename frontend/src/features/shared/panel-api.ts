import { ApiError, getJson } from '../../lib/api';

export { getJson };
export interface Session {
  user: { id: string; email: string; displayName: string };
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
  maxProducts?: number | null;
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
  slug?: string;
  description?: string | null;
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
  if (!response.ok) throw new ApiError(response.status);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function panelError(error: unknown): string {
  if (error instanceof ApiError) {
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
