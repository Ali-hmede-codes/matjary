import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  catalogLayoutInfo,
  defaultDesign,
  designPresets,
  designTheme,
  designWithPreset,
  hasSavedDesign,
  normalizeDesign,
  resolveCategoryLayout,
  rhythmSummary,
} from './design.ts';

const categoryA = '0b8f4bd8-8dd6-4df1-9a52-6c7c64f5f2a4';
const categoryB = '5f0b2b45-92ba-4a1d-8b2d-9a3f1c7d6e10';

test('every preset is a complete, distinct system', () => {
  assert.ok(designPresets.length >= 10, 'shop owners should have real choice');
  assert.equal(
    new Set(designPresets.map((p) => p.id)).size,
    designPresets.length,
  );
  assert.equal(
    new Set(designPresets.map((p) => p.name)).size,
    designPresets.length,
  );
  for (const preset of designPresets) {
    const design = designWithPreset(preset.id);
    assert.equal(design.template, preset.id);
    assert.ok(catalogLayoutInfo[design.catalogLayout]);
    assert.ok(catalogLayoutInfo[design.accentLayout]);
    assert.ok(catalogLayoutInfo[design.thirdLayout]);
    assert.notEqual(design.postsLayout, undefined);
    assert.ok(preset.tagline.length > 0);
  }
});

test('legacy-only rows keep the classic storefront', () => {
  assert.equal(hasSavedDesign(null), false);
  assert.equal(hasSavedDesign({}), false);
  assert.equal(
    hasSavedDesign({
      primaryColor: '#123456',
      showProductImages: false,
      customCss: 'x',
    }),
    false,
  );
  assert.equal(hasSavedDesign({ postsLayout: 'grid' }), true);
  assert.equal(hasSavedDesign({ categoryLayouts: [] }), true);
});

test('malformed saved designs fall back key by key', () => {
  const fallback = normalizeDesign(null);
  assert.deepEqual(fallback, defaultDesign);
  const design = normalizeDesign({
    template: 'unknown-template',
    palette: 'neon',
    typography: 42 as unknown as string,
    shape: 'sharp',
    density: 'giant',
    hero: 'classic',
    postsLayout: 'carousel',
    catalogLayout: 'gallery',
    accentLayout: 'nope',
    rhythm: 'every9',
    showProductImages: false,
    showProductDescriptions: null,
  });
  assert.equal(design.template, defaultDesign.template);
  assert.equal(design.palette, defaultDesign.palette);
  assert.equal(design.typography, defaultDesign.typography);
  assert.equal(design.shape, 'sharp');
  assert.equal(design.density, defaultDesign.density);
  assert.equal(design.postsLayout, defaultDesign.postsLayout);
  assert.equal(design.catalogLayout, 'gallery');
  assert.equal(design.accentLayout, defaultDesign.accentLayout);
  assert.equal(design.rhythm, defaultDesign.rhythm);
  assert.equal(design.showProductImages, false);
  assert.equal(design.showProductDescriptions, true);
});

test('per-section overrides accept only live, unique category ids', () => {
  const design = normalizeDesign({
    categoryLayouts: [
      { categoryId: categoryA, layout: 'menu' },
      { categoryId: categoryA, layout: 'gallery' },
      { categoryId: categoryB, layout: 'not-a-layout' },
      { categoryId: 'menu-1', layout: 'cards' },
      { layout: 'cards' },
      { categoryId: categoryB, layout: 'shelves' },
    ],
  });
  assert.deepEqual(design.categoryLayouts, [
    { categoryId: categoryA, layout: 'menu' },
    { categoryId: categoryB, layout: 'list' },
  ]);
});

test('repeat 3 rotates through the three chosen layouts', () => {
  const design = normalizeDesign({
    catalogLayout: 'menu',
    accentLayout: 'cards',
    thirdLayout: 'gallery',
    rhythm: 'repeat3',
  });
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) =>
      resolveCategoryLayout(design, index),
    ),
    [
      'menu',
      'cards',
      'gallery',
      'menu',
      'cards',
      'gallery',
      'menu',
      'cards',
      'gallery',
    ],
  );
  assert.equal(
    rhythmSummary(design),
    'Menu → Photo cards → Gallery, repeating',
  );
});

test('repeat 2 alternates the two chosen layouts', () => {
  const design = normalizeDesign({
    catalogLayout: 'list',
    accentLayout: 'gallery',
    rhythm: 'repeat2',
  });
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => resolveCategoryLayout(design, index)),
    ['list', 'gallery', 'list', 'gallery'],
  );
  assert.equal(resolveCategoryLayout(design, Number.NaN), 'list');
  assert.equal(rhythmSummary(design), 'Classic rows → Gallery, repeating');
});

test('old rhythm values keep their meaning after the redesign', () => {
  assert.equal(normalizeDesign({ rhythm: 'alternate' }).rhythm, 'repeat2');
  assert.equal(normalizeDesign({ rhythm: 'every2' }).rhythm, 'repeat2');
  assert.equal(normalizeDesign({ rhythm: 'every3' }).rhythm, 'repeat2');
  assert.equal(normalizeDesign({ rhythm: 'uniform' }).rhythm, 'same');
  assert.equal(normalizeDesign({ rhythm: 'custom' }).rhythm, 'same');
});

test('an explicit section layout wins over the repeat', () => {
  const design = normalizeDesign({
    catalogLayout: 'menu',
    accentLayout: 'cards',
    thirdLayout: 'gallery',
    rhythm: 'repeat3',
    categoryLayouts: [{ categoryId: categoryB, layout: 'featured' }],
  });
  assert.equal(resolveCategoryLayout(design, 4, categoryB), 'featured');
  assert.equal(resolveCategoryLayout(design, 4, categoryA), 'cards');
  assert.equal(resolveCategoryLayout(design, 4, 'uncategorized'), 'cards');
  assert.equal(resolveCategoryLayout(design, 4), 'cards');
});

test('same rhythm uses layout 1 everywhere, but overrides still win', () => {
  const design = normalizeDesign({
    catalogLayout: 'list',
    accentLayout: 'cards',
    rhythm: 'same',
    categoryLayouts: [{ categoryId: categoryA, layout: 'menu' }],
  });
  assert.equal(resolveCategoryLayout(design, 0, categoryA), 'menu');
  assert.equal(resolveCategoryLayout(design, 1, categoryB), 'list');
  assert.equal(resolveCategoryLayout(design, 5), 'list');
  assert.equal(rhythmSummary(design), 'Classic rows in every section');
});

test('applying a preset keeps the owner’s overrides and visibility choices', () => {
  const current = normalizeDesign({
    categoryLayouts: [{ categoryId: categoryA, layout: 'menu' }],
    showProductImages: false,
    showProductDescriptions: false,
  });
  const next = designWithPreset('bloom', current);
  assert.equal(next.template, 'bloom');
  assert.equal(next.palette, 'blush');
  assert.equal(next.postsLayout, 'masonry');
  assert.deepEqual(next.categoryLayouts, current.categoryLayouts);
  assert.equal(next.showProductImages, false);
  assert.equal(next.showProductDescriptions, false);
});

test('theme tokens expose palette, type, shape and spacing', () => {
  const design = normalizeDesign({
    template: 'table',
    palette: 'sand',
    typography: 'editorial',
    shape: 'pill',
    density: 'airy',
  });
  const theme = designTheme(design);
  assert.equal(theme['--brand-surface'], '#f8f2e7');
  assert.equal(theme['--brand-ink'], '#2c261d');
  assert.match(theme['--shop-font-display'] ?? '', /serif/u);
  assert.equal(theme['--shop-control-radius'], '999px');
  assert.equal(theme['--shop-section-gap'], '46px');
});
