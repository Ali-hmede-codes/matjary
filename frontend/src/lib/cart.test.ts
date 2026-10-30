import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Product, Store } from './api';
import {
  CartRequestError,
  cartApi,
  cartErrorMessage,
  checkoutUrl,
  productCartLimit,
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
const emptyCart = {
  id: 'cart-a',
  storeId: store.id,
  storeSlug: store.slug,
  storeName: store.name,
  currency: 'USD',
  storeWhatsApp: null,
  items: [],
  subtotalCents: '0',
  itemCount: 0,
};

test('cart quantity limits honour stock, sell-out, and the global cap', () => {
  assert.equal(productCartLimit(), 99);
  assert.equal(productCartLimit({ ...product, stockQuantity: 0 }), 0);
  assert.equal(productCartLimit({ ...product, stockQuantity: 3 }), 3);
  assert.equal(productCartLimit({ ...product, stockQuantity: 200 }), 99);
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
      return new Response(JSON.stringify(emptyCart), { status: 200 });
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
