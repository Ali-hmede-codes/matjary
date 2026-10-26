import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  diversifyByStore,
  exploreScore,
  popularityScore,
  trendingScore,
  type RankableFeedItem,
} from '../../apps/api/src/modules/showcases/services/feed-ranking';

const now = Date.UTC(2026, 0, 15, 12, 0, 0);

function item(overrides: Partial<RankableFeedItem> = {}): RankableFeedItem {
  return {
    storeId: 'store-1',
    publishedAt: new Date(now - 6 * 60 * 60 * 1000),
    engagement: { likes: 10, views: 500 },
    media: [{ kind: 'image' }],
    store: {
      brandColor: '#254e40',
      logoKey: 'logos/store-1.jpg',
      businessCategory: 'restaurants',
      location: { latitude: 33.89, longitude: 35.5 },
    },
    ...overrides,
  };
}

test('explore score favors categories the viewer already liked', () => {
  const plain = exploreScore(item(), { now });
  const familiar = exploreScore(item(), {
    now,
    affinity: new Map([['restaurants', 2]]),
  });
  assert.ok(familiar > plain);
  assert.ok(
    exploreScore(item(), { now, affinity: new Map([['school', 5]]) }) === plain,
  );
});

test('explore score rewards freshness, media richness and distance', () => {
  const fresh = exploreScore(item(), { now });
  const stale = exploreScore(
    item({ publishedAt: new Date(now - 48 * 60 * 60 * 1000) }),
    { now },
  );
  assert.ok(fresh > stale);

  const carousel = exploreScore(
    item({ media: [{ kind: 'image' }, { kind: 'video' }] }),
    { now },
  );
  assert.ok(carousel > fresh);

  const near = exploreScore(item(), {
    now,
    latitude: 33.9,
    longitude: 35.5,
    distanceKm: () => 1,
  });
  const far = exploreScore(item(), {
    now,
    latitude: 33.9,
    longitude: 35.5,
    distanceKm: () => 40,
  });
  assert.ok(near > far);
});

test('trending score reflects velocity and ignores posts older than 72h', () => {
  const fresh = trendingScore(
    item({ engagement: { likes: 20, views: 400 } }),
    now,
  );
  const quiet = trendingScore(
    item({ engagement: { likes: 1, views: 10 } }),
    now,
  );
  assert.ok(fresh > quiet);

  const old = trendingScore(
    item({ publishedAt: new Date(now - 73 * 60 * 60 * 1000) }),
    now,
  );
  assert.equal(old, 0);

  // The explore endpoint widens its fallback window on quiet sites; posts from
  // that week still need a meaningful ordering instead of all scoring zero.
  const weekOld = item({ publishedAt: new Date(now - 100 * 60 * 60 * 1000) });
  assert.ok(trendingScore(weekOld, now, 24 * 7) > 0);
});

test('popularity score weights likes above views', () => {
  assert.equal(
    popularityScore(item({ engagement: { likes: 10, views: 100 } })),
    30,
  );
});

test('diversifyByStore pulls another shop forward after a repeated run', () => {
  const posts = [
    { id: 'a1', storeId: 'a' },
    { id: 'a2', storeId: 'a' },
    { id: 'a3', storeId: 'a' },
    { id: 'b1', storeId: 'b' },
    { id: 'c1', storeId: 'c' },
  ];
  const ordered = diversifyByStore(posts);
  assert.equal(ordered.length, posts.length);
  assert.deepEqual(
    ordered.map((post) => post.id),
    ['a1', 'a2', 'b1', 'a3', 'c1'],
  );
});
