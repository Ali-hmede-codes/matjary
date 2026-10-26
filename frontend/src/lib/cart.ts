import type { Product, SelectedProductOption, Store } from './api';
import {
  productHasOptions,
  productOptionSelection,
  selectedOptionsKey,
} from './storefront.ts';

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
  branchId?: string | null;
  branchName?: string | null;
}

export const MAX_CART_QUANTITY = 99;

export function productCartLimit(product?: Product) {
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

export function emptyCart(store: Store): ShopCart {
  return {
    id: `demo-cart-${store.id}`,
    storeId: store.id,
    storeSlug: store.slug,
    storeName: store.name,
    currency: 'USD',
    storeWhatsApp: null,
    items: [],
    subtotalCents: '0',
    itemCount: 0,
  };
}

export function updateDemoCart(
  cart: ShopCart,
  product: Product,
  quantity: number,
  selectedOptions?: readonly SelectedProductOption[] | null,
): ShopCart {
  const selection = productHasOptions(product)
    ? productOptionSelection(
        product,
        Object.fromEntries(
          (selectedOptions ?? []).map((option) => [option.name, option.value]),
        ),
      )
    : null;
  if (productHasOptions(product) && !selection) throw new CartRequestError(400);
  const optionKey = selectedOptionsKey(selection);
  const lineId = selection?.length ? `${product.id}::${optionKey}` : product.id;
  const limit = productCartLimit(product);
  const otherQuantity = cart.items
    .filter((entry) => entry.id !== lineId && entry.productId === product.id)
    .reduce((sum, entry) => sum + entry.quantity, 0);
  const previous = cart.items.find((entry) => entry.id === lineId);
  if (
    product.storeId !== cart.storeId ||
    !Number.isInteger(quantity) ||
    quantity < 0 ||
    quantity + otherQuantity > limit
  )
    throw new CartRequestError(409);
  if (product.currency !== cart.currency || !/^\d+$/u.test(product.priceCents))
    throw new CartRequestError(400);
  // Option prices are additions to the base price, matching the API.
  const optionPriceCents =
    selection?.reduce((sum, option) => {
      return (
        sum +
        (option.priceCents && /^\d+$/u.test(option.priceCents)
          ? BigInt(option.priceCents)
          : 0n)
      );
    }, 0n) ?? 0n;
  const unitPriceCents = (
    BigInt(product.priceCents) + optionPriceCents
  ).toString();
  const item: CartItem = {
    id: lineId,
    productId: product.id,
    productSlug: product.slug,
    productName: product.name,
    quantity,
    unitPriceCents,
    lineTotalCents: (BigInt(unitPriceCents) * BigInt(quantity)).toString(),
    notes: null,
    selectedOptions: selection,
  };
  const items =
    quantity === 0
      ? cart.items.filter((entry) => entry.id !== lineId)
      : previous
        ? cart.items.map((entry) => (entry.id === lineId ? item : entry))
        : [...cart.items, item];
  return {
    ...cart,
    items,
    itemCount: items.reduce((sum, entry) => sum + entry.quantity, 0),
    subtotalCents: items
      .reduce((sum, entry) => sum + BigInt(entry.lineTotalCents), 0n)
      .toString(),
  };
}

export const demoCartKey = (slug: string) =>
  `matjary:demo-cart:${encodeURIComponent(slug)}`;
export const serializeDemoCart = (cart: ShopCart) =>
  JSON.stringify(
    cart.items.map(({ productId, quantity, selectedOptions }) =>
      selectedOptions?.length
        ? {
            productId,
            quantity,
            // Prices are recomputed from the current product when restored.
            selectedOptions: selectedOptions.map(({ name, value }) => ({
              name,
              value,
            })),
          }
        : { productId, quantity },
    ),
  );

function storedOptions(value: unknown): SelectedProductOption[] | null {
  if (!Array.isArray(value)) return null;
  const options: SelectedProductOption[] = [];
  for (const entry of value.slice(0, 10)) {
    if (!entry || typeof entry !== 'object') continue;
    const { name, value: optionValue } = entry as {
      name?: unknown;
      value?: unknown;
    };
    if (typeof name !== 'string' || typeof optionValue !== 'string') continue;
    options.push({ name, value: optionValue, priceCents: null });
  }
  return options.length ? options : null;
}

export function restoreDemoCart(
  store: Store,
  products: Product[],
  raw: string | null,
): ShopCart {
  let cart = emptyCart(store);
  try {
    const entries: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(entries)) return cart;
    for (const entry of entries.slice(0, 100)) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        !Number.isInteger((entry as { quantity?: unknown }).quantity) ||
        ((entry as { quantity: number }).quantity ?? 0) < 1
      )
        continue;
      const record = entry as {
        productId?: unknown;
        quantity: number;
        selectedOptions?: unknown;
      };
      const product = products.find(
        (item) => item.id === record.productId && item.storeId === store.id,
      );
      if (
        !product ||
        product.currency !== cart.currency ||
        !/^\d+$/u.test(product.priceCents)
      )
        continue;
      const selection = storedOptions(record.selectedOptions);
      try {
        cart = updateDemoCart(
          cart,
          product,
          Math.min(record.quantity, productCartLimit(product)),
          selection,
        );
      } catch {
        // A combination that no longer exists is dropped during restore.
      }
    }
  } catch {
    // Stale or malformed preview storage must not break a storefront.
  }
  return cart;
}
