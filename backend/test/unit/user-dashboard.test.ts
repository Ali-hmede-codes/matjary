import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UserDashboardService } from '../../apps/api/src/modules/user-dashboard/user-dashboard.service';
import {
  chooseContentSlug,
  Product,
  ProductStatus,
  Showcase,
  ShowcaseStatus,
  Store,
  StoreStatus,
  User,
  UserSubscription,
  lockOwnerContent,
  publicVisibilitySql,
  ownerVisibilitySql,
} from '@app/database';
import { StoresService } from '../../apps/api/src/modules/stores/stores.service';
import { StoreLifecycle1793918400000 } from '../../libs/database/src/migrations/1793918400000-StoreLifecycle';
import { ArabicSlugRepair1795819200000 } from '../../libs/database/src/migrations/1795819200000-ArabicSlugRepair';
import {
  ForbiddenException,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  getMetadataArgsStorage,
  type EntityManager,
  type QueryRunner,
} from 'typeorm';

function lifecycleFixture() {
  const store = Object.assign(new Store(), {
    id: 'store-1',
    slug: 'my-store',
    name: 'My store',
    ownerId: 'owner',
    logoKey: 'kept-logo',
    hasVerificationBadge: true,
    postsCountThisMonth: 7,
  });
  const writes: unknown[][] = [];
  const control = { beforeTransaction: () => {} };
  const builder = {
    select() {
      return this;
    },
    addSelect() {
      return this;
    },
    from() {
      return this;
    },
    where() {
      return this;
    },
    andWhere() {
      return this;
    },
    groupBy() {
      return this;
    },
    async getRawMany() {
      return [];
    },
  };
  const manager = {
    async transaction<T>(work: (m: EntityManager) => Promise<T>) {
      control.beforeTransaction();
      return work(manager as unknown as EntityManager);
    },
    async findOne(
      target: unknown,
      options: {
        where: {
          id?: string;
          slug?: string;
          ownerId?: string;
          adminArchivedAt?: unknown;
        };
        lock: { mode: string };
      },
    ) {
      assert.equal(options.lock.mode, 'pessimistic_write');
      if (target === User)
        return Object.assign(new User(), { id: options.where.id });
      if (
        target !== Store ||
        options.where.ownerId !== store.ownerId ||
        (options.where.slug && options.where.slug !== store.slug)
      )
        return null;
      if (
        options.where.adminArchivedAt &&
        (store.status === StoreStatus.TRASHED || store.adminArchivedAt)
      )
        return null;
      return Object.assign(new Store(), store);
    },
    async find() {
      // The owner has no team memberships in this fixture.
      return [];
    },
    async query(sql: string, values: unknown[]) {
      assert.match(sql, /^UPDATE stores SET status = \?/);
      assert.doesNotMatch(
        sql,
        /admin_archived_at|DELETE|products|showcases|media_assets/,
      );
      assert.deepEqual(values.slice(2), [store.id, store.ownerId]);
      writes.push(values);
      store.status = values[0] as StoreStatus;
      store.trashedAt = values[1] as Date | null;
      return [];
    },
    async save(value: Store) {
      Object.assign(store, value);
      return value;
    },
    async count() {
      return 0;
    },
    getRepository(target: unknown) {
      if (target === UserSubscription)
        return {
          find: async () => [
            {
              startsAt: new Date(0),
              expiresAt: new Date('2999-01-01T00:00:00Z'),
              plan: { slug: 'free', limits: {} },
            },
          ],
        };
      return { findOneBy: async () => null };
    },
    createQueryBuilder: () => builder,
  };
  const repository = {
    manager,
    async findOneBy() {
      return Object.assign(new Store(), store);
    },
    async findBy(where: { ownerId: string; status?: { value: StoreStatus } }) {
      return where.ownerId === store.ownerId &&
        (!where.status || where.status.value !== store.status)
        ? [store]
        : [];
    },
    async find(options: {
      where: { ownerId: string; status?: { value: StoreStatus } };
    }) {
      return this.findBy(options.where);
    },
  };
  const service = new StoresService(
    repository as never,
    { count: async () => 0, createQueryBuilder: () => builder } as never,
    {} as never,
    {} as never,
    {
      autoGenerateOwnedSeo: async () => {},
      notifyIndexNowOnChange: async () => {},
    } as never,
    {} as never,
    { deleteObject: async () => {} } as never,
  );
  return { store, writes, service, manager, control };
}

function purgeFixture(status = StoreStatus.TRASHED) {
  const store = Object.assign(new Store(), {
    id: 'store-1',
    slug: 'my-store',
    name: 'My store',
    ownerId: 'owner',
    status,
  });
  const statements: { sql: string; values: unknown[] }[] = [];
  const storage = {
    deleted: [] as string[],
    async deleteObject(key: string) {
      storage.deleted.push(key);
    },
  };
  const manager = {
    async transaction<T>(work: (m: EntityManager) => Promise<T>) {
      return work(manager as unknown as EntityManager);
    },
    async findOne(
      target: unknown,
      options: {
        where: { id?: string; slug?: string; ownerId?: string };
        lock: { mode: string };
      },
    ) {
      assert.equal(options.lock.mode, 'pessimistic_write');
      if (target === User)
        return Object.assign(new User(), { id: options.where.id });
      if (target === Store) {
        if (
          options.where.ownerId !== store.ownerId ||
          options.where.slug !== store.slug
        )
          return null;
        return Object.assign(new Store(), store);
      }
      return null;
    },
    async query(sql: string, values: unknown[]) {
      statements.push({ sql, values });
      if (sql.startsWith('SELECT original_key'))
        return [{ storageKey: 'originals/store-1/asset-1/source' }];
      if (sql.startsWith('SELECT variant.storage_key'))
        return [{ storageKey: 'media/store-1/asset-1/webp-480.webp' }];
      return [];
    },
  };
  const service = new StoresService(
    { manager } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    storage as never,
  );
  return { store, statements, storage, service, manager };
}

test('store lifecycle retains content and restores offline without republishing', async () => {
  const f = lifecycleFixture();
  await f.service.setStatus('my-store', StoreStatus.OFFLINE, 'owner');
  await f.service.setStatus('my-store', StoreStatus.ARCHIVED, 'owner');
  assert.equal(
    (await f.service.restore('my-store', 'owner')).status,
    StoreStatus.OFFLINE,
  );
  await f.service.setStatus('my-store', StoreStatus.ACTIVE, 'owner');
  const count = f.writes.length;
  await f.service.restore('my-store', 'owner');
  assert.equal(f.writes.length, count);
  assert.equal(f.store.status, StoreStatus.ACTIVE);
  await f.service.remove('my-store', 'owner');
  const trashedAt = f.store.trashedAt;
  await f.service.remove('my-store', 'owner');
  assert.equal(f.writes.length, count + 1);
  assert.equal(f.store.trashedAt, trashedAt);
  assert.deepEqual(await f.service.getUserStores('owner'), []);
  assert.equal(
    (await f.service.getUserStores('owner', true))[0]?.status,
    StoreStatus.TRASHED,
  );
  assert.deepEqual(await f.service.getUserStores('other', true), []);
  await assert.rejects(
    f.service.setStatus('my-store', StoreStatus.ACTIVE, 'owner'),
    ConflictException,
  );
  await f.service.restore('my-store', 'owner');
  assert.equal(f.store.status, StoreStatus.OFFLINE);
  assert.equal(f.store.trashedAt, null);
  assert.equal(f.store.logoKey, 'kept-logo');
  assert.equal(f.store.hasVerificationBadge, true);
  assert.equal(f.store.postsCountThisMonth, 7);
});

test('store lifecycle enforces ownership, independent moderation and sanitized failures', async () => {
  const f = lifecycleFixture();
  await assert.rejects(
    f.service.remove('my-store', 'other'),
    NotFoundException,
  );
  await assert.rejects(
    f.service.setStatus('my-store', StoreStatus.TRASHED, 'owner'),
    BadRequestException,
  );
  f.store.status = StoreStatus.OFFLINE;
  const restriction = new Date();
  f.store.adminArchivedAt = restriction;
  await assert.rejects(
    f.service.setStatus('my-store', StoreStatus.ACTIVE, 'owner'),
    ForbiddenException,
  );
  await f.service.remove('my-store', 'owner');
  const restored = await f.service.restore('my-store', 'owner');
  assert.equal(restored.restricted, true);
  assert.equal(f.store.adminArchivedAt, restriction);
  f.manager.query = async () => {
    throw new Error('private database details');
  };
  await assert.rejects(
    f.service.remove('my-store', 'owner'),
    (error: unknown) =>
      error instanceof ServiceUnavailableException &&
      !error.message.includes('private database details'),
  );
});

test('owner store edits recheck Trash under the account lock after async validation', async () => {
  const f = lifecycleFixture();
  f.store.status = StoreStatus.OFFLINE;
  await f.service.update('my-store', { name: 'Edited while off' }, 'owner');
  assert.equal(f.store.name, 'Edited while off');
  f.control.beforeTransaction = () => {
    f.store.status = StoreStatus.TRASHED;
  };
  await assert.rejects(
    f.service.update('my-store', { name: 'Stale edit' }, 'owner'),
    NotFoundException,
  );
  assert.equal(f.store.name, 'Edited while off');
  await assert.rejects(
    lockOwnerContent(
      f.manager as unknown as EntityManager,
      'store',
      f.store.id,
      'owner',
    ),
    NotFoundException,
  );
});

test('permanent store deletion is only available from Trash and removes children first', async () => {
  const active = purgeFixture(StoreStatus.ACTIVE);
  await assert.rejects(
    active.service.purge('my-store', 'owner'),
    ConflictException,
  );
  assert.ok(!active.statements.some(({ sql }) => sql.startsWith('DELETE')));
  assert.deepEqual(active.storage.deleted, []);

  const f = purgeFixture();
  await f.service.purge('my-store', 'owner');
  const statements = f.statements.map(({ sql }) => sql);
  for (const table of [
    'media_processing_outbox',
    'media_variants',
    'media_assets',
    'engagement_flush_receipts',
    'post_engagement',
    'post_likes',
    'showcase_seo',
    'product_seo',
    'store_seo',
    'seo_redirects',
    'cart_items',
    'carts',
    'boost_campaign_performance',
    'boost_campaigns',
    'products',
    'showcases',
    'store_categories',
  ])
    assert.ok(
      statements.some((sql) => sql.startsWith(`DELETE FROM ${table} `)),
      table,
    );
  assert.equal(statements.at(-1), 'DELETE FROM stores WHERE id = ?');
  for (const statement of f.statements)
    assert.ok(statement.values.includes('store-1'));
  assert.deepEqual(f.storage.deleted.sort(), [
    'media/store-1/asset-1/webp-480.webp',
    'originals/store-1/asset-1/source',
  ]);
});

test('permanent store deletion is owner-scoped, sanitized, and tolerates storage failures', async () => {
  const f = purgeFixture();
  await assert.rejects(f.service.purge('my-store', 'other'), NotFoundException);
  f.storage.deleteObject = async () => {
    throw new Error('storage unavailable');
  };
  await f.service.purge('my-store', 'owner');
  assert.equal(f.storage.deleted.length, 0);
  f.manager.query = async () => {
    throw new Error('private database details');
  };
  await assert.rejects(
    f.service.purge('my-store', 'owner'),
    (error: unknown) =>
      error instanceof ServiceUnavailableException &&
      !error.message.includes('private database details'),
  );
});

test('visibility policies distinguish public active stores from editable retained stores', () => {
  for (const kind of ['store', 'product', 'post', 'media'] as const) {
    const publicSql = publicVisibilitySql(kind, 'item');
    const ownerSql = ownerVisibilitySql(kind, 'item');
    assert.match(publicSql, /\.status = 'active'/);
    assert.match(ownerSql, /\.status != 'trashed'/);
    assert.doesNotMatch(ownerSql, /\.status = 'active'/);
    for (const sql of [publicSql, ownerSql]) {
      assert.match(sql, /admin_archived_at IS NULL/);
      assert.match(sql, /suspended_at IS NULL/);
    }
  }
  assert.throws(() => publicVisibilitySql('store', 'unsafe;alias'));
});

test('lifecycle migration defaults existing stores online and refuses unsafe rollback', async () => {
  const columns = getMetadataArgsStorage().columns.filter(
    (column) => column.target === Store,
  );
  for (const name of ['status', 'trashedAt', 'adminArchivedAt'])
    assert.equal(
      columns.find((column) => column.propertyName === name)?.options.update,
      false,
    );
  const statements: string[] = [];
  let hidden = 0;
  const runner = {
    query: async (sql: string) => {
      statements.push(sql);
      return [{ count: hidden }];
    },
  } as unknown as QueryRunner;
  const migration = new StoreLifecycle1793918400000();
  await migration.up(runner);
  assert.match(statements[0]!, /DEFAULT 'active'/);
  assert.match(statements[0]!, /idx_stores_owner_status/);
  hidden = 1;
  await assert.rejects(migration.down(runner), /Resolve hidden store states/);
  assert.doesNotMatch(statements.at(-1)!, /DROP/);
  hidden = 0;
  await migration.down(runner);
  assert.match(statements.at(-1)!, /DROP COLUMN status/);
});

test('generated addresses transliterate Arabic and retry collisions', async () => {
  let attempts = 0;
  const slug = await chooseContentSlug(
    'حلويات الداعوق',
    undefined,
    async () => ++attempts < 2,
  );
  // Arabic names become latin addresses instead of collapsing into the generic
  // "shop" fallback that every Arabic-named merchant would share.
  assert.equal(slug, 'hlwyat-aldaawq-2');
  assert.equal(attempts, 2);
  assert.equal(
    await chooseContentSlug('مطعم ٢٠٢٤', undefined, async () => false),
    'mtam-2024',
  );
  assert.equal(
    await chooseContentSlug('Al Daaouk حلويات', undefined, async () => false),
    'al-daaouk-hlwyat',
  );
  // Harakat and tatweel are decorative and must not split the word.
  assert.equal(
    await chooseContentSlug('حَـــلْوِيَات', undefined, async () => false),
    'hlwyat',
  );
  // Names without latin or Arabic letters keep the generic fallback.
  assert.equal(
    await chooseContentSlug('東京', undefined, async () => false),
    'shop',
  );
  const seen: string[] = [];
  assert.equal(
    await chooseContentSlug('Handmade Mug', undefined, async (value) => {
      seen.push(value);
      return value === 'handmade-mug';
    }),
    'handmade-mug-2',
  );
  assert.deepEqual(seen, ['handmade-mug', 'handmade-mug-2']);
  assert.equal(
    await chooseContentSlug('New name', 'existing-address', async () => true),
    'existing-address',
  );
});

test('slug repair migration renames only legacy generic Arabic addresses', async () => {
  const rows = {
    stores: [
      { id: 'store-1', label: 'حلويات الداعوق', slug: 'shop' },
      { id: 'store-2', label: 'حلويات الداعوق', slug: 'shop-2' },
      { id: 'store-3', label: 'هلا', slug: 'hala' },
      { id: 'store-4', label: 'Coffee', slug: 'coffee' },
    ],
    products: [{ id: 'product-1', label: 'كعكة', slug: 'shop' }],
    showcases: [{ id: 'post-1', label: 'عرض', slug: 'shop-3' }],
  };
  const updates: { table: string; slug: unknown; id: unknown }[] = [];
  const runner = {
    query: async (sql: string, params?: unknown[]) => {
      if (params) {
        const table = /UPDATE `(\w+)`/.exec(sql)?.[1] ?? '';
        updates.push({ table, slug: params[0], id: params[1] });
        return [];
      }
      const table = /FROM `(\w+)`/.exec(sql)?.[1] ?? '';
      return rows[table as keyof typeof rows] ?? [];
    },
  } as unknown as QueryRunner;

  await new ArabicSlugRepair1795819200000().up(runner);

  assert.deepEqual(updates, [
    { table: 'stores', slug: 'hlwyat-aldaawq', id: 'store-1' },
    { table: 'stores', slug: 'hlwyat-aldaawq-2', id: 'store-2' },
    { table: 'products', slug: 'kaka', id: 'product-1' },
    { table: 'showcases', slug: 'ard', id: 'post-1' },
  ]);
});

test('dashboard summary and lists scope every query to the owner and exclude moderated content', async () => {
  const ownerId = 'owner-1';
  const queries: { owner?: string; visibility?: string }[] = [];
  function repository(kind: 'post' | 'product') {
    return {
      count: async ({
        where,
      }: {
        where: {
          ownerId?: string;
          store?: { ownerId: string };
          adminArchivedAt?: unknown;
        };
      }) => {
        assert.equal(
          kind === 'post' ? where.ownerId : where.store?.ownerId,
          ownerId,
        );
        assert.ok(where.adminArchivedAt);
        return 0;
      },
      createQueryBuilder: () => {
        const query: (typeof queries)[number] = {};
        queries.push(query);
        const builder = {
          select: () => builder,
          addSelect: () => builder,
          innerJoin: () => builder,
          leftJoinAndSelect: () => builder,
          groupBy: () => builder,
          orderBy: () => builder,
          addOrderBy: () => builder,
          limit: () => builder,
          where: (sql: string, parameters: { userId: string }) => {
            assert.equal(
              sql,
              kind === 'post'
                ? 'sc.ownerId = :userId'
                : 'store.ownerId = :userId',
            );
            query.owner = parameters.userId;
            return builder;
          },
          andWhere: (sql: string) => {
            query.visibility = sql;
            return builder;
          },
          getRawMany: async () => [],
          getRawOne: async () => ({ totalMedia: 0 }),
          getMany: async () => [],
        };
        return builder;
      },
    };
  }
  const service = new UserDashboardService(
    {} as never,
    {
      manager: { count: async () => 0, find: async () => [] },
      find: async ({
        where,
      }: {
        where: { ownerId: string; adminArchivedAt?: unknown };
      }) => {
        assert.equal(where.ownerId, ownerId);
        assert.ok(where.adminArchivedAt);
        return [];
      },
    } as never,
    repository('post') as never,
    repository('product') as never,
    {
      manager: {
        count: async () => 0,
        query: async (sql: string, values: string[]) => {
          assert.deepEqual(values, [ownerId]);
          assert.match(sql, /a.store_id/);
          assert.match(sql, /a.product_id/);
          assert.match(sql, /suspended_at IS NULL/);
          return [{ totalMedia: 0 }];
        },
      },
    } as never,
    {} as never,
    {} as never,
    {
      getSubscriptionState: async (id: string) => {
        assert.equal(id, ownerId);
        return {
          state: 'expired',
          subscription: null,
          planName: null,
          planSlug: null,
          expiresAt: null,
          daysRemaining: null,
        };
      },
      getEffectiveLimits: async (id: string) => {
        assert.equal(id, ownerId);
        return { maxTotalPosts: 0 };
      },
    } as never,
  );
  const result = await service.getDashboard(ownerId);
  assert.equal(result.stats.totalStores, 0);
  assert.equal(result.stats.totalPosts, 0);
  assert.deepEqual(result.posts, []);
  assert.deepEqual(result.products, []);
  assert.equal(result.subscription, null);
  assert.deepEqual(result.subscriptionState, {
    state: 'expired',
    planName: null,
    planSlug: null,
    expiresAt: null,
    daysRemaining: null,
  });
  assert.equal(queries.length, 4);
  for (const query of queries) {
    assert.equal(query.owner, ownerId);
    assert.match(query.visibility ?? '', /admin_archived_at IS NULL/);
    assert.match(query.visibility ?? '', /suspended_at IS NULL/);
  }
});

test('owner content lists return the panel { items, total } envelope', async () => {
  const ownerId = 'owner-1';
  const createdAt = new Date('2026-02-01T00:00:00Z');
  const store = { id: 'store-1', slug: 'my-store', name: 'My store' };
  const product = Object.assign(new Product(), {
    id: 'product-1',
    storeId: store.id,
    slug: 'handmade-mug',
    name: 'Handmade mug',
    description: null,
    priceCents: '1800',
    currency: 'USD',
    category: 'other',
    status: ProductStatus.ACTIVE,
    stockQuantity: null,
    imageKeys: null,
    sortOrder: 0,
    createdAt,
    updatedAt: createdAt,
    store,
  });
  const post = Object.assign(new Showcase(), {
    id: 'post-1',
    storeId: store.id,
    ownerId,
    slug: 'fresh-story',
    title: 'Fresh story',
    description: null,
    status: ShowcaseStatus.PUBLISHED,
    publishedAt: createdAt,
    mediaCount: 2,
    likesCount: 1,
    viewsCount: 3,
    createdAt,
    updatedAt: createdAt,
    store,
  });
  function repository(row: Product | Showcase) {
    const chain = {
      select: () => chain,
      leftJoinAndSelect: () => chain,
      where: () => chain,
      andWhere: () => chain,
      orderBy: () => chain,
      addOrderBy: () => chain,
      limit: () => chain,
      getMany: async () => [row],
    };
    return {
      createQueryBuilder: () => chain,
      count: async () => 1,
    };
  }
  // Cover rows arrive ordered by asset position; the smallest label wins
  // within the earliest-positioned asset.
  const mediaAssets = {
    createQueryBuilder: () => {
      const chain = {
        innerJoin: () => chain,
        select: () => chain,
        addSelect: () => chain,
        where: () => chain,
        andWhere: () => chain,
        orderBy: () => chain,
        addOrderBy: () => chain,
        getRawMany: async () => [
          {
            showcaseId: post.id,
            assetId: 'asset-1',
            label: 'webp-1080',
            storageKey: 'variants/cover-large.webp',
          },
          {
            showcaseId: post.id,
            assetId: 'asset-1',
            label: 'webp-480',
            storageKey: 'variants/cover.webp',
          },
          {
            showcaseId: post.id,
            assetId: 'asset-2',
            label: 'webp-480',
            storageKey: 'variants/second-asset.webp',
          },
        ],
      };
      return chain;
    },
  };
  const service = new UserDashboardService(
    {} as never,
    {
      // Team access resolves through the store/owner lookup; this fixture has
      // an owner-only shop.
      manager: {
        async findOneBy(target: unknown) {
          return target === Store
            ? Object.assign(new Store(), {
                id: store.id,
                slug: store.slug,
                name: store.name,
                ownerId,
                status: StoreStatus.ACTIVE,
                adminArchivedAt: null,
              })
            : null;
        },
      },
    } as never,
    repository(post) as never,
    repository(product) as never,
    mediaAssets as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const products = await service.getUserProducts(ownerId, {
    storeId: store.id,
  });
  // The React panel reads data.items; a renamed key blanks the whole page.
  assert.deepEqual(Object.keys(products).sort(), [
    'hasMore',
    'items',
    'nextCursor',
    'total',
  ]);
  assert.equal(products.items.length, 1);
  assert.equal(products.items[0]?.slug, 'handmade-mug');
  assert.equal(products.items[0]?.storeSlug, store.slug);
  assert.equal(products.total, 1);
  assert.equal(products.hasMore, false);

  const posts = await service.getUserPosts(ownerId, { storeId: store.id });
  assert.deepEqual(Object.keys(posts).sort(), [
    'hasMore',
    'items',
    'nextCursor',
    'total',
  ]);
  assert.equal(posts.items.length, 1);
  assert.equal(posts.items[0]?.slug, 'fresh-story');
  assert.equal(posts.items[0]?.storeSlug, store.slug);
  // The first positioned asset's smallest variant is the cover, even when a
  // later asset has an equally small one.
  assert.equal(posts.items[0]?.thumbnailKey, 'variants/cover.webp');
  assert.equal(posts.total, 1);
  assert.equal(posts.hasMore, false);
});
