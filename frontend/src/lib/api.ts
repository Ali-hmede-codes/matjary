import { mediaUrl, parseLikeResponse, parseViewResponse } from './website';

export interface Store {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  brandColor: string | null;
  hasVerificationBadge?: boolean;
  verificationBadgeExpiresAt?: string | null;
  storeType?: 'ecommerce' | 'restaurant_menu';
  logoKey?: string | null;
  bannerKey?: string | null;
  socialMediaLinks?: Record<string, string> | null;
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
}

export interface ProductList {
  items: Product[];
  total: number;
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

export interface Category {
  category: string;
  label: string;
  count: number;
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
