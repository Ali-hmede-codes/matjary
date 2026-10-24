import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UserDashboardService } from '../../apps/api/src/modules/user-dashboard/user-dashboard.service';
import { chooseContentSlug } from '@app/database';

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
