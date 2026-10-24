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

export function storeSocialLinks(store?: Pick<Store, 'socialMediaLinks'>) {
  return Object.entries(socialLabels).flatMap(([network, label]) => {
    const value = store?.socialMediaLinks?.[network];
    const href = typeof value === 'string' ? safeUrl(value.trim()) : undefined;
    return href ? [{ network, label, href }] : [];
  });
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
