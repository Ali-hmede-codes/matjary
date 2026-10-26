import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  catalogLayout,
  categoryIndexGroups,
  categorySlug,
  findCategoryBySlug,
  formatProductPrice,
  readOwnerStoreId,
  rememberOwnerStore,
  selectOwnerStore,
  storeLifecycleActions,
  isCurrentStore,
  type StoreLifecycleStatus,
  priceInput,
  decimalPrice,
  isStoreVerified,
  menuCategoryGroups,
  normalizeSlug,
  productCategoryKey,
  productOptionSelection,
  slugDraft,
  storeCategoryPath,
  storeMenuPath,
  storefrontRouteFromPath,
  storeMap,
  storeMediaUrl,
  storePath,
  storePresentation,
  storeProductPath,
  storeSlugFromPath,
  storeSocialLinks,
} from './storefront.ts';

test('owner selection never defaults to archived, trashed, or restricted stores', () => {
  const stores: {
    id: string;
    status: StoreLifecycleStatus;
    restricted?: boolean;
  }[] = [
    { id: 'archived', status: 'archived' },
    { id: 'trash', status: 'trashed' },
    { id: 'restricted', status: 'active', restricted: true },
    { id: 'off', status: 'offline' },
  ];
  assert.equal(selectOwnerStore(stores)?.id, 'off');
  assert.equal(selectOwnerStore(stores, 'archived')?.id, 'archived');
  for (const id of ['trash', 'restricted', 'another-owner'])
    assert.equal(selectOwnerStore(stores, id), undefined);
  assert.equal(selectOwnerStore(stores.slice(0, 3)), undefined);
  assert.deepEqual(
    stores.filter(isCurrentStore).map((s) => s.id),
    ['restricted', 'off'],
  );
});

test('owner store choice is remembered per account and validated', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const storeId = '0b8f4bd8-8dd6-4df1-9a52-6c7c64f5f2a4';
  assert.equal(readOwnerStoreId(storage, 'user-a'), '');
  rememberOwnerStore(storage, 'user-a', storeId);
  assert.equal(readOwnerStoreId(storage, 'user-a'), storeId);
  assert.equal(readOwnerStoreId(storage, 'user-b'), '');
  assert.equal(values.get('matjary:owner-store:user-a'), storeId);
  rememberOwnerStore(storage, 'user-a', null);
  assert.equal(readOwnerStoreId(storage, 'user-a'), '');
  values.set('matjary:owner-store:user-b', 'not-a-store');
  assert.equal(readOwnerStoreId(storage, 'user-b'), '');
  const denied = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  };
  assert.equal(readOwnerStoreId(denied, 'user-a'), '');
  rememberOwnerStore(denied, 'user-a', storeId);
});

test('owner lifecycle controls only offer valid actions and Trash offers restore or permanent delete', () => {
  assert.deepEqual(storeLifecycleActions({ status: 'active' }), [
    'offline',
    'archived',
    'trashed',
  ]);
  assert.deepEqual(storeLifecycleActions({ status: 'offline' }), [
    'active',
    'archived',
    'trashed',
  ]);
  assert.deepEqual(storeLifecycleActions({ status: 'archived' }), [
    'restore',
    'trashed',
  ]);
  assert.deepEqual(storeLifecycleActions({ status: 'trashed' }), [
    'restore',
    'delete',
  ]);
  assert.deepEqual(
    storeLifecycleActions({ status: 'offline', restricted: true }),
    ['archived', 'trashed'],
  );
});

test('owner price entry is exact and rejects invalid or unsafe amounts', () => {
  assert.equal(priceInput('12.50'), 1250);
  assert.equal(priceInput('0'), 0);
  assert.equal(priceInput(' 7.1 '), 710);
  assert.equal(priceInput('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  for (const value of ['', '-1', '1e3', '1.005', 'NaN', '90071992547409.92'])
    assert.equal(priceInput(value), null);
  assert.equal(decimalPrice('1250'), '12.50');
});

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

test('menu categories follow the owner order and absorb product fallbacks', () => {
  const products = [
    {
      category: 'dessert',
      categoryId: 'cat-dessert',
      categoryName: 'Desserts',
    },
    { category: 'food', categoryId: 'cat-mains', categoryName: 'Mains' },
    { category: 'food', categoryId: 'cat-mains', categoryName: 'Mains' },
    { category: 'beverage', categoryId: null, categoryName: null },
  ];
  const groups = menuCategoryGroups(products, [
    { id: 'cat-drinks', name: 'Drinks' },
    { id: 'cat-mains', name: 'Mains' },
    { id: 'cat-dessert', name: 'Desserts' },
  ]);
  // Owner order wins, empty categories are dropped, repeated rows are counted.
  assert.deepEqual(groups, [
    { key: 'cat-mains', name: 'Mains', count: 2 },
    { key: 'cat-dessert', name: 'Desserts', count: 1 },
    { key: 'beverage', name: 'Beverage', count: 1 },
  ]);
  assert.equal(productCategoryKey(products[1]!), 'cat-mains');
  assert.deepEqual(menuCategoryGroups([]), []);
  // A product without any category still gets a visible group, never a blank one.
  assert.deepEqual(
    menuCategoryGroups([
      { category: '', categoryId: null, categoryName: '  ' },
    ]),
    [{ key: '', name: 'Other items', count: 1 }],
  );
});

test('storefront routes resolve shop, category, and product slugs', () => {
  assert.deepEqual(storefrontRouteFromPath('/stores/olive'), {
    shopSlug: 'olive',
  });
  assert.deepEqual(storefrontRouteFromPath('/stores/olive/'), {
    shopSlug: 'olive',
  });
  assert.deepEqual(storefrontRouteFromPath('/stores/olive/c/main-dishes'), {
    shopSlug: 'olive',
    categorySlug: 'main-dishes',
  });
  assert.deepEqual(storefrontRouteFromPath('/stores/olive/p/harvest-bowl'), {
    shopSlug: 'olive',
    productSlug: 'harvest-bowl',
  });
  for (const path of [
    '/',
    '/stores',
    '/stores/',
    '/stores/a/products',
    '/stores/a/c/',
    '/stores/a/x/mains',
    '/stores/a/p/b/c',
    '/stores/UPPER',
    '/stores/a/c/UPPER',
    '/stores/%2f',
    '/stores/%',
  ])
    assert.equal(storefrontRouteFromPath(path), null);
});

test('category slugs stay readable, stable, and unique for other scripts', () => {
  assert.equal(categorySlug('Main Dishes'), 'main-dishes');
  assert.equal(categorySlug('  Café  &  Crêpes '), 'cafe-crepes');
  assert.equal(categorySlug('مشروبات'), categorySlug('مشروبات'));
  assert.match(categorySlug('مشروبات'), /^category-[a-z0-9]{6}$/u);
  assert.notEqual(categorySlug('مشروبات'), categorySlug('حلويات'));
  assert.equal(
    findCategoryBySlug([{ id: 'a', name: 'Main Dishes' }], 'main-dishes')?.id,
    'a',
  );
  assert.equal(
    storeCategoryPath('olive', 'main-dishes'),
    '/stores/olive/c/main-dishes',
  );
  assert.equal(storeMenuPath('olive'), '/stores/olive?view=catalog');
  assert.equal(
    storeMenuPath('olive', true),
    '/stores/olive?view=catalog&demo=1',
  );
  assert.equal(
    storeProductPath('olive', 'harvest-bowl', true),
    '/stores/olive/p/harvest-bowl?demo=1',
  );
});

test('catalog layouts rotate by category position', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((index) => catalogLayout(index)),
    ['list', 'cards', 'compact', 'list', 'cards', 'compact'],
  );
  assert.equal(catalogLayout(-1), 'list');
  assert.equal(catalogLayout(Number.NaN), 'list');
});

test('public category counts drop empty and duplicate sections', () => {
  assert.deepEqual(
    categoryIndexGroups([
      { id: 'a', name: 'Mains', productCount: 3 },
      { id: 'b', name: 'Empty', productCount: 0 },
      { id: 'a', name: 'Mains', productCount: 1 },
      { id: '', name: 'Broken', productCount: 4 },
    ]),
    [{ key: 'a', name: 'Mains', count: 3 }],
  );
  assert.deepEqual(categoryIndexGroups([]), []);
  assert.deepEqual(
    categoryIndexGroups([{ id: 'a', name: 'Mains', productCount: 2 }], 3),
    [
      { key: 'a', name: 'Mains', count: 2 },
      { key: 'uncategorized', name: 'More items', count: 3 },
    ],
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

test('product slugs keep readable URLs while typing and trim on save', () => {
  assert.equal(normalizeSlug('  Crème Brûlée Mug! '), 'creme-brulee-mug');
  assert.equal(
    normalizeSlug('Handmade  Ceramic -- Mug'),
    'handmade-ceramic-mug',
  );
  assert.equal(slugDraft('My-'), 'my-');
  assert.equal(normalizeSlug('My-'), 'my');
  assert.equal(normalizeSlug('!!!'), '');
});

test('product option selection stays complete and in product order', () => {
  const product = {
    options: [
      { name: 'Size', values: ['S', 'M'] },
      { name: 'Color', values: ['Red', 'Blue'] },
    ],
  };
  assert.equal(productOptionSelection(product, {}), null);
  assert.equal(
    productOptionSelection(product, { Size: 'M', Color: 'Green' }),
    null,
  );
  assert.deepEqual(
    productOptionSelection(product, { Color: 'Blue', Size: 'M' }),
    [
      { name: 'Size', value: 'M' },
      { name: 'Color', value: 'Blue' },
    ],
  );
});
