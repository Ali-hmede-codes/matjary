import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatProductPrice,
  isStoreVerified,
  storeMediaUrl,
  storePath,
  storePresentation,
  storeSlugFromPath,
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
  assert.equal(restaurant.catalogTitle, 'On the menu');
  assert.equal(restaurant.theme['--brand-primary'], '#ffffff');
  assert.equal(restaurant.theme['--brand-on-primary'], '#17231e');
  const retail = storePresentation({
    storeType: 'ecommerce',
    brandColor: '#123456',
  });
  assert.equal(retail.restaurant, false);
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
