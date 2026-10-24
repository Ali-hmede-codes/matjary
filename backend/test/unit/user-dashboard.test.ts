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
  lockOwnerContent,
  publicVisibilitySql,
  ownerVisibilitySql,
} from '@app/database';
import { StoresService } from '../../apps/api/src/modules/stores/stores.service';
import { StoreLifecycle1793918400000 } from '../../libs/database/src/migrations/1793918400000-StoreLifecycle';
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
  );
  return { store, writes, service, manager, control };
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

test('generated addresses support non-Latin names and retry collisions', async () => {
  let attempts = 0;
  const slug = await chooseContentSlug(
    'متجري',
    undefined,
    async () => ++attempts < 2,
  );
  assert.match(slug, /^shop-[a-f0-9]+$/);
  assert.equal(attempts, 2);
  assert.equal(
    await chooseContentSlug('New name', 'existing-address', async () => true),
    'existing-address',
  );
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
      getUserActiveSubscription: async (id: string) => {
        assert.equal(id, ownerId);
        return null;
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
  const service = new UserDashboardService(
    {} as never,
    {} as never,
    repository(post) as never,
    repository(product) as never,
    {} as never,
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
  assert.equal(posts.total, 1);
  assert.equal(posts.hasMore, false);
});
