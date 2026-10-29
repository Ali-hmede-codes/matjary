import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StoreType } from '../../libs/database/src/entities';
import { toStoreDirectoryItemDto } from '../../apps/api/src/modules/stores/dto/store-directory.dto';

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: '2f1c6f4e-1f5a-4f1e-8a37-0a7f3d6f4c11',
    name: 'Olive & Thyme',
    slug: 'olive-and-thyme',
    logoKey: 'stores/olive/logo.webp',
    brandColor: '#254e40',
    storeType: StoreType.ECOMMERCE,
    businessCategory: 'bakery',
    city: 'Tripoli',
    country: 'Lebanon',
    hasVerificationBadge: false,
    verificationBadgeExpiresAt: null,
    ...overrides,
  };
}

test('directory rows carry the taxonomy labels the page renders', () => {
  const item = toStoreDirectoryItemDto(source(), 12, 34);
  assert.equal(item.businessCategory, 'bakery');
  assert.equal(item.businessCategoryLabel, 'Bakery');
  assert.equal(item.categoryGroup, 'food_drink');
  assert.equal(item.categoryGroupLabel, 'Food & drink');
  assert.equal(item.city, 'Tripoli');
  assert.equal(item.postsCount, 12);
  assert.equal(item.productsCount, 34);
});

test('directory counts fall back to zero instead of undefined', () => {
  const item = toStoreDirectoryItemDto(source());
  assert.equal(item.postsCount, 0);
  assert.equal(item.productsCount, 0);
});

test('an expired badge is not reported as active', () => {
  const active = toStoreDirectoryItemDto(
    source({
      hasVerificationBadge: true,
      verificationBadgeExpiresAt: new Date(Date.now() + 60_000),
    }),
  );
  assert.equal(active.hasVerificationBadge, true);

  // The five-day renewal window still shows the tick; beyond it the badge is
  // gone even though the store row keeps its grant history.
  const grace = toStoreDirectoryItemDto(
    source({
      hasVerificationBadge: true,
      verificationBadgeExpiresAt: new Date(Date.now() - 60_000),
    }),
  );
  assert.equal(grace.hasVerificationBadge, true);

  const expired = toStoreDirectoryItemDto(
    source({
      hasVerificationBadge: true,
      verificationBadgeExpiresAt: new Date(Date.now() - 6 * 86_400_000),
    }),
  );
  assert.equal(expired.hasVerificationBadge, false);
});

test('legacy categories resolve to the visible Other fallback', () => {
  const item = toStoreDirectoryItemDto(source({ businessCategory: 'unknown' }));
  assert.equal(item.businessCategory, 'other');
  assert.equal(item.businessCategoryLabel, 'Other business');
  assert.equal(item.categoryGroup, 'other');
});
