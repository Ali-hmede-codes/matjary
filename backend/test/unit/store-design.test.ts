import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { DesignSettings } from '../../libs/database/src/entities';
import {
  StoreDesignSettingsDto,
  DESIGN_CATALOG_LAYOUT_KEYS,
  DESIGN_POST_LAYOUT_KEYS,
} from '../../apps/api/src/modules/stores/dto/store-design.dto';
import { storedDesignSettings } from '../../apps/api/src/modules/stores/store-design';

const categoryA = '0b8f4bd8-8dd6-4df1-9a52-6c7c64f5f2a4';
const categoryB = '5f0b2b45-92ba-4a1d-8b2d-9a3f1c7d6e10';

function designErrors(value: unknown) {
  return validateSync(plainToInstance(StoreDesignSettingsDto, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

test('store design DTO accepts the studio vocabulary and rejects unknown keys', () => {
  assert.equal(
    designErrors({
      template: 'atelier',
      palette: 'ivory',
      typography: 'editorial',
      shape: 'soft',
      density: 'airy',
      hero: 'poster',
      postsLayout: 'frames',
      catalogLayout: 'gallery',
      accentLayout: 'cards',
      rhythm: 'every3',
      showProductImages: true,
      showProductDescriptions: false,
      categoryLayouts: [{ categoryId: categoryA, layout: 'menu' }],
    }).length,
    0,
  );
  for (const value of [
    { template: 'not-a-template' },
    { postsLayout: 'carousel-of-doom' },
    { palette: 'neon' },
    { rhythm: 'every7' },
    { categoryLayouts: [{ categoryId: 'not-a-uuid', layout: 'menu' }] },
    { categoryLayouts: [{ categoryId: categoryA, layout: 'nope' }] },
    { showProductImages: 'yes' },
    { unexpectedKnob: true },
  ])
    assert.ok(designErrors(value).length > 0, JSON.stringify(value));
});

test('store design vocabulary stays aligned across layouts', () => {
  assert.ok(DESIGN_POST_LAYOUT_KEYS.includes('spotlight'));
  assert.ok(DESIGN_CATALOG_LAYOUT_KEYS.includes('menu'));
  assert.ok(DESIGN_CATALOG_LAYOUT_KEYS.includes('shelves'));
});

test('saved design drops stale categories, duplicates, and foreign values', () => {
  const stored = storedDesignSettings(
    {
      template: 'table',
      palette: 'sand',
      postsLayout: 'grid',
      categoryLayouts: [
        { categoryId: categoryA, layout: 'menu' },
        { categoryId: categoryA, layout: 'cards' },
        { categoryId: categoryB, layout: 'gallery' },
        { categoryId: 'deleted-category', layout: 'menu' },
      ],
      // Older clients could smuggle anything into the JSON column.
      customCss: 'body { display: none }',
      showProductImages: true,
      showProductDescriptions: 'nope' as unknown as boolean,
    } as DesignSettings,
    [categoryA, categoryB],
  );
  assert.deepEqual(stored, {
    template: 'table',
    palette: 'sand',
    postsLayout: 'grid',
    categoryLayouts: [
      { categoryId: categoryA, layout: 'menu' },
      { categoryId: categoryB, layout: 'gallery' },
    ],
    showProductImages: true,
  });
  assert.equal(storedDesignSettings(null, []), null);
  assert.equal(storedDesignSettings(undefined, null), null);
  // An empty object is a valid reset, not a null save.
  assert.deepEqual(storedDesignSettings({}, []), {});
  // Categories are only pruned when the caller supplied the live id list.
  assert.deepEqual(
    storedDesignSettings(
      { categoryLayouts: [{ categoryId: 'some-category', layout: 'cards' }] },
      null,
    ),
    { categoryLayouts: [{ categoryId: 'some-category', layout: 'cards' }] },
  );
});

test('saved design overrides are bounded', () => {
  const entries = Array.from({ length: 250 }, (_, index) => ({
    categoryId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    layout: 'cards',
  }));
  const stored = storedDesignSettings({ categoryLayouts: entries }, null);
  assert.equal(stored?.categoryLayouts?.length, 200);
});
