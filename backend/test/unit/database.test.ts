import 'reflect-metadata';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { DataSource, type QueryRunner, type Repository } from 'typeorm';
import { StoresService } from '../../apps/api/src/modules/stores/stores.service';
import { validateDatabaseEnvironment } from '../../libs/config/src/environment';
import { createDatabaseOptions } from '../../libs/database/src/database.options';
import { AddStoreLocation1793318400000 } from '../../libs/database/src/migrations/1793318400000-AddStoreLocation';
import { FreeTrialSubscriptions1794004800000 } from '../../libs/database/src/migrations/1794004800000-FreeTrialSubscriptions';
import { UnlimitedPlanStorage1794091200000 } from '../../libs/database/src/migrations/1794091200000-UnlimitedPlanStorage';
import { MaxPostsOnly1794177600000 } from '../../libs/database/src/migrations/1794177600000-MaxPostsOnly';
import { FreeTrialThreeDays1795646400000 } from '../../libs/database/src/migrations/1795646400000-FreeTrialThreeDays';
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
  PostEngagement,
  BoostTransaction,
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

test('store listing count queries map storeId to the MySQL column', async () => {
  const source = new MetadataDataSource(options);
  await source.inspect();
  const postQuery = source.manager.createQueryBuilder();
  const productQuery = source
    .getRepository(Product)
    .createQueryBuilder('product');
  for (const query of [postQuery, productQuery]) {
    Object.assign(query, {
      getRawMany: async () => [{ storeId: 'store-1', count: '2' }],
    });
  }
  const service = new StoresService(
    {
      findAndCount: async () => [[{ id: 'store-1' }], 1],
      manager: { createQueryBuilder: () => postQuery },
    } as unknown as Repository<Store>,
    {
      createQueryBuilder: () => productQuery,
    } as unknown as Repository<Product>,
    source.getRepository(SubscriptionPlan),
    null!,
    null!,
    null!,
    null!,
  );

  const result = await service.findAll(undefined, 7, 0);
  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.postsCount, 2);
  assert.equal(result.items[0]?.productsCount, 2);
  for (const query of [postQuery, productQuery]) {
    const [sql, parameters] = query.getQueryAndParameters();
    assert.match(sql, /SELECT `\w+`\.`store_id` AS `storeId`/);
    assert.match(sql, /WHERE `\w+`\.`store_id` IN \(\?/);
    assert.match(sql, /GROUP BY `\w+`\.`store_id`/);
    assert.match(sql, /admin_archived_at IS NULL/);
    assert.match(sql, /suspended_at IS NULL/);
    // Out of stock items still count on the public shop listing.
    assert.deepEqual(
      parameters,
      query === postQuery
        ? ['store-1', 'published']
        : ['store-1', 'active', 'out_of_stock'],
    );
  }
});

test('store location migration creates and drops indexes using single statements', async () => {
  const queries: string[] = [];
  const runner = {
    async query(sql: string) {
      const statement = sql.trim().replace(/;$/, '').replace(/\s+/g, ' ');
      assert.doesNotMatch(statement, /;\s*\S/, 'One SQL statement per query');
      queries.push(statement);
    },
  } as unknown as QueryRunner;
  const migration = new AddStoreLocation1793318400000();

  await migration.up(runner);
  assert.equal(queries.length, 4);
  assert.match(queries[0] ?? '', /^ALTER TABLE `stores` ADD COLUMN `latitude`/);
  assert.deepEqual(queries.slice(1), [
    'CREATE INDEX `idx_stores_location` ON `stores` (`latitude`, `longitude`)',
    'CREATE INDEX `idx_stores_city` ON `stores` (`city`)',
    'CREATE INDEX `idx_stores_country` ON `stores` (`country`)',
  ]);

  queries.length = 0;
  await migration.down(runner);
  assert.equal(queries.length, 4);
  assert.deepEqual(queries.slice(0, 3), [
    'DROP INDEX `idx_stores_country` ON `stores`',
    'DROP INDEX `idx_stores_city` ON `stores`',
    'DROP INDEX `idx_stores_location` ON `stores`',
  ]);
  assert.match(
    queries[3] ?? '',
    /^ALTER TABLE `stores` DROP COLUMN `opening_hours`/,
  );
});

test('free trial migration backfills bounded trials and is reversible', async () => {
  const queries: string[] = [];
  const runner = {
    async query(sql: string) {
      const statement = sql.trim().replace(/;$/, '').replace(/\s+/g, ' ');
      assert.doesNotMatch(statement, /;\s*\S/, 'One SQL statement per query');
      queries.push(statement);
    },
  } as unknown as QueryRunner;
  const migration = new FreeTrialSubscriptions1794004800000();

  await migration.up(runner);
  assert.equal(queries.length, 3);
  assert.match(queries[0] ?? '', /INTERVAL 3 DAY/);
  assert.match(queries[0] ?? '', /free-trial-rollout/);
  assert.match(queries[1] ?? '', /^INSERT INTO `user_subscriptions`/);
  assert.match(queries[1] ?? '', /NOT EXISTS/);
  assert.match(queries[2] ?? '', /3-day free trial with basic features/);

  queries.length = 0;
  await migration.down(runner);
  assert.equal(queries.length, 3);
  assert.match(
    queries[0] ?? '',
    /^DELETE FROM `user_subscriptions` WHERE `notes` = 'Free trial \(rollout\)'/,
  );
  assert.match(queries[1] ?? '', /free-trial-rollout/);
  assert.match(queries[2] ?? '', /Free tier with basic features/);
});

test('three-day trial migration aligns the stored free-plan description', async () => {
  const queries: string[] = [];
  const runner = {
    async query(sql: string) {
      const statement = sql.trim().replace(/;$/, '').replace(/\s+/g, ' ');
      assert.doesNotMatch(statement, /;\s*\S/, 'One SQL statement per query');
      queries.push(statement);
    },
  } as unknown as QueryRunner;
  const migration = new FreeTrialThreeDays1795646400000();

  await migration.up(runner);
  assert.equal(queries.length, 1);
  assert.match(queries[0] ?? '', /^UPDATE `subscription_plans`/);
  assert.match(queries[0] ?? '', /3-day free trial with basic features/);
  assert.match(queries[0] ?? '', /7-day free trial with basic features/);

  queries.length = 0;
  await migration.down(runner);
  assert.equal(queries.length, 1);
  assert.match(queries[0] ?? '', /^UPDATE `subscription_plans`/);
  assert.match(queries[0] ?? '', /7-day free trial with basic features/);
});

test('unlimited plan storage migration normalizes plans and restores seeded quotas', async () => {
  const queries: string[] = [];
  const runner = {
    async query(sql: string) {
      const statement = sql.trim().replace(/;$/, '').replace(/\s+/g, ' ');
      assert.doesNotMatch(statement, /;\s*\S/, 'One SQL statement per query');
      queries.push(statement);
    },
  } as unknown as QueryRunner;
  const migration = new UnlimitedPlanStorage1794091200000();

  await migration.up(runner);
  assert.equal(queries.length, 1);
  assert.match(queries[0] ?? '', /^UPDATE `subscription_plans`/);
  assert.match(queries[0] ?? '', /JSON_SET/);
  assert.match(queries[0] ?? '', /maxStorageBytes/);

  queries.length = 0;
  await migration.down(runner);
  assert.equal(queries.length, 1);
  assert.match(queries[0] ?? '', /free.*basic.*premium/s);
  assert.match(queries[0] ?? '', /1073741824/);
});

test('max-posts-only migration clears monthly quotas and restores seeded values', async () => {
  const queries: string[] = [];
  const runner = {
    async query(sql: string) {
      const statement = sql.trim().replace(/;$/, '').replace(/\s+/g, ' ');
      assert.doesNotMatch(statement, /;\s*\S/, 'One SQL statement per query');
      queries.push(statement);
    },
  } as unknown as QueryRunner;
  const migration = new MaxPostsOnly1794177600000();

  await migration.up(runner);
  assert.equal(queries.length, 1);
  assert.match(queries[0] ?? '', /^UPDATE `subscription_plans`/);
  assert.match(queries[0] ?? '', /JSON_SET/);
  assert.match(queries[0] ?? '', /maxPostsPerMonth/);

  queries.length = 0;
  await migration.down(runner);
  assert.equal(queries.length, 1);
  assert.match(queries[0] ?? '', /free.*basic.*premium/s);
  assert.match(queries[0] ?? '', /WHEN 'free' THEN 5/);
});

test('database-only user service imports do not initialize application configuration', () => {
  // Use a fresh process without the unit preload's Redis credentials or module cache.
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test' };
  delete env.REDIS_PASSWORD;
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      '--unhandled-rejections=strict',
      '-r',
      'ts-node/register',
      '-r',
      'tsconfig-paths/register',
      '-e',
      `
        require('reflect-metadata');
        const assert = require('node:assert/strict');
        const { UsersService } = require('./apps/api/src/modules/users/users.service');
        assert.equal(typeof UsersService, 'function');
        assert.equal(
          Boolean(require.cache[require.resolve('./libs/config/src/configuration.module')]),
          false,
          'Database-only imports must not load .env or require Redis configuration',
        );
      `,
    ],
    { env, encoding: 'utf8', timeout: 30000, windowsHide: true },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
});

test('entity metadata has private hashes, unique keys, and restrictive foreign keys', async () => {
  const source = new MetadataDataSource(options);
  await source.inspect();
  assert.equal(
    source.entityMetadatas.length,
    (options.entities as unknown[]).length,
  );
  assert.equal(
    source.migrations.length,
    (options.migrations as unknown[]).length,
  );
  assert.ok(source.hasMetadata('MediaProcessingOutbox'));
  assert.ok(source.hasMetadata('EngagementFlushReceipt'));
  assert.ok(source.hasMetadata('SeoRedirect'));
  const engagement = source.getMetadata(PostEngagement);
  assert.deepEqual(
    engagement.primaryColumns.map((column) => column.databaseName),
    ['post_id'],
  );
  assert.equal(engagement.findColumnWithPropertyName('id'), undefined);
  assert.equal(engagement.findColumnWithPropertyName('createdAt'), undefined);
  assert.ok(engagement.findColumnWithPropertyName('updatedAt')?.isUpdateDate);
  assert.ok(
    source
      .getMetadata(BoostTransaction)
      .indices.some((index) => index.name === 'operation_id' && index.isUnique),
  );
  for (const metadata of source.entityMetadatas) {
    if (!metadata.tableName.startsWith('boost_')) continue;
    for (const foreignKey of metadata.foreignKeys) {
      assert.equal(foreignKey.onUpdate, 'RESTRICT', foreignKey.name);
    }
  }
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
  // A new entity must preserve restrictive deletion behavior too.
  for (const metadata of source.entityMetadatas) {
    for (const fk of metadata.foreignKeys) {
      assert.equal(fk.onDelete, 'RESTRICT', `${metadata.name}.${fk.name}`);
    }
  }
  const cartItem = source.getMetadata(CartItem);
  assert.ok(cartItem.foreignKeys.length >= 2);
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
  // The optional old price is the same signed-integer width as the price it
  // replaces, and stays nullable so every existing product needs no backfill.
  const compareAt = product.findColumnWithPropertyName('compareAtPriceCents');
  assert.equal(compareAt?.type, 'bigint');
  assert.equal(compareAt?.isNullable, true);
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
