import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Product, Store } from './api';
import {
  CartRequestError,
  cartApi,
  cartErrorMessage,
  checkoutUrl,
  demoCartKey,
  emptyCart,
  productCartLimit,
  restoreDemoCart,
  serializeDemoCart,
  updateDemoCart,
} from './cart.ts';

const store: Store = {
  id: 'store-a',
  slug: 'shop-a',
  name: 'Shop A',
  brandColor: null,
};
const product: Product = {
  id: 'product-a',
  storeId: store.id,
  slug: 'mug',
  name: 'Ceramic mug',
  description: null,
  priceCents: '1250',
  currency: 'USD',
  category: 'merchandise',
  stockQuantity: null,
  imageKeys: null,
  tags: null,
};

test('cart adds, updates, and removes lines without mutating previous state', () => {
  const empty = emptyCart(store);
  const first = updateDemoCart(empty, product, 1);
  const second = updateDemoCart(first, product, 3);
  assert.equal(empty.itemCount, 0);
  assert.equal(first.itemCount, 1);
  assert.equal(second.items.length, 1);
  assert.equal(second.itemCount, 3);
  assert.equal(second.subtotalCents, '3750');
  assert.equal(second.items[0]?.lineTotalCents, '3750');
  const another = updateDemoCart(
    second,
    { ...product, id: 'product-b', priceCents: '501' },
    2,
  );
  assert.equal(another.subtotalCents, '4752');
  assert.equal(another.itemCount, 5);
  const removed = updateDemoCart(second, product, 0);
  assert.deepEqual(removed.items, []);
  assert.equal(removed.itemCount, 0);
  assert.equal(removed.subtotalCents, '0');
});

test('totals preserve integer cents beyond the safe number range', () => {
  const cart = updateDemoCart(
    emptyCart(store),
    { ...product, priceCents: '9007199254740999' },
    3,
  );
  assert.equal(cart.subtotalCents, '27021597764222997');
});

test('cart enforces whole quantities, stock limits, store isolation, and currency', () => {
  assert.equal(productCartLimit(), 99);
  assert.equal(productCartLimit({ ...product, stockQuantity: 0 }), 0);
  assert.equal(productCartLimit({ ...product, stockQuantity: 3 }), 3);
  assert.equal(productCartLimit({ ...product, stockQuantity: 200 }), 99);
  for (const quantity of [-1, 1.5, NaN, Infinity, 100]) {
    assert.throws(
      () => updateDemoCart(emptyCart(store), product, quantity),
      CartRequestError,
    );
  }
  assert.throws(() =>
    updateDemoCart(emptyCart(store), { ...product, stockQuantity: 1 }, 2),
  );
  assert.throws(() =>
    updateDemoCart(emptyCart(store), { ...product, stockQuantity: 0 }, 1),
  );
  assert.throws(() =>
    updateDemoCart(emptyCart(store), { ...product, storeId: 'other-shop' }, 1),
  );
  assert.throws(() =>
    updateDemoCart(emptyCart(store), { ...product, currency: 'EUR' }, 1),
  );
  assert.throws(() =>
    updateDemoCart(emptyCart(store), { ...product, priceCents: '-1' }, 1),
  );
});

test('option combinations become separate cart lines and survive restore', () => {
  const configurable: Product = {
    ...product,
    options: [
      {
        name: 'Size',
        values: [
          { label: 'S', priceCents: null },
          { label: 'M', priceCents: '200' },
        ],
      },
      {
        name: 'Color',
        values: [
          { label: 'Red', priceCents: null },
          { label: 'Blue', priceCents: '100' },
        ],
      },
    ],
  };
  const redSmall = [
    { name: 'Size', value: 'S', priceCents: null },
    { name: 'Color', value: 'Red', priceCents: null },
  ];
  const blueMedium = [
    { name: 'Size', value: 'M', priceCents: '200' },
    { name: 'Color', value: 'Blue', priceCents: '100' },
  ];
  let cart = updateDemoCart(emptyCart(store), configurable, 1, redSmall);
  cart = updateDemoCart(cart, configurable, 2, blueMedium);
  assert.equal(cart.items.length, 2);
  assert.equal(cart.itemCount, 3);
  assert.equal(cart.subtotalCents, '4350');
  assert.equal(cart.items[0]?.unitPriceCents, '1250');
  assert.equal(cart.items[1]?.unitPriceCents, '1550');
  assert.deepEqual(cart.items[0]?.selectedOptions, redSmall);
  assert.deepEqual(cart.items[1]?.selectedOptions, blueMedium);

  const raw = serializeDemoCart(cart);
  assert.deepEqual(JSON.parse(raw), [
    {
      productId: product.id,
      quantity: 1,
      selectedOptions: [
        { name: 'Size', value: 'S' },
        { name: 'Color', value: 'Red' },
      ],
    },
    {
      productId: product.id,
      quantity: 2,
      selectedOptions: [
        { name: 'Size', value: 'M' },
        { name: 'Color', value: 'Blue' },
      ],
    },
  ]);
  assert.deepEqual(restoreDemoCart(store, [configurable], raw), cart);

  const removed = updateDemoCart(cart, configurable, 0, redSmall);
  assert.equal(removed.items.length, 1);
  assert.equal(removed.itemCount, 2);
  assert.deepEqual(removed.items[0]?.selectedOptions, blueMedium);
});

test('products with options reject an incomplete or stale choice', () => {
  const configurable: Product = {
    ...product,
    options: [
      {
        name: 'Size',
        values: [
          { label: 'S', priceCents: null },
          { label: 'M', priceCents: null },
        ],
      },
    ],
  };
  assert.throws(
    () => updateDemoCart(emptyCart(store), configurable, 1),
    CartRequestError,
  );
  assert.throws(
    () =>
      updateDemoCart(emptyCart(store), configurable, 1, [
        { name: 'Size', value: 'XL', priceCents: null },
      ]),
    CartRequestError,
  );
});

test('preview carts persist only quantities and product IDs in separate shop keys', () => {
  const cart = updateDemoCart(emptyCart(store), product, 2);
  const raw = serializeDemoCart(cart);
  assert.deepEqual(JSON.parse(raw), [{ productId: product.id, quantity: 2 }]);
  assert.deepEqual(restoreDemoCart(store, [product], raw), cart);
  const other = { ...store, id: 'store-b', slug: 'shop-b' };
  assert.notEqual(demoCartKey(store.slug), demoCartKey(other.slug));
  assert.equal(restoreDemoCart(other, [product], raw).itemCount, 0);
  assert.equal(restoreDemoCart(store, [], raw).itemCount, 0);
});

test('preview restore rejects malformed entries and uses current prices and stock', () => {
  for (const raw of [null, '', '{', '{}', 'null', '[null, 1, "x", {}]']) {
    assert.equal(restoreDemoCart(store, [product], raw).itemCount, 0);
  }
  const raw = JSON.stringify([
    { productId: product.id, quantity: 0 },
    { productId: product.id, quantity: '2' },
    { productId: product.id, quantity: -2 },
    { productId: product.id, quantity: 1.5 },
    { productId: 'other', quantity: 3 },
    {
      productId: product.id,
      quantity: 90,
      unitPriceCents: '1',
      lineTotalCents: '1',
    },
  ]);
  const restored = restoreDemoCart(
    store,
    [{ ...product, stockQuantity: 2 }],
    raw,
  );
  assert.equal(restored.itemCount, 2);
  assert.equal(restored.subtotalCents, '2500');
  assert.equal(
    restoreDemoCart(store, [{ ...product, stockQuantity: 0 }], raw).itemCount,
    0,
  );
});

test('checkout links are restricted to WhatsApp and preserve the order message', () => {
  const url = checkoutUrl(
    'https://wa.me/+96112345678?text=Tea%20%26%20cake%0A2%20items&ignored=value',
  );
  assert.ok(url);
  assert.equal(new URL(url).pathname, '/96112345678');
  assert.equal(new URL(url).searchParams.get('text'), 'Tea & cake\n2 items');
  assert.equal(new URL(url).searchParams.has('ignored'), false);
  for (const value of [
    'javascript:alert(1)',
    '//wa.me/96112345678?text=order',
    'http://wa.me/96112345678?text=order',
    'https://wa.me.evil.test/96112345678?text=order',
    'https://user:pass@wa.me/96112345678?text=order',
    'https://wa.me/invalid?text=order',
    'https://wa.me/96112345678',
    'https://wa.me/96112345678?text=',
  ])
    assert.equal(checkoutUrl(value), undefined);
});

test('live cart requests use cookie identity, encoded shop paths, and API DTOs', async (t) => {
  const requests: { url: string; options: RequestInit }[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string, options: RequestInit) => {
      requests.push({ url, options });
      return new Response(JSON.stringify(emptyCart(store)), { status: 200 });
    },
  );
  await cartApi.get('shop /a');
  await cartApi.add(store.slug, product.id);
  await cartApi.update(store.slug, 'item/a', 3);
  await cartApi.checkout(store.slug, {
    customerName: 'Sam',
    customerPhone: '',
    customerNotes: 'Pickup',
  });
  assert.equal(requests[0]?.url, '/api/v1/stores/shop%20%2Fa/cart');
  assert.equal(requests[0]?.options.method, 'GET');
  assert.equal(requests[0]?.options.body, undefined);
  assert.deepEqual(JSON.parse(String(requests[1]?.options.body)), {
    productId: product.id,
    quantity: 1,
  });
  assert.equal(requests[1]?.options.method, 'POST');
  assert.equal(requests[2]?.url, '/api/v1/stores/shop-a/cart/items/item%2Fa');
  assert.equal(requests[2]?.options.method, 'PATCH');
  assert.deepEqual(JSON.parse(String(requests[2]?.options.body)), {
    quantity: 3,
  });
  assert.equal(requests[3]?.url, '/api/v1/stores/shop-a/cart/checkout');
  assert.deepEqual(JSON.parse(String(requests[3]?.options.body)), {
    customerName: 'Sam',
    customerPhone: '',
    customerNotes: 'Pickup',
  });
  for (const request of requests) {
    assert.equal(request.options.credentials, 'same-origin');
    assert.ok(request.options.signal instanceof AbortSignal);
    assert.equal(
      new Headers(request.options.headers).get('Authorization'),
      null,
    );
  }
  assert.equal(
    new Headers(requests[1]?.options.headers).get('Content-Type'),
    'application/json',
  );
});

test('remove and clear accept empty 204 responses', async (t) => {
  const paths: string[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string, options: RequestInit) => {
      paths.push(url);
      assert.equal(options.method, 'DELETE');
      assert.equal(options.body, '{}');
      return new Response(null, { status: 204 });
    },
  );
  assert.equal(await cartApi.remove(store.slug, 'line/a'), undefined);
  assert.equal(await cartApi.clear(store.slug), undefined);
  assert.deepEqual(paths, [
    '/api/v1/stores/shop-a/cart/items/line%2Fa',
    '/api/v1/stores/shop-a/cart',
  ]);
});

test('failed writes are not retried and never expose raw response details', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return new Response('private-driver-details', { status: 503 });
  });
  await assert.rejects(
    cartApi.add(store.slug, product.id),
    (error: unknown) => {
      assert.ok(error instanceof CartRequestError);
      assert.equal(error.status, 503);
      assert.doesNotMatch(error.message, /private-driver-details/);
      assert.doesNotMatch(
        cartErrorMessage(error, 'update'),
        /private-driver-details/,
      );
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.match(
    cartErrorMessage(new CartRequestError(400), 'load'),
    /not accepting/,
  );
  assert.match(
    cartErrorMessage(new CartRequestError(409), 'update'),
    /quantity/,
  );
  assert.match(cartErrorMessage(new CartRequestError(429), 'update'), /wait/);
  assert.match(
    cartErrorMessage(new CartRequestError(400), 'checkout'),
    /Checkout is unavailable/,
  );
  assert.doesNotMatch(
    cartErrorMessage(new Error('private-driver-details'), 'load'),
    /private-driver-details/,
  );
});

test('cart reads honor the query cancellation signal', async (t) => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: string, options: RequestInit) => {
      assert.equal(options.signal?.aborted, true);
      throw new DOMException('Aborted', 'AbortError');
    },
  );
  await assert.rejects(cartApi.get(store.slug, controller.signal), {
    name: 'AbortError',
  });
});
