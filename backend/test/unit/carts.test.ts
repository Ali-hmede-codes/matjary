import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Cart,
  CartItem,
  CartStatus,
  Product,
  Store,
} from '../../libs/database/src/entities';
import { CartsService } from '../../apps/api/src/modules/carts/carts.service';

const DAY_MS = 24 * 60 * 60 * 1000;

// A live paid plan keeps the cart entitlement checks (which every route runs)
// happy without touching subscription storage behaviour under test.
const activeSubscription = () => ({
  startsAt: new Date(Date.now() - DAY_MS),
  expiresAt: new Date(Date.now() + 30 * DAY_MS),
  plan: {
    slug: 'starter',
    limits: { enableCart: true, enableWhatsAppCheckout: true },
  },
});

function cartFixture(
  options: {
    cart?: Partial<Cart> | null;
    items?: CartItem[];
    products?: Product[];
  } = {},
) {
  const store = Object.assign(new Store(), {
    id: 'store-1',
    slug: 'shop',
    name: 'Shop',
    ownerId: 'owner-1',
    enableCart: true,
    enableWhatsAppCheckout: true,
    showPricesInLbp: false,
    socialMediaLinks: { whatsapp: '9611234567' },
  });
  const products = options.products ?? [];
  const items = [...(options.items ?? [])];
  // The fake keeps the created row so post-mutation reads behave like SQL.
  let stored: Cart | null =
    options.cart === undefined || options.cart === null
      ? null
      : Object.assign(new Cart(), options.cart);
  const calls = {
    cartCreate: 0,
    cartSave: 0,
    cartUpdate: 0,
    itemSave: 0,
    productFind: 0,
    productFindOne: 0,
  };
  const carts = {
    findOne: async () => stored,
    create: (value: Partial<Cart>) => {
      calls.cartCreate++;
      return Object.assign(new Cart(), value);
    },
    save: async (cart: Cart) => {
      calls.cartSave++;
      stored = Object.assign(cart, { id: cart.id || 'cart-new' });
      return stored;
    },
    update: async () => {
      calls.cartUpdate++;
    },
  };
  const productRepo = {
    findOneBy: async () => {
      calls.productFindOne++;
      return products[0] ?? null;
    },
    find: async () => {
      calls.productFind++;
      return products;
    },
  };
  const cartItems = {
    find: async () => items,
    findOneBy: async () => null,
    create: (value: Partial<CartItem>) => Object.assign(new CartItem(), value),
    save: async (item: CartItem) => {
      calls.itemSave++;
      if (!items.includes(item)) items.push(item);
      return item;
    },
    remove: async () => undefined,
    delete: async () => undefined,
  };
  const stores = {
    findOneBy: async () => store,
    manager: {
      getRepository: () => ({ find: async () => [activeSubscription()] }),
    },
  };
  const service = new CartsService(
    stores as never,
    productRepo as never,
    carts as never,
    cartItems as never,
    { findOne: async () => null, findOneBy: async () => null } as never,
    { findOneBy: async () => null } as never,
  );
  return { service, calls, store, products, items };
}

function product(overrides: Partial<Product> = {}): Product {
  return Object.assign(new Product(), {
    id: 'product-1',
    storeId: 'store-1',
    slug: 'item',
    name: 'Item',
    status: 'active',
    priceCents: '500',
    currency: 'USD',
    stockQuantity: null,
    options: null,
    imageKeys: [],
    ...overrides,
  });
}

function activeCart(overrides: Partial<Cart> = {}): Partial<Cart> {
  return {
    id: 'cart-1',
    storeId: 'store-1',
    currency: 'USD',
    status: CartStatus.ACTIVE,
    expiresAt: new Date(Date.now() + DAY_MS),
    ...overrides,
  };
}

function line(overrides: Partial<CartItem> = {}): CartItem {
  return Object.assign(new CartItem(), {
    id: 'line-1',
    cartId: 'cart-1',
    productId: 'product-1',
    quantity: 1,
    unitPriceCents: '500',
    productName: 'Item',
    productSlug: 'item',
    ...overrides,
  });
}

test('reading a shop with no cart answers an empty cart without a write', async () => {
  const { service, calls } = cartFixture();
  const cart = await service.getCart('shop', undefined, 'visitor-a');
  assert.equal(cart.id, '');
  assert.equal(cart.storeSlug, 'shop');
  assert.equal(cart.storeName, 'Shop');
  assert.equal(cart.itemCount, 0);
  assert.deepEqual(cart.items, []);
  assert.equal(cart.subtotalCents, '0');
  // Browsing must not create a row or refresh an expiry that does not exist.
  assert.equal(calls.cartCreate, 0);
  assert.equal(calls.cartSave, 0);
  assert.equal(calls.cartUpdate, 0);
});

test('an existing cart is served and kept alive by a single update', async () => {
  const items = [line({ quantity: 2 })];
  const { service, calls } = cartFixture({
    cart: activeCart(),
    items,
    products: [product()],
  });
  const cart = await service.getCart('shop', undefined, 'visitor-a');
  assert.equal(cart.id, 'cart-1');
  assert.equal(cart.itemCount, 2);
  assert.equal(cart.subtotalCents, '1000');
  // The seven-day-on-access policy is unchanged: exactly one expiry write.
  assert.equal(calls.cartUpdate, 1);
  assert.equal(calls.cartCreate, 0);
});

test('an expired cart reads as empty instead of being recreated on GET', async () => {
  const { service, calls } = cartFixture({
    cart: activeCart({ expiresAt: new Date(Date.now() - DAY_MS) }),
    items: [line()],
  });
  const cart = await service.getCart('shop', undefined, 'visitor-a');
  assert.equal(cart.id, '');
  assert.deepEqual(cart.items, []);
  assert.equal(calls.cartCreate, 0);
  assert.equal(calls.cartUpdate, 0);
});

test('the first add creates one cart without a redundant expiry update', async () => {
  const { service, calls } = cartFixture({ products: [product()] });
  const cart = await service.addItem(
    'shop',
    { productId: 'product-1', quantity: 1 } as never,
    undefined,
    'visitor-a',
  );
  assert.equal(cart.id, 'cart-new');
  assert.equal(cart.itemCount, 1);
  assert.equal(calls.cartCreate, 1);
  assert.equal(calls.cartSave, 1);
  assert.equal(calls.itemSave, 1);
  // Creation writes its expiry once; only the trailing read extends it.
  assert.equal(calls.cartUpdate, 1);
});

test('checkout reads each distinct product once across option lines', async () => {
  const items = [
    line({ id: 'line-1', quantity: 2 }),
    line({ id: 'line-2', quantity: 2 }),
  ];
  const { service, calls } = cartFixture({
    cart: activeCart(),
    items,
    products: [product({ stockQuantity: 5 })],
  });
  const result = await service.checkout(
    'shop',
    {
      customerName: 'Sara',
      customerPhone: '9611234567',
      customerNotes: '',
    } as never,
    undefined,
    'visitor-a',
  );
  assert.equal(result.totalCents, '2000');
  assert.equal(result.currency, 'USD');
  assert.match(result.whatsappUrl, /^https:\/\/wa\.me\/9611234567\?text=/u);
  // One read for the product behind both option lines.
  assert.equal(calls.productFind, 1);
  assert.equal(calls.productFindOne, 0);
  // Only the checked-out status write; checkout never extends expiry.
  assert.equal(calls.cartUpdate, 1);
});

test('shared stock is still summed across option combinations', async () => {
  const items = [
    line({ id: 'line-1', quantity: 2 }),
    line({ id: 'line-2', quantity: 2 }),
  ];
  const { service, calls } = cartFixture({
    cart: activeCart(),
    items,
    products: [product({ stockQuantity: 3 })],
  });
  await assert.rejects(
    service.checkout(
      'shop',
      { customerName: 'Sara', customerPhone: '9611234567' } as never,
      undefined,
      'visitor-a',
    ),
    /Only 3 of "Item" available/u,
  );
  assert.equal(calls.productFind, 1);
});

test('checkout with no cart is empty without persisting one', async () => {
  const { service, calls } = cartFixture();
  await assert.rejects(
    service.checkout('shop', {} as never, undefined, 'visitor-a'),
    /Cart is empty/u,
  );
  assert.equal(calls.cartCreate, 0);
  assert.equal(calls.cartSave, 0);
  assert.equal(calls.productFind, 0);
});
