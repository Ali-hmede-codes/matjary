import type { Store } from './api';
import { contrastColor, safeUrl } from './website.ts';

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

export function storePresentation(
  store: Pick<Store, 'storeType' | 'brandColor'>,
) {
  const restaurant = store.storeType === 'restaurant_menu';
  const fallback = restaurant ? '#994a2c' : '#254e40';
  const input = store.brandColor ?? '';
  const primary = /^#[\da-f]{6}$/iu.test(input)
    ? input
    : /^#[\da-f]{3}$/iu.test(input)
      ? `#${[...input.slice(1)].map((char) => char + char).join('')}`
      : fallback;
  return {
    restaurant,
    label: restaurant ? 'Restaurant & café' : 'Independent shop',
    catalogTabLabel: restaurant ? 'Restaurant' : 'Shop',
    catalogTitle: restaurant ? 'On the menu' : 'The collection',
    catalogAction: restaurant ? 'Explore our menu' : 'Explore the collection',
    theme: {
      '--brand-primary': primary,
      '--brand-secondary': primary,
      '--brand-surface': restaurant ? '#fffcf5' : '#ffffff',
      '--brand-ink': restaurant ? '#302820' : '#17231e',
      '--brand-on-primary': contrastColor(primary),
    },
  };
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

export function productCategoryLabel(category: string): string {
  return category
    .replace(/_/gu, ' ')
    .replace(/\b\w/gu, (char) => char.toUpperCase());
}
