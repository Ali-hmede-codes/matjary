import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { validateDatabaseEnvironment } from '../../libs/config/src/environment';
import { createDatabaseOptions } from '../../libs/database/src/database.options';
import {
  User,
  Showcase,
  Store,
  Product,
  Cart,
  CartItem,
  MediaAsset,
  MediaVariant,
  SubscriptionPlan,
  UserSubscription,
} from '../../libs/database/src/entities';

const options = createDatabaseOptions(
  validateDatabaseEnvironment({ MYSQL_PASSWORD: 'test' }),
);

class MetadataDataSource extends DataSource {
  async inspect(): Promise<void> {
    await this.buildMetadatas();
  }
}

test('API and CLI database options prohibit automatic schema mutations', () => {
  assert.equal(options.type, 'mysql');
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  assert.equal(options.migrationsTransactionMode, 'none');
  assert.equal(options.migrationsTableName, 'schema_migrations');
  assert.equal(options.timezone, 'Z');
  assert.equal(options.bigNumberStrings, true);
  assert.equal(options.poolSize, 10);
  assert.equal(options.extra.queueLimit, 100);
});

test('entity metadata has private hashes, unique keys, and restrictive foreign keys', async () => {
  const source = new MetadataDataSource(options);
  await source.inspect();
  assert.equal(source.entityMetadatas.length, 17);
  const user = source.getMetadata(User);
  assert.equal(
    user.findColumnWithPropertyName('passwordHash')?.isSelect,
    false,
  );
  assert.ok(
    user.indices.some(
      (index) => index.name === 'uq_users_email' && index.isUnique,
    ),
  );
  assert.equal(
    user.findColumnWithPropertyName('passwordHash')?.isNullable,
    true,
  );
  assert.equal(
    user.findColumnWithPropertyName('googleSubject')?.isSelect,
    false,
  );
  assert.equal(
    user.findColumnWithPropertyName('googleSubject')?.collation,
    'utf8mb4_bin',
  );
  assert.ok(
    user.indices.some(
      (index) => index.name === 'uq_users_google_subject' && index.isUnique,
    ),
  );
  // Showcase has two FKs (owner + store), MediaAsset and MediaVariant have one each.
  // Product has one FK (store). Cart has one FK (store). CartItem has two FKs (cart, product).
  // All foreign keys must be RESTRICT (except CartItem.cart which is CASCADE).
  for (const target of [Showcase, MediaAsset, MediaVariant, Product, Cart]) {
    const metadata = source.getMetadata(target);
    assert.ok(metadata.foreignKeys.length >= 1);
    for (const fk of metadata.foreignKeys) {
      assert.equal(fk.onDelete, 'RESTRICT');
    }
  }
  // CartItem has CASCADE on cart FK, RESTRICT on product FK
  const cartItem = source.getMetadata(CartItem);
  assert.ok(cartItem.foreignKeys.length >= 2);
  for (const fk of cartItem.foreignKeys) {
    if (fk.referencedTablePath === 'carts') {
      assert.equal(fk.onDelete, 'CASCADE');
    } else {
      assert.equal(fk.onDelete, 'RESTRICT');
    }
  }
  for (const [target, key] of [
    [MediaAsset, 'originalKey'],
    [MediaVariant, 'storageKey'],
  ] as const) {
    const metadata = source.getMetadata(target);
    assert.equal(
      metadata.findColumnWithPropertyName(key)?.collation,
      'utf8mb4_bin',
    );
    assert.equal(
      metadata.findColumnWithPropertyName('sizeBytes')?.type,
      'bigint',
    );
  }
  // Product specific checks
  const product = source.getMetadata(Product);
  assert.ok(
    product.indices.some(
      (index) => index.name === 'uq_products_slug' && index.isUnique,
    ),
  );
  assert.equal(
    product.findColumnWithPropertyName('priceCents')?.type,
    'bigint',
  );
  // Cart specific checks
  const cart = source.getMetadata(Cart);
  assert.ok(
    cart.indices.some(
      (index) => index.name === 'idx_carts_store' && !index.isUnique,
    ),
  );
  assert.ok(
    cart.indices.some(
      (index) => index.name === 'idx_carts_status' && !index.isUnique,
    ),
  );
  // CartItem specific checks
  assert.ok(
    cartItem.indices.some(
      (index) => index.name === 'idx_cart_items_cart' && !index.isUnique,
    ),
  );
  assert.ok(
    cartItem.indices.some(
      (index) => index.name === 'idx_cart_items_product' && !index.isUnique,
    ),
  );
  assert.equal(
    cartItem.findColumnWithPropertyName('unitPriceCents')?.type,
    'bigint',
  );
  // SubscriptionPlan specific checks
  const subscriptionPlan = source.getMetadata(SubscriptionPlan);
  assert.ok(
    subscriptionPlan.indices.some(
      (index) => index.name === 'uq_subscription_plans_slug' && index.isUnique,
    ),
  );
  assert.ok(
    subscriptionPlan.indices.some(
      (index) =>
        index.name === 'idx_subscription_plans_active' && !index.isUnique,
    ),
  );
  assert.equal(
    subscriptionPlan.findColumnWithPropertyName('priceCents')?.type,
    'bigint',
  );

  // UserSubscription specific checks
  const userSubscription = source.getMetadata(UserSubscription);
  assert.ok(userSubscription.foreignKeys.length >= 2);
  for (const fk of userSubscription.foreignKeys) {
    assert.equal(fk.onDelete, 'RESTRICT');
  }
  assert.ok(
    userSubscription.indices.some(
      (index) =>
        index.name === 'idx_user_subscriptions_user' && !index.isUnique,
    ),
  );
  assert.ok(
    userSubscription.indices.some(
      (index) =>
        index.name === 'idx_user_subscriptions_plan' && !index.isUnique,
    ),
  );
  assert.ok(
    userSubscription.indices.some(
      (index) =>
        index.name === 'idx_user_subscriptions_status' && !index.isUnique,
    ),
  );
  assert.ok(
    userSubscription.indices.some(
      (index) =>
        index.name === 'idx_user_subscriptions_expires' && !index.isUnique,
    ),
  );
});
