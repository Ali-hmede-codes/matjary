import type {
  Product,
  ProductStatus,
  SelectedProductOption,
  Store,
  StoreCategory,
} from './api';
import {
  designTheme,
  hasSavedDesign,
  normalizeDesign,
  type CatalogLayout,
} from './design.ts';
export type { CatalogLayout } from './design.ts';
import { contrastColor, safeUrl } from './website.ts';

export type StoreLifecycleStatus =
  'active' | 'offline' | 'archived' | 'trashed';
export type StoreLifecycleAction =
  'active' | 'offline' | 'archived' | 'trashed' | 'restore' | 'delete';
export const storeStatusLabel: Record<StoreLifecycleStatus, string> = {
  active: 'Online',
  offline: 'Off',
  archived: 'Archived',
  trashed: 'In Trash',
};
export function isCurrentStore(store: { status: StoreLifecycleStatus }) {
  return store.status === 'active' || store.status === 'offline';
}
export function selectOwnerStore<
  T extends { id: string; status: StoreLifecycleStatus; restricted?: boolean },
>(stores: T[], requestedId?: string | null): T | undefined {
  // An invalid explicit address must never silently open a different store's editor.
  return requestedId
    ? stores.find(
        (store) =>
          store.id === requestedId &&
          store.status !== 'trashed' &&
          !store.restricted,
      )
    : stores.find((store) => isCurrentStore(store) && !store.restricted);
}
// The owner panel remounts on every tab change, so the chosen store must be
// remembered per account. Without this the workspace silently fell back to
// the first current store whenever a tab was opened.
const ownerStoreStorageKey = (userId: string) =>
  `matjary:owner-store:${userId}`;
const storeIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function readOwnerStoreId(
  storage: Pick<Storage, 'getItem'>,
  userId: string,
): string {
  try {
    const value = storage.getItem(ownerStoreStorageKey(userId))?.trim() ?? '';
    return storeIdPattern.test(value) ? value : '';
  } catch {
    return '';
  }
}

export function rememberOwnerStore(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  userId: string,
  storeId: string | null,
) {
  try {
    if (storeId && storeIdPattern.test(storeId))
      storage.setItem(ownerStoreStorageKey(userId), storeId);
    else storage.removeItem(ownerStoreStorageKey(userId));
  } catch {
    // Private browsing can refuse storage; the in-memory choice still works.
  }
}

export function storeLifecycleActions(store: {
  status: StoreLifecycleStatus;
  restricted?: boolean;
}): StoreLifecycleAction[] {
  if (store.status === 'trashed') return ['restore', 'delete'];
  if (store.status === 'archived') return ['restore', 'trashed'];
  if (!isCurrentStore(store)) return [];
  return [
    ...(store.status === 'active'
      ? ['offline' as const]
      : store.restricted
        ? []
        : ['active' as const]),
    'archived',
    'trashed',
  ];
}

export function isStoreVerified(
  store?: Pick<Store, 'hasVerificationBadge' | 'verificationBadgeExpiresAt'>,
  now = Date.now(),
): boolean {
  // The API decides eligibility; an expired or invalid timestamp cannot add trust.
  return (
    store?.hasVerificationBadge === true &&
    (store.verificationBadgeExpiresAt == null ||
      Date.parse(store.verificationBadgeExpiresAt) > now)
  );
}

export function storePath(slug: string, demo = false): string {
  return `/stores/${encodeURIComponent(slug)}${demo ? '?demo=1' : ''}`;
}

export function storeCategoryPath(
  shopSlug: string,
  categorySlug: string,
  demo = false,
): string {
  return `/stores/${encodeURIComponent(shopSlug)}/c/${encodeURIComponent(categorySlug)}${demo ? '?demo=1' : ''}`;
}

/** Shop URL that opens the catalogue tab directly ("All items" links). */
export function storeMenuPath(shopSlug: string, demo = false): string {
  const params = new URLSearchParams({ view: 'catalog' });
  if (demo) params.set('demo', '1');
  return `/stores/${encodeURIComponent(shopSlug)}?${params}`;
}

export function storeProductPath(
  shopSlug: string,
  productSlug: string,
  demo = false,
): string {
  return `/stores/${encodeURIComponent(shopSlug)}/p/${encodeURIComponent(productSlug)}${demo ? '?demo=1' : ''}`;
}

export function storePostPath(
  shopSlug: string,
  postSlug: string,
  demo = false,
): string {
  return `/stores/${encodeURIComponent(shopSlug)}/post/${encodeURIComponent(postSlug)}${demo ? '?demo=1' : ''}`;
}

/**
 * Shared post link. Posts inside a shop keep the shop prefix so the crawler
 * rule and the prerendered share shells cover them; a shop-less post uses the
 * platform path.
 */
export function postPath(
  post: { slug: string; store?: { slug: string } | null },
  demo = false,
): string {
  return post.store
    ? storePostPath(post.store.slug, post.slug, demo)
    : `/post/${encodeURIComponent(post.slug)}${demo ? '?demo=1' : ''}`;
}

export interface StorefrontRoute {
  shopSlug: string;
  categorySlug?: string;
  productSlug?: string;
  postSlug?: string;
}

const routeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function readRouteSlug(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const slug = decodeURIComponent(value);
    return slug.length <= 191 && routeSlugPattern.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

/**
 * One parser for every storefront URL shape:
 *   /stores/:shop
 *   /stores/:shop/c/:categorySlug
 *   /stores/:shop/p/:productSlug
 *   /stores/:shop/post/:postSlug
 * Anything else belongs to another route and must not render a shop.
 */
export function storefrontRouteFromPath(
  pathname: string,
): StorefrontRoute | null {
  const match =
    /^\/stores\/([^/]+)(?:\/([cp])\/([^/]+)|\/post\/([^/]+))?\/?$/u.exec(
      pathname,
    );
  if (!match?.[1]) return null;
  const shopSlug = readRouteSlug(match[1]);
  if (!shopSlug) return null;
  if (match[4]) {
    const postSlug = readRouteSlug(match[4]);
    return postSlug ? { shopSlug, postSlug } : null;
  }
  if (!match[2]) return { shopSlug };
  const slug = readRouteSlug(match[3]);
  if (!slug) return null;
  return match[2] === 'c'
    ? { shopSlug, categorySlug: slug }
    : { shopSlug, productSlug: slug };
}

/** Platform-level post path used by posts that do not belong to a shop. */
export function postSlugFromPath(pathname: string): string | null {
  const match = /^\/post\/([^/]+)\/?$/u.exec(pathname);
  return match?.[1] ? readRouteSlug(match[1]) : null;
}

// Category rows have no slug column; their unique-per-shop name is the source.
// Non-Latin names get a stable short hash so URLs stay unique instead of
// collapsing into one unreadable "category" path.
function shortNameHash(value: string): string {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 6);
}

export function categorySlug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/gu, '');
  return base || `category-${shortNameHash(name.trim() || 'category')}`;
}

export function findCategoryBySlug<
  T extends { id: string; name: string; productCount?: number },
>(categories: T[], slug: string): T | undefined {
  return categories.find((category) => categorySlug(category.name) === slug);
}

const catalogLayouts: readonly CatalogLayout[] = ['list', 'cards', 'compact'];

/**
 * Category order decides the visual rhythm of the shop: 1st section is a menu
 * list, 2nd a photo grid, 3rd a compact price list, then it repeats. Shops with
 * a saved design use their own rhythm instead (see lib/design.ts).
 */
export function catalogLayout(index: number): CatalogLayout {
  const safe = Number.isInteger(index) && index > 0 ? index : 0;
  return catalogLayouts[safe % catalogLayouts.length] ?? 'list';
}

export function storeSlugFromPath(pathname: string): string | null {
  const match = /^\/stores\/([^/]+)\/?$/u.exec(pathname);
  if (!match?.[1]) return null;
  try {
    const slug = decodeURIComponent(match[1]);
    return slug.length <= 191 && /^[a-z0-9]+(-[a-z0-9]+)*$/u.test(slug)
      ? slug
      : null;
  } catch {
    return null;
  }
}

// Bare keys are opaque: encode the entire key and keep the API's media authorization.
export function storeMediaUrl(value: string | null | undefined) {
  if (!value) return undefined;
  if (/^(?:[a-z][a-z\d+.-]*:|\/)/iu.test(value)) return safeUrl(value);
  if (
    /[\s\\?#]/u.test(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return undefined;
  return `/api/v1/uploads/${encodeURIComponent(value)}`;
}

const socialLabels = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'X',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  website: 'Website',
};

export function storeSocialLinks(
  store?: Pick<Store, 'socialMediaLinks' | 'location'>,
) {
  const links = Object.entries(socialLabels).flatMap(([network, label]) => {
    const value = store?.socialMediaLinks?.[network];
    const href = typeof value === 'string' ? safeUrl(value.trim()) : undefined;
    return href ? [{ network, label, href }] : [];
  });
  // Shops saved before the social editor may only have a legacy website.
  if (!links.some((link) => link.network === 'website')) {
    const href = safeUrl(store?.location?.website ?? '');
    if (href) links.push({ network: 'website', label: 'Website', href });
  }
  return links;
}

export function storeMap(location: Store['location']) {
  function coordinate(value: number | string | null | undefined) {
    // MySQL DECIMAL coordinates may arrive as strings; empty values are not zero.
    if (typeof value === 'string' && /^[+-]?\d+(?:\.\d+)?$/u.test(value.trim()))
      value = Number(value);
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  const latitude = coordinate(location?.latitude);
  const longitude = coordinate(location?.longitude);
  const latitudeLimit = 85.05112878;
  if (
    latitude === undefined ||
    longitude === undefined ||
    Math.abs(latitude) > latitudeLimit ||
    Math.abs(longitude) > 180
  )
    return undefined;

  // Only generate our fixed map provider URL; never frame a shop-supplied URL.
  const params = new URLSearchParams({
    bbox: [
      Math.max(-180, longitude - 0.008),
      Math.max(-latitudeLimit, latitude - 0.005),
      Math.min(180, longitude + 0.008),
      Math.min(latitudeLimit, latitude + 0.005),
    ].join(','),
    layer: 'mapnik',
    marker: `${latitude},${longitude}`,
  });
  return {
    embedUrl: `https://www.openstreetmap.org/export/embed.html?${params}`,
    externalUrl: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`,
  };
}

export function storePresentation(
  store: Pick<Store, 'brandColor'> & {
    storeType?: Store['storeType'];
    designSettings?: Store['designSettings'];
  },
) {
  const restaurant = store.storeType === 'restaurant_menu';
  const fallback = restaurant ? '#994a2c' : '#254e40';
  const input = store.brandColor ?? '';
  const primary = /^#[\da-f]{6}$/iu.test(input)
    ? input
    : /^#[\da-f]{3}$/iu.test(input)
      ? `#${[...input.slice(1)].map((char) => char + char).join('')}`
      : fallback;
  // Shops saved before the design studio keep the exact legacy storefront:
  // only stores with real studio keys get palette, font and layout tokens.
  const design = hasSavedDesign(store.designSettings)
    ? normalizeDesign(store.designSettings)
    : null;
  const designTokens = design ? designTheme(design) : null;
  // Record<string, string> keeps the token bag indexable for tests and pages
  // while each CSS variable stays one plain string.
  const theme: Record<string, string> = {
    '--brand-primary': primary,
    '--brand-secondary': designTokens?.['--brand-secondary'] ?? primary,
    '--brand-surface':
      designTokens?.['--brand-surface'] ?? (restaurant ? '#fffcf5' : '#ffffff'),
    '--brand-ink':
      designTokens?.['--brand-ink'] ?? (restaurant ? '#302820' : '#17231e'),
    '--brand-on-primary': contrastColor(primary),
    ...designTokens,
  };
  return {
    restaurant,
    label: restaurant ? 'Restaurant & café' : 'Independent shop',
    catalogTabLabel: restaurant ? 'Restaurant' : 'Shop',
    catalogTitle: restaurant ? 'On the menu' : 'The collection',
    catalogAction: restaurant ? 'Explore our menu' : 'Explore the collection',
    design,
    theme,
  };
}

/**
 * Menu shops share as a menu. The menu line leads so preview truncation can
 * never drop the signal; owner copy stays untouched otherwise.
 */
export function menuShareDescription(
  description: string | null | undefined,
  line: string,
): string {
  const clean = description?.trim() ?? '';
  if (/\bmenus?\b/iu.test(clean)) return clean;
  return clean ? `${line} ${clean}` : line;
}

export function formatProductPrice(cents: string, currency: string): string {
  if (!/^\d+$/u.test(cents) || !/^[A-Z]{3}$/u.test(currency))
    return 'Contact for price';
  // Prices are BIGINT strings. Format the integer and fraction separately to avoid rounding.
  const amount = BigInt(cents);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
      .formatToParts(amount / 100n)
      .map((part) =>
        part.type === 'fraction'
          ? (amount % 100n).toString().padStart(2, '0')
          : part.value,
      )
      .join('');
  } catch {
    return 'Contact for price';
  }
}

export function productPriceLabel(
  product: Pick<Product, 'options' | 'priceCents' | 'currency'>,
): string {
  const price = formatProductPrice(
    productFromPriceCents(product),
    product.currency,
  );
  return productHasPricedOptions(product) ? `from ${price}` : price;
}

export function priceInput(value: string): number | null {
  if (value.length > 32 || !/^\d+(?:\.\d{1,2})?$/.test(value.trim()))
    return null;
  const [whole = '0', fraction = ''] = value.trim().split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

export function decimalPrice(cents: string): string {
  if (!/^\d+$/.test(cents)) return '';
  const n = BigInt(cents);
  return `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`;
}

export function productCategoryLabel(category: string): string {
  return category
    .replace(/_/gu, ' ')
    .replace(/\b\w/gu, (char) => char.toUpperCase());
}

export interface MenuCategoryGroup {
  key: string;
  name: string;
  count: number;
}

export function productCategoryKey(
  product: Pick<Product, 'category' | 'categoryId'>,
): string {
  return product.categoryId ?? product.category ?? '';
}

export function productHasOptions(product: Pick<Product, 'options'>): boolean {
  return Boolean(product.options?.length);
}

/**
 * An owner can publish an item as out of stock ("sold out for now") without
 * hiding it, and a zero stock count means the same thing at checkout.
 */
export function productIsOutOfStock(
  product: Pick<Product, 'status' | 'stockQuantity'>,
): boolean {
  return product.status === 'out_of_stock' || product.stockQuantity === 0;
}

/** Owner-facing wording for the product lifecycle, shared by the panel. */
export const productStatusLabel: Record<ProductStatus, string> = {
  draft: 'Draft',
  active: 'Published',
  archived: 'Archived',
  out_of_stock: 'Out of stock',
};

/** True when at least one option value sets its own price. */
export function productHasPricedOptions(
  product: Pick<Product, 'options'>,
): boolean {
  return Boolean(
    product.options?.some((group) =>
      group.values.some(
        (value) => value.priceCents != null && value.priceCents !== '0',
      ),
    ),
  );
}

/**
 * Lowest price a shopper can reach. Every value with its own price is a
 * candidate; the base price stays reachable while any value is unpriced.
 */
export function productFromPriceCents(
  product: Pick<Product, 'options' | 'priceCents'>,
): string {
  let lowest: bigint | null = null;
  let allPriced = Boolean(product.options?.length);
  for (const group of product.options ?? []) {
    for (const value of group.values) {
      if (value.priceCents && /^\d+$/u.test(value.priceCents)) {
        const cents = BigInt(value.priceCents);
        if (lowest === null || cents < lowest) lowest = cents;
      } else {
        allPriced = false;
      }
    }
  }
  if (lowest === null) return product.priceCents;
  if (!allPriced && /^\d+$/u.test(product.priceCents)) {
    const base = BigInt(product.priceCents);
    if (base < lowest) lowest = base;
  }
  return lowest.toString();
}

/** A chosen value with its own price replaces the product's base price. */
export function selectedUnitPriceCents(
  basePriceCents: string,
  options?: readonly SelectedProductOption[] | null,
): string {
  for (const option of options ?? []) {
    if (option.priceCents && /^\d+$/u.test(option.priceCents))
      return option.priceCents;
  }
  return basePriceCents;
}

/** Stable signature that separates cart lines sharing a product. */
export function selectedOptionsKey(
  options?: readonly SelectedProductOption[] | null,
): string {
  return options?.length
    ? JSON.stringify(
        options.map((option) => [
          option.name,
          option.value,
          option.priceCents ?? '',
        ]),
      )
    : '';
}

/** Returns the chosen values in product order, or null while incomplete. */
export function productOptionSelection(
  product: Pick<Product, 'options'>,
  chosen: Record<string, string | undefined>,
): SelectedProductOption[] | null {
  const groups = product.options ?? [];
  if (!groups.length) return null;
  const selection: SelectedProductOption[] = [];
  for (const group of groups) {
    const chosenLabel = chosen[group.name];
    const value = group.values.find((entry) => entry.label === chosenLabel);
    if (!value) return null;
    selection.push({
      name: group.name,
      value: value.label,
      priceCents: value.priceCents,
    });
  }
  return selection;
}

/** Live input helper: keeps a trailing dash while the owner is still typing. */
export function slugDraft(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/-{2,}/gu, '-')
    .slice(0, 191);
}

export function normalizeSlug(value: string): string {
  return slugDraft(value).replace(/^-+|-+$/gu, '');
}

export function productCategoryName(
  product: Pick<Product, 'category' | 'categoryName'>,
): string {
  return (
    product.categoryName?.trim() || productCategoryLabel(product.category ?? '')
  );
}

export function categoryIndexGroups(
  categories: Pick<StoreCategory, 'id' | 'name' | 'productCount'>[],
  uncategorized = 0,
): MenuCategoryGroup[] {
  const seen = new Set<string>();
  const groups: MenuCategoryGroup[] = [];
  for (const category of categories) {
    const key = category.id?.trim();
    const name = category.name?.trim();
    if (!key || !name || seen.has(key)) continue;
    seen.add(key);
    const count = Math.max(0, category.productCount ?? 0);
    if (count > 0) groups.push({ key, name, count });
  }
  // Older products without a category row must stay reachable from the index.
  if (uncategorized > 0)
    groups.push({
      key: 'uncategorized',
      name: 'More items',
      count: uncategorized,
    });
  return groups;
}

/**
 * Merge the owner's ordered category list with the categories actually carried
 * by the loaded products. The API order wins so a menu reads the way its owner
 * arranged it; products without a category row still get a group of their own,
 * and empty categories are dropped because an empty menu section is noise.
 */
export function menuCategoryGroups(
  products: Pick<Product, 'category' | 'categoryId' | 'categoryName'>[],
  categories: Pick<StoreCategory, 'id' | 'name'>[] = [],
): MenuCategoryGroup[] {
  const groups = new Map<string, MenuCategoryGroup>();
  for (const category of categories) {
    const key = category.id?.trim();
    const name = category.name?.trim();
    if (!key || !name || groups.has(key)) continue;
    groups.set(key, { key, name, count: 0 });
  }
  for (const product of products) {
    const key = productCategoryKey(product);
    const group = groups.get(key);
    if (group) group.count += 1;
    else
      groups.set(key, {
        key,
        name: productCategoryName(product) || 'Other items',
        count: 1,
      });
  }
  return [...groups.values()].filter((group) => group.count > 0);
}
