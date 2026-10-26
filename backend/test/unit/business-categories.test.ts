import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUSINESS_CATEGORIES,
  BUSINESS_CATEGORY_GROUPS,
  businessCategoryDefinition,
  businessCategoryGroupLabel,
  businessCategoryLabel,
  defaultBusinessCategoryForStoreType,
  isBusinessCategory,
} from '../../libs/database/src/business-categories';

test('business categories are unique, grouped and cover common local shops', () => {
  const slugs = BUSINESS_CATEGORIES.map((category) => category.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.ok(slugs.length >= 100, 'catalog should stay a broad list');

  const groups = new Set(BUSINESS_CATEGORY_GROUPS.map((group) => group.slug));
  for (const category of BUSINESS_CATEGORIES) {
    assert.ok(groups.has(category.group), `${category.slug} has a known group`);
    assert.match(category.slug, /^[a-z0-9_]+$/u);
    assert.ok(category.label.trim().length > 0);
  }

  for (const expected of [
    'restaurants',
    'cafe',
    'school',
    'university',
    'social_media_services',
    'clothing_store',
    'clinic',
    'other',
  ]) {
    assert.ok(isBusinessCategory(expected), `${expected} exists`);
  }
  assert.equal(isBusinessCategory('not_a_real_category'), false);
  assert.equal(isBusinessCategory(null), false);
});

test('unknown or legacy categories resolve to a safe Other fallback', () => {
  assert.equal(businessCategoryLabel('restaurants'), 'Restaurant');
  assert.equal(businessCategoryLabel('unknown_shop'), 'Other business');
  assert.equal(businessCategoryLabel(null), 'Other business');
  assert.equal(businessCategoryDefinition('school').group, 'education');
  assert.equal(
    businessCategoryGroupLabel('social_media_services'),
    'Digital & media',
  );
});

test('legacy shop types map into visible categories after migration', () => {
  assert.equal(
    defaultBusinessCategoryForStoreType('restaurant_menu'),
    'restaurants',
  );
  assert.equal(
    defaultBusinessCategoryForStoreType('ecommerce'),
    'retail_store',
  );
  assert.equal(defaultBusinessCategoryForStoreType(undefined), 'retail_store');
});
