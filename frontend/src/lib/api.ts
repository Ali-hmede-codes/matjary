import { mediaUrl, parseLikeResponse } from './website';

export interface Store {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  brandColor: string | null;
  hasVerificationBadge?: boolean;
  storeType?: 'ecommerce' | 'restaurant_menu';
  logoKey?: string | null;
  bannerKey?: string | null;
  socialMediaLinks?: Record<string, string> | null;
  location?: {
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

export const loginUrl = `${__DEV_BACKEND_ORIGIN__ ?? ''}/api/v1/auth/login`;
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

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super('This content is temporarily unavailable.');
    this.name = 'ApiError';
    this.status = status;
  }
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
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}
