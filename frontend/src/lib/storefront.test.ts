import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatProductPrice,
  isStoreVerified,
  storeMap,
  storeMediaUrl,
  storePath,
  storePresentation,
  storeSlugFromPath,
  storeSocialLinks,
} from './storefront.ts';

test('verification requires an active API badge and rejects expired timestamps', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  assert.equal(isStoreVerified(undefined, now), false);
  assert.equal(isStoreVerified({}, now), false);
  assert.equal(isStoreVerified({ hasVerificationBadge: true }, now), true);
  for (const expires of [null, '2026-10-25T12:00:00Z']) {
    assert.equal(
      isStoreVerified(
        { hasVerificationBadge: true, verificationBadgeExpiresAt: expires },
        now,
      ),
      true,
    );
    assert.equal(
      isStoreVerified(
        { hasVerificationBadge: false, verificationBadgeExpiresAt: expires },
        now,
      ),
      false,
    );
  }
  for (const expires of [
    '2026-10-23T12:00:00Z',
    '2026-10-24T12:00:00Z',
    'invalid',
    '',
  ]) {
    assert.equal(
      isStoreVerified(
        { hasVerificationBadge: true, verificationBadgeExpiresAt: expires },
        now,
      ),
      false,
    );
  }
});

test('shop URLs support deep links and keep preview mode explicit', () => {
  assert.equal(storePath('olive-kitchen'), '/stores/olive-kitchen');
  assert.equal(
    storePath('olive-kitchen', true),
    '/stores/olive-kitchen?demo=1',
  );
  assert.equal(storeSlugFromPath('/stores/olive-kitchen'), 'olive-kitchen');
  assert.equal(storeSlugFromPath('/stores/olive-kitchen/'), 'olive-kitchen');
  assert.equal(storeSlugFromPath('/stores/%6flive-kitchen'), 'olive-kitchen');
  for (const path of [
    '/',
    '/stores/',
    '/stores/a/products',
    '/stores/%2f',
    '/stores/%',
    '/stores/../',
    '/stores/UPPER',
    `/stores/${'a'.repeat(192)}`,
  ])
    assert.equal(storeSlugFromPath(path), null);
});

test('store type selects the layout and safely derives shop colors', () => {
  const restaurant = storePresentation({
    storeType: 'restaurant_menu',
    brandColor: '#fff',
  });
  assert.equal(restaurant.restaurant, true);
  assert.equal(restaurant.catalogTabLabel, 'Restaurant');
  assert.equal(restaurant.catalogTitle, 'On the menu');
  assert.equal(restaurant.theme['--brand-primary'], '#ffffff');
  assert.equal(restaurant.theme['--brand-on-primary'], '#17231e');
  const retail = storePresentation({
    storeType: 'ecommerce',
    brandColor: '#123456',
  });
  assert.equal(retail.restaurant, false);
  assert.equal(retail.catalogTabLabel, 'Shop');
  assert.equal(storePresentation({ brandColor: null }).catalogTabLabel, 'Shop');
  assert.equal(retail.theme['--brand-primary'], '#123456');
  assert.equal(retail.theme['--brand-on-primary'], '#ffffff');
  assert.notEqual(
    retail.theme['--brand-surface'],
    restaurant.theme['--brand-surface'],
  );
  assert.equal(
    storePresentation({ brandColor: 'red; background:url(x)' }).theme[
      '--brand-primary'
    ],
    '#254e40',
  );
  assert.equal(
    storePresentation({ storeType: 'restaurant_menu', brandColor: null }).theme[
      '--brand-primary'
    ],
    '#994a2c',
  );
});

test('shop images preserve opaque keys and reject unsafe URLs', () => {
  assert.equal(
    storeMediaUrl('store/A/logo.webp'),
    '/api/v1/uploads/store%2FA%2Flogo.webp',
  );
  assert.equal(
    storeMediaUrl('store/A%2FB.webp'),
    '/api/v1/uploads/store%2FA%252FB.webp',
  );
  assert.equal(
    storeMediaUrl('/api/v1/uploads/A%2FB.webp'),
    '/api/v1/uploads/A%2FB.webp',
  );
  assert.equal(
    storeMediaUrl('https://cdn.example.test/logo.png'),
    'https://cdn.example.test/logo.png',
  );
  for (const value of [
    null,
    '',
    '../private',
    'a/../private',
    '//evil.test/x',
    'a\\b',
    'javascript:alert(1)',
    'data:image/svg+xml,test',
    'https://user:password@example.test/a',
  ])
    assert.equal(storeMediaUrl(value), undefined);
});

test('profile social links show only saved, supported, safe destinations', () => {
  assert.deepEqual(storeSocialLinks(), []);
  assert.deepEqual(storeSocialLinks({ socialMediaLinks: null }), []);
  assert.deepEqual(
    storeSocialLinks({
      socialMediaLinks: {
        instagram: ' https://www.instagram.com/sample/ ',
        telegram: 'https://t.me/sample',
        facebook: 'javascript:alert(1)',
        youtube: 'https://user:password@example.test',
        whatsapp: '',
        tiktok: '   ',
        unsupported: 'https://example.test',
        constructor: 'https://example.test',
      },
    }),
    [
      {
        network: 'instagram',
        label: 'Instagram',
        href: 'https://www.instagram.com/sample/',
      },
      { network: 'telegram', label: 'Telegram', href: 'https://t.me/sample' },
    ],
  );
});

test('shop maps use saved decimal coordinates and a fixed embedded provider', () => {
  const preview = storeMap({
    city: 'Beirut',
    country: 'Lebanon',
    latitude: '33.89380000',
    longitude: '35.50180000',
    mapUrl: 'https://untrusted.example/embed',
  });
  assert.ok(preview);
  const embed = new URL(preview.embedUrl);
  assert.equal(embed.origin, 'https://www.openstreetmap.org');
  assert.equal(embed.pathname, '/export/embed.html');
  assert.equal(embed.searchParams.get('layer'), 'mapnik');
  assert.equal(embed.searchParams.get('marker'), '33.8938,35.5018');
  const [west = NaN, south = NaN, east = NaN, north = NaN] = (
    embed.searchParams.get('bbox') ?? ''
  )
    .split(',')
    .map(Number);
  assert.ok(west < 35.5018 && east > 35.5018);
  assert.ok(south < 33.8938 && north > 33.8938);
  assert.equal(
    new URL(preview.externalUrl).searchParams.get('mlat'),
    '33.8938',
  );
  assert.equal(
    new URL(preview.externalUrl).searchParams.get('mlon'),
    '35.5018',
  );
});

test('shop maps preserve zero and reject missing, invalid, or unmappable pins', () => {
  const base = { city: null, country: null };
  assert.equal(storeMap(undefined), undefined);
  assert.equal(storeMap(null), undefined);
  assert.equal(storeMap({ ...base, address: 'Beirut' }), undefined);
  assert.equal(
    storeMap({ ...base, mapUrl: 'https://example.test/map' }),
    undefined,
  );
  const zero = storeMap({ ...base, latitude: 0, longitude: '0.00000000' });
  assert.ok(zero);
  assert.equal(new URL(zero.embedUrl).searchParams.get('marker'), '0,0');
  for (const [latitude, longitude] of [
    [null, 35],
    [33, undefined],
    ['', 35],
    [' ', 35],
    ['0x21', 35],
    ['33&marker=0,0', 35],
    [NaN, 35],
    [33, Infinity],
    [91, 35],
    [-91, 35],
    [90, 35],
    [33, 181],
    [33, -181],
  ] as const) {
    assert.equal(storeMap({ ...base, latitude, longitude }), undefined);
  }
  for (const [latitude, longitude] of [
    [85.05112878, 180],
    [-85.05112878, -180],
  ]) {
    const edge = storeMap({ ...base, latitude, longitude });
    assert.ok(edge);
    const [west = NaN, south = NaN, east = NaN, north = NaN] = (
      new URL(edge.embedUrl).searchParams.get('bbox') ?? ''
    )
      .split(',')
      .map(Number);
    assert.ok(west >= -180 && east <= 180 && west < east);
    assert.ok(south >= -85.05112878 && north <= 85.05112878 && south < north);
  }
});

test('catalog prices preserve cents even above safe integer limits', () => {
  assert.equal(formatProductPrice('0', 'USD'), '$0.00');
  assert.equal(formatProductPrice('1050', 'USD'), '$10.50');
  assert.equal(
    formatProductPrice('9007199254740999', 'USD'),
    '$90,071,992,547,409.99',
  );
  assert.equal(formatProductPrice('-1', 'USD'), 'Contact for price');
  assert.equal(formatProductPrice('100', 'invalid'), 'Contact for price');
});
