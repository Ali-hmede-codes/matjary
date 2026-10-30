import type { Product, SelectedProductOption } from './api';
import { productIsOutOfStock } from './storefront.ts';

export interface CartItem {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  quantity: number;
  unitPriceCents: string;
  lineTotalCents: string;
  notes: string | null;
  selectedOptions?: SelectedProductOption[] | null;
}

export interface ShopCart {
  id: string;
  storeId: string;
  storeSlug: string;
  storeName: string;
  storeWhatsApp?: string | null;
  currency: string;
  items: CartItem[];
  subtotalCents: string;
  itemCount: number;
}

export interface CheckoutDetails {
  customerName: string;
  customerPhone: string;
  customerNotes: string;
  branchId?: string;
}

export interface CartCheckout {
  whatsappUrl: string;
  message: string;
  totalCents: string;
  currency: string;
  // Exact LBP total when the shop displays pounds; null keeps the order in USD.
  lbpTotal?: string | null;
  branchId?: string | null;
  branchName?: string | null;
}

export const MAX_CART_QUANTITY = 99;

export function productCartLimit(product?: Product) {
  // An item published as out of stock is visible but no longer orderable, the
  // same as one whose tracked stock reached zero.
  if (product && productIsOutOfStock(product)) return 0;
  return Math.max(
    0,
    Math.min(MAX_CART_QUANTITY, product?.stockQuantity ?? MAX_CART_QUANTITY),
  );
}

export class CartRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super('The cart request could not be completed.');
    this.name = 'CartRequestError';
    this.status = status;
  }
}

export function cartErrorMessage(
  error: unknown,
  action: 'load' | 'update' | 'checkout',
) {
  if (error instanceof CartRequestError) {
    if (error.status === 400 && action === 'load')
      return 'This shop is not accepting cart orders right now. Please contact the shop directly.';
    if (error.status === 400 && action === 'checkout')
      return 'Checkout is unavailable. An item may no longer be available, or this shop may not have WhatsApp checkout enabled. Please contact the shop.';
    if (error.status === 409)
      return 'The requested quantity is no longer available. Review your cart and try a smaller quantity.';
    if (error.status === 404)
      return 'This shop or item is no longer available. Refresh the shop before trying again.';
    if (error.status === 401 || error.status === 403)
      return 'Your cart session could not be verified. Refresh the page and try again.';
    if (error.status === 429)
      return 'Too many cart requests. Please wait a moment before trying again.';
  }
  // Response bodies and raw errors may contain private backend details.
  return action === 'load'
    ? 'Your cart couldn’t load. Please try again.'
    : 'We couldn’t confirm the change. Check your cart before trying again.';
}

async function requestCart<T>(
  slug: string,
  suffix = '',
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `/api/v1/stores/${encodeURIComponent(slug)}/cart${suffix}`,
    {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
        : AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) throw new CartRequestError(response.status);
  // Delete endpoints deliberately return no JSON.
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const cartApi = {
  get: (slug: string, signal?: AbortSignal) =>
    requestCart<ShopCart>(slug, '', 'GET', undefined, signal),
  add: (
    slug: string,
    productId: string,
    selectedOptions?: readonly SelectedProductOption[] | null,
  ) =>
    requestCart<ShopCart>(slug, '/items', 'POST', {
      productId,
      quantity: 1,
      ...(selectedOptions?.length
        ? {
            selectedOptions: selectedOptions.map(({ name, value }) => ({
              name,
              value,
            })),
          }
        : {}),
    }),
  update: (slug: string, itemId: string, quantity: number) =>
    requestCart<ShopCart>(
      slug,
      `/items/${encodeURIComponent(itemId)}`,
      'PATCH',
      { quantity },
    ),
  remove: (slug: string, itemId: string) =>
    requestCart<void>(slug, `/items/${encodeURIComponent(itemId)}`, 'DELETE'),
  clear: (slug: string) => requestCart<void>(slug, '', 'DELETE'),
  checkout: (slug: string, details: CheckoutDetails) =>
    requestCart<CartCheckout>(slug, '/checkout', 'POST', details),
};

export function checkoutUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.origin !== 'https://wa.me' ||
      url.username ||
      url.password ||
      !/^\/\+?\d{7,15}$/u.test(url.pathname) ||
      !url.searchParams.get('text')
    )
      return undefined;
    // Only WhatsApp order links are allowed, never arbitrary API redirects.
    return `https://wa.me/${url.pathname.slice(1).replace(/^\+/u, '')}?${new URLSearchParams({ text: url.searchParams.get('text')! })}`;
  } catch {
    return undefined;
  }
}
