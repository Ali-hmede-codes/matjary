import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FeedExploreService } from '../../apps/api/src/modules/showcases/services/feed-explore.service';

// These fakes only cover the read path the test exercises: the recent
// algorithm with no media, no shops and no engagement rows. The point is to
// count how many times the candidate SQL runs, not to model the database.
interface QueryStats {
  passes: number;
  joins: string[];
}

function fakeQueryBuilder(state: QueryStats, rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const name of [
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'innerJoin',
    'innerJoinAndSelect',
    'select',
    'addSelect',
    'groupBy',
    'limit',
    'distinct',
    'take',
    'offset',
  ]) {
    builder[name] = () => builder;
  }
  // An unconditional join would show up here: the personalized feed must not
  // produce a posts x stores cartesian product.
  builder.leftJoin = (target: unknown) => {
    state.joins.push(String(target));
    return builder;
  };
  builder.getMany = async () => {
    state.passes += 1;
    return rows;
  };
  builder.getRawMany = async () => [];
  builder.getCount = async () => 0;
  builder.getExists = async () => false;
  return builder;
}

function showcase(id: string, publishedAt: Date) {
  return {
    id,
    slug: `post-${id}`,
    title: `Post ${id}`,
    description: null,
    status: 'published',
    publishedAt,
    createdAt: publishedAt,
    updatedAt: publishedAt,
    ownerId: 'owner-1',
    storeId: 'store-1',
    linkedProductId: null,
    linkedCategoryId: null,
  };
}

function createService(rows: unknown[] = []) {
  const state: QueryStats = { passes: 0, joins: [] };
  const builder = fakeQueryBuilder(state, rows);
  const showcases = {
    createQueryBuilder: () => builder,
    manager: {
      getRepository: () => ({ find: async () => [] }),
    },
  };
  const stores = {
    find: async () => [],
    findBy: async () => [],
    findOne: async () => null,
  };
  const mediaAssets = {
    find: async () => [],
    manager: { getRepository: () => ({ find: async () => [] }) },
  };
  const engagement = {
    findBy: async () => [],
    manager: { createQueryBuilder: () => builder },
  };
  const service = new FeedExploreService(
    showcases as never,
    stores as never,
    mediaAssets as never,
    engagement as never,
    {} as never,
    {} as never,
    {} as never,
    { get: () => undefined } as never,
    { mget: async () => [] } as never,
  );
  return { service, state };
}

const visitor = { voterId: 'visitor-1', voterType: 'visitor' as const };

test('anonymous explore pages share one ranking pass per filter set', async () => {
  const rows = [
    showcase('a', new Date('2026-01-02T10:00:00Z')),
    showcase('b', new Date('2026-01-01T10:00:00Z')),
  ];
  const { service, state } = createService(rows);

  const first = await service.getExploreFeed(
    { limit: 12, cursor: '0', algorithm: 'recent' },
    visitor,
  );
  const second = await service.getExploreFeed(
    { limit: 12, cursor: '12', algorithm: 'recent' },
    visitor,
  );

  // The candidate SQL runs once; the second page is sliced from the same
  // ranked list instead of triggering another candidate scan.
  assert.equal(state.passes, 1);
  assert.equal(first.items.length, 2);
  assert.equal(second.items.length, 0);
  assert.equal(second.hasMore, false);
  // Both pages still answer with the full ranked length.
  assert.equal(first.total, 2);
  assert.equal(second.total, 2);
});

test('a signed-in viewer bypasses the shared ranked list', async () => {
  const rows = [showcase('a', new Date('2026-01-02T10:00:00Z'))];
  const { service, state } = createService(rows);
  const user = { voterId: 'user-1', voterType: 'user' as const };

  await service.getExploreFeed({ limit: 12, algorithm: 'recent' }, user);
  await service.getExploreFeed({ limit: 12, algorithm: 'recent' }, user);

  // Personalised ordering may depend on affinity, so it is never shared.
  assert.equal(state.passes, 2);
});

test('personalized feed never joins a table without a condition', async () => {
  const { service, state } = createService([]);

  const response = await service.getPersonalizedFeed('user-1', 20);

  assert.deepEqual(response.items, []);
  // The old fallback added `LEFT JOIN stores s2` with no condition, which is a
  // cartesian product of every post with every shop.
  assert.deepEqual(state.joins, []);
});
