import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { AppEnvironment } from '../../libs/config/src/environment';
import { validateEnvironment } from '../../libs/config/src/environment';
import {
  PostEngagement,
  PostLike,
  Showcase,
  ShowcaseStatus,
} from '../../libs/database/src/entities';
import { PostEngagementService } from '../../apps/api/src/modules/showcases/engagement/post-engagement.service';
import type { QueueService } from '../../libs/queue/src/queue.service';
import type { RedisService } from '../../libs/queue/src/redis.service';
import { EngagementFlusher } from '../../apps/worker/src/jobs/engagement.flush';
import { EngagementFlushReceipt } from '../../libs/database/src/durability.entities';
import {
  readEngagement,
  stageEngagement,
  acknowledgeEngagement,
  ENGAGEMENT_DIRTY,
  type EngagementState,
} from '../../libs/queue/src/engagement-buffer';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const baseEnv = {
  MYSQL_PASSWORD: 'test',
  REDIS_PASSWORD: 'test',
  GOOGLE_CLIENT_ID: CLIENT_ID,
  ENGAGEMENT_RATE_LIMIT_PER_MIN: '3',
};

function config(
  overrides: Record<string, string> = {},
): ConfigService<AppEnvironment, true> {
  return new ConfigService<AppEnvironment, true>(
    validateEnvironment({ ...baseEnv, ...overrides }),
  );
}

const postId = 'post-1';
const user = {
  id: 'user-1',
  email: 'owner@example.test',
  displayName: 'Owner',
};

// Model the atomic script contract for service/worker tests. The integration
// suite exercises the actual Lua against Redis; this fake does not execute Lua.
class MemoryRedis implements Partial<RedisService> {
  now = 0;
  fail = false;
  values = new Map<string, string>();
  hashes = new Map<string, Map<string, string>>();
  sets = new Map<string, Set<string>>();
  expires = new Map<string, number>();

  private expired(key: string): boolean {
    const expiry = this.expires.get(key);
    return expiry !== undefined && this.now > expiry;
  }

  failAck = false;
  async evaluate(
    script: string,
    keys: string[],
    args: string[],
  ): Promise<unknown> {
    if (this.fail) throw new Error('private redis details');
    const key = keys[0]!;
    if (keys.length === 1) {
      if (!this.values.has(key)) this.values.set(key, args[0]!);
      return 'OK';
    }
    const raw = this.values.get(key);
    if (!raw) return null;
    const state = JSON.parse(raw) as EngagementState;
    const dirty = this.sets.get(ENGAGEMENT_DIRTY) ?? new Set<string>();
    this.sets.set(ENGAGEMENT_DIRTY, dirty);
    if (keys.length === 3) {
      if (args[1] === 'like') {
        if (state.likes[args[2]!]) delete state.likes[args[2]!];
        else state.likes[args[2]!] = args[3] as 'user' | 'visitor';
      } else {
        const seen = keys[2]!;
        if (this.values.has(seen) && !this.expired(seen)) return raw;
        this.values.set(seen, '1');
        this.expires.set(seen, this.now + Number(args[4]));
        state.views++;
        state.pendingViews++;
      }
      state.changed = true;
      dirty.add(args[0]!);
    } else if (script.includes('s.batch = nil')) {
      if (this.failAck) throw new Error('acknowledgment interrupted');
      if (state.batch?.id !== args[1]) return 0;
      delete state.batch;
      if (!state.changed) dirty.delete(args[0]!);
    } else {
      if (state.batch) return JSON.stringify(state.batch);
      if (!state.changed) {
        dirty.delete(args[0]!);
        return null;
      }
      state.batch = {
        id: args[1]!,
        likes: { ...state.likes },
        views: state.pendingViews,
      };
      state.pendingViews = 0;
      state.changed = false;
      this.values.set(key, JSON.stringify(state));
      return JSON.stringify(state.batch);
    }
    const updated = JSON.stringify(state);
    this.values.set(key, updated);
    return updated;
  }

  async get(key: string) {
    if (this.fail) throw new Error('private redis details');
    if (this.expired(key)) return null;
    return this.values.get(key) ?? null;
  }

  async setWithTtl(key: string, value: string, seconds: number) {
    if (this.fail) throw new Error('private redis details');
    this.values.set(key, value);
    this.expires.set(key, this.now + seconds);
  }

  async remove(key: string) {
    this.values.delete(key);
    this.hashes.delete(key);
    this.expires.delete(key);
  }

  async incrementWithTtl(key: string, seconds: number) {
    if (this.fail) throw new Error('private redis details');
    const current = Number(await this.get(key)) || 0;
    const next = current + 1;
    this.values.set(key, String(next));
    if (current === 0) this.expires.set(key, this.now + seconds);
    return next;
  }

  async hset(key: string, field: string, value: string) {
    if (this.fail) throw new Error('private redis details');
    let map = this.hashes.get(key);
    if (!map) {
      map = new Map();
      this.hashes.set(key, map);
    }
    const existed = map.has(field);
    map.set(field, value);
    return existed ? 0 : 1;
  }

  async hdel(key: string, field: string) {
    if (this.fail) throw new Error('private redis details');
    const map = this.hashes.get(key);
    if (!map) return 0;
    const existed = map.delete(field);
    return existed ? 1 : 0;
  }

  async hexists(key: string, field: string) {
    if (this.fail) throw new Error('private redis details');
    if (this.expired(key)) return false;
    return this.hashes.get(key)?.has(field) ?? false;
  }

  async hlen(key: string) {
    if (this.fail) throw new Error('private redis details');
    if (this.expired(key)) return 0;
    return this.hashes.get(key)?.size ?? 0;
  }

  async hgetall(key: string) {
    if (this.fail) throw new Error('private redis details');
    if (this.expired(key)) return {};
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }

  async expire(key: string, seconds: number) {
    this.expires.set(key, this.now + seconds);
  }

  async sadd(key: string, member: string) {
    if (this.fail) throw new Error('private redis details');
    let set = this.sets.get(key);
    if (!set) {
      set = new Set();
      this.sets.set(key, set);
    }
    const added = !set.has(member);
    set.add(member);
    return added ? 1 : 0;
  }

  async smembers(key: string) {
    if (this.fail) throw new Error('private redis details');
    return [...(this.sets.get(key) ?? [])];
  }

  async srem(key: string, member: string) {
    if (this.fail) throw new Error('private redis details');
    const set = this.sets.get(key);
    if (!set) return 0;
    const had = set.has(member);
    set.delete(member);
    return had ? 1 : 0;
  }

  async setIfNotExistsWithTtl(key: string, value: string, seconds: number) {
    if (this.fail) throw new Error('private redis details');
    if (this.values.has(key) || this.sets.has(key)) return false;
    this.values.set(key, value);
    this.expires.set(key, this.now + seconds);
    return true;
  }

  async scan(cursor: number, match: string, count = 100) {
    if (this.fail) throw new Error('private redis details');
    const prefix = match.endsWith('*') ? match.slice(0, -1) : match;
    const keys = [...this.hashes.keys(), ...this.values.keys()].filter(
      (key) => key.startsWith(prefix) && !this.expired(key),
    );
    const page = keys.slice(0, count);
    return [0, page] as [number, string[]];
  }
}

function makeShowcase(overrides: Partial<Showcase> = {}): Showcase {
  return {
    id: postId,
    slug: 'my-post',
    title: 'My Post',
    status: ShowcaseStatus.PUBLISHED,
    ownerId: 'owner-1',
    ...overrides,
  } as Showcase;
}

function repoWith(
  overrides: {
    findOneBy?: (
      where: Record<string, unknown>,
    ) => Promise<PostEngagement | null>;
  } = {},
): Repository<PostEngagement> {
  return {
    findOneBy: async (where: Record<string, unknown>) => {
      if (overrides.findOneBy) return overrides.findOneBy(where);
      return null;
    },
    save: async (value: unknown) => value,
    create: (value: unknown) => value,
  } as unknown as Repository<PostEngagement>;
}

function postLikesRepoWith(
  existingLikes: PostLike[] = [],
): Repository<PostLike> {
  return {
    find: async () => existingLikes,
    findOneBy: async (where: { voterId: string }) =>
      existingLikes.find((like) => like.voterId === where.voterId) ?? null,
    create: (value: unknown) => value,
    save: async (value: unknown) => value,
    remove: async () => undefined,
  } as unknown as Repository<PostLike>;
}

function serviceWith({
  redis,
  queue,
  config: cfg,
  showcase = makeShowcase(),
  engagementRow,
  existingLikes = [],
  currentUser,
}: {
  redis: MemoryRedis;
  queue: { enqueueEngagementFlush: () => Promise<void> };
  config: ConfigService<AppEnvironment, true>;
  showcase?: Showcase | null;
  engagementRow?: PostEngagement | null;
  existingLikes?: PostLike[];
  currentUser?: { id: string } | null;
}): PostEngagementService {
  const showcases = {
    findOneBy: async () => showcase ?? null,
    manager: {
      transaction: async (work: (manager: unknown) => Promise<unknown>) =>
        work({
          findOneOrFail: async () => showcase,
          findBy: async () => existingLikes,
          findOneBy: async () => engagementRow ?? null,
        }),
    },
  } as unknown as Repository<Showcase>;
  const engagement = {
    findOneBy: async () => engagementRow ?? null,
    save: async () => undefined,
    create: (v: unknown) => v,
  } as unknown as Repository<PostEngagement>;
  const postLikes = postLikesRepoWith(existingLikes);
  const auth = {
    currentUser: async () => currentUser,
  } as unknown as never;

  return new PostEngagementService(
    showcases,
    engagement,
    postLikes,
    redis as unknown as RedisService,
    queue as unknown as QueueService,
    auth as never,
    cfg,
  );
}

function requestWith(cookie?: string) {
  return { headers: cookie ? { cookie } : {} } as never;
}

// ── toggleLike ──
test('toggleLike first like marks viewer as liked and returns count 1', async () => {
  const redis = new MemoryRedis();
  const svc = serviceWith({
    redis,
    queue: { enqueueEngagementFlush: async () => undefined },
    config: config(),
  });
  const viewer = { voterId: 'visitor-a', voterType: 'visitor' as const };

  const result = await svc.toggleLike(postId, viewer);
  assert.equal(result.liked, true);
  assert.equal(result.likes, 1);
});

test('toggleLike second click unlikes and decrements count', async () => {
  const redis = new MemoryRedis();
  const svc = serviceWith({
    redis,
    queue: { enqueueEngagementFlush: async () => undefined },
    config: config(),
  });
  const viewer = { voterId: 'visitor-a', voterType: 'visitor' as const };

  await svc.toggleLike(postId, viewer);
  const result = await svc.toggleLike(postId, viewer);
  assert.equal(result.liked, false);
  assert.equal(result.likes, 0);
});

test('toggleLike getEngagement reflects viewerLiked after liking', async () => {
  const redis = new MemoryRedis();
  const svc = serviceWith({
    redis,
    queue: { enqueueEngagementFlush: async () => undefined },
    config: config(),
  });
  const viewer = { voterId: 'visitor-a', voterType: 'visitor' as const };

  await svc.toggleLike(postId, viewer);
  const engagement = await svc.getEngagement(postId, viewer);
  assert.equal(engagement.likes, 1);
  assert.equal(engagement.viewerLiked, true);
});

test('toggleLike rate limit throws 429 after the configured limit', async () => {
  const redis = new MemoryRedis();
  const svc = serviceWith({
    redis,
    queue: { enqueueEngagementFlush: async () => undefined },
    config: config(),
  });
  const viewer = { voterId: 'visitor-a', voterType: 'visitor' as const };

  for (let i = 0; i < 3; i++) await svc.toggleLike(postId, viewer);
  await assert.rejects(
    svc.toggleLike(postId, viewer),
    (error: Error) => error instanceof HttpException,
  );
});

// ── registerView ──
test('registerView counts a first view and deduplicates a repeat within the window', async () => {
  const redis = new MemoryRedis();
  const svc = serviceWith({
    redis,
    queue: { enqueueEngagementFlush: async () => undefined },
    config: config(),
  });
  const viewer = { voterId: 'visitor-a', voterType: 'visitor' as const };

  const first = await svc.registerView(postId, viewer);
  assert.equal(first.views, 1);
  const second = await svc.registerView(postId, viewer);
  assert.equal(second.views, 1);
});

test('registerView counts again after the dedupe window expires', async () => {
  const redis = new MemoryRedis();
  const svc = serviceWith({
    redis,
    queue: { enqueueEngagementFlush: async () => undefined },
    config: config(),
  });
  const viewer = { voterId: 'visitor-a', voterType: 'visitor' as const };

  await svc.registerView(postId, viewer);
  redis.now = 301; // past the 300s dedupe TTL
  const second = await svc.registerView(postId, viewer);
  assert.equal(second.views, 2);
});

test('registerView falls back to DB count when Redis fails without breaking the page', async () => {
  const redis = new MemoryRedis();
  redis.fail = true;
  const svc = serviceWith({
    redis,
    queue: { enqueueEngagementFlush: async () => undefined },
    config: config(),
    engagementRow: { postId, likesCount: 2, viewsCount: 7 } as PostEngagement,
  });
  const viewer = { voterId: 'visitor-a', voterType: 'visitor' as const };

  const result = await svc.registerView(postId, viewer);
  assert.equal(result.views, 7);
});

// ── getEngagement ──
test('getEngagement reads likes and views from Redis', async () => {
  const redis = new MemoryRedis();
  const svc = serviceWith({
    redis,
    queue: { enqueueEngagementFlush: async () => undefined },
    config: config(),
  });
  const viewer = { voterId: 'visitor-a', voterType: 'visitor' as const };

  await svc.toggleLike(postId, viewer);
  await svc.registerView(postId, viewer);

  const engagement = await svc.getEngagement(postId, viewer);
  assert.equal(engagement.likes, 1);
  assert.equal(engagement.views, 1);
  assert.equal(engagement.viewerLiked, true);
});

test('getEngagement falls back to MySQL row when Redis is unavailable', async () => {
  const redis = new MemoryRedis();
  redis.fail = true;
  const svc = serviceWith({
    redis,
    queue: { enqueueEngagementFlush: async () => undefined },
    config: config(),
    engagementRow: { postId, likesCount: 5, viewsCount: 9 } as PostEngagement,
  });
  const viewer = { voterId: 'visitor-a', voterType: 'visitor' as const };

  const engagement = await svc.getEngagement(postId, viewer);
  assert.equal(engagement.likes, 5);
  assert.equal(engagement.views, 9);
  assert.equal(engagement.viewerLiked, false);
});

test('getEngagement throws NotFoundException for a missing post', async () => {
  const redis = new MemoryRedis();
  const svc = serviceWith({
    redis,
    queue: { enqueueEngagementFlush: async () => undefined },
    config: config(),
    showcase: null,
  });
  await assert.rejects(svc.getEngagement(postId), (error: Error) => {
    assert.equal(error.message, 'Post not found');
    return true;
  });
});

// ── resolveViewer ──
test('resolveViewer identifies a logged-in user by session', async () => {
  const redis = new MemoryRedis();
  const svc = serviceWith({
    redis,
    queue: { enqueueEngagementFlush: async () => undefined },
    config: config(),
    currentUser: user,
  });
  const viewer = await svc.resolveViewer(requestWith('matjary_session=abc'));
  assert.equal(viewer.voterId, 'user-1');
  assert.equal(viewer.voterType, 'user');
});

test('resolveViewer mints a visitor id for anonymous viewers', async () => {
  const redis = new MemoryRedis();
  const svc = serviceWith({
    redis,
    queue: { enqueueEngagementFlush: async () => undefined },
    config: config(),
  });
  const viewer = await svc.resolveViewer(requestWith());
  assert.equal(viewer.voterType, 'visitor');
  assert.ok(viewer.newVisitorId);
  assert.equal(viewer.voterId, viewer.newVisitorId);
});

test('resolveViewer reuses an existing visitor cookie', async () => {
  const redis = new MemoryRedis();
  const svc = serviceWith({
    redis,
    queue: { enqueueEngagementFlush: async () => undefined },
    config: config(),
  });
  const viewer = await svc.resolveViewer(
    requestWith('matjary_visitor=0123456789abcdef0123456789abcdef'),
  );
  assert.equal(viewer.voterId, '0123456789abcdef0123456789abcdef');
  assert.equal(viewer.voterType, 'visitor');
  assert.equal(viewer.newVisitorId, undefined);
});

// ── flushEngagement ──
test('API flush only schedules work and retains live likes', async () => {
  const redis = new MemoryRedis();
  let scheduled = 0;
  const svc = serviceWith({
    redis,
    queue: {
      enqueueEngagementFlush: async () => {
        scheduled++;
      },
    },
    config: config(),
    existingLikes: [],
  });
  const viewer = { voterId: 'visitor-a', voterType: 'visitor' as const };
  await svc.toggleLike(postId, viewer);
  await svc.toggleLike(postId, { ...viewer, voterId: 'visitor-b' });

  await svc.flushEngagement();

  assert.equal(scheduled, 1);
  assert.equal(
    Object.keys(
      (await readEngagement(redis as unknown as RedisService, postId))!.likes,
    ).length,
    2,
  );
  assert.deepEqual(await redis.smembers(ENGAGEMENT_DIRTY), [postId]);
});

function workerFixture(redis: MemoryRedis) {
  let persisted = {
    row: {
      postId,
      likesCount: 0,
      viewsCount: 0,
      lastBatchId: null,
    } as PostEngagement,
    likes: [] as PostLike[],
    receipts: [] as string[],
  };
  let failCommit = false;
  const repository = {
    manager: {
      transaction: async (work: (manager: any) => Promise<unknown>) => {
        const next = structuredClone(persisted);
        const result = await work({
          findOneOrFail: async (_target: unknown, options: any) => {
            assert.equal(options.lock.mode, 'pessimistic_write');
            return makeShowcase();
          },
          existsBy: async (target: unknown, where: { batchId: string }) => {
            assert.equal(target, EngagementFlushReceipt);
            return next.receipts.includes(where.batchId);
          },
          findBy: async () => next.likes,
          findOneBy: async () => next.row,
          create: (_target: unknown, value: any) => value,
          save: async (target: unknown, value?: any) => {
            if (target === PostLike)
              next.likes.push({ ...value, id: value.voterId });
          },
          delete: async (_target: unknown, where: { id: string }) => {
            next.likes = next.likes.filter((like) => like.id !== where.id);
          },
          update: async (_target: unknown, _where: unknown, values: any) => {
            assert.equal(values.viewsCount, next.row.viewsCount);
          },
          insert: async (_target: unknown, value: { batchId: string }) => {
            next.receipts.push(value.batchId);
          },
        });
        if (failCommit) throw new Error('database transaction failed');
        persisted = next;
        return result;
      },
    },
  } as unknown as Repository<Showcase>;
  const worker = new EngagementFlusher(
    repository,
    {} as Repository<PostEngagement>,
    {} as Repository<PostLike>,
    redis as unknown as RedisService,
    {} as QueueService,
    config(),
  );
  return {
    worker,
    state: () => persisted,
    failCommit: (value: boolean) => {
      failCommit = value;
    },
  };
}

test('worker retries commit-before-ack without double-counting, retaining concurrent events', async () => {
  const redis = new MemoryRedis();
  const svc = serviceWith({
    redis,
    queue: { enqueueEngagementFlush: async () => {} },
    config: config(),
  });
  const viewer = { voterId: 'a', voterType: 'visitor' as const };
  await svc.toggleLike(postId, viewer);
  await svc.registerView(postId, viewer);
  const fixture = workerFixture(redis);
  redis.failAck = true;
  await assert.rejects(fixture.worker.flushPost(postId), /interrupted/);
  assert.equal(fixture.state().row.viewsCount, 1);
  await svc.registerView(postId, { ...viewer, voterId: 'b' });
  await svc.toggleLike(postId, { ...viewer, voterId: 'b' });
  assert.equal((await svc.getEngagement(postId)).views, 2);
  redis.failAck = false;
  await fixture.worker.flushPost(postId);
  assert.equal(fixture.state().row.viewsCount, 1);
  assert.deepEqual(await redis.smembers(ENGAGEMENT_DIRTY), [postId]);
  await fixture.worker.flushPost(postId);
  await fixture.worker.flushPost(postId);
  assert.equal(fixture.state().row.viewsCount, 2);
  assert.equal(fixture.state().row.likesCount, 2);
  assert.equal(fixture.state().receipts.length, 2);
  assert.deepEqual(await redis.smembers(ENGAGEMENT_DIRTY), []);
  assert.equal((await svc.getEngagement(postId, viewer)).viewerLiked, true);
});

test('failed database commits retain immutable batches and stale acknowledgments do nothing', async () => {
  const redis = new MemoryRedis();
  const client = redis as unknown as RedisService;
  const svc = serviceWith({
    redis,
    queue: { enqueueEngagementFlush: async () => {} },
    config: config(),
  });
  await svc.registerView(postId, { voterId: 'a', voterType: 'visitor' });
  const fixture = workerFixture(redis);
  fixture.failCommit(true);
  await assert.rejects(fixture.worker.flushPost(postId), /transaction failed/);
  const batch = await stageEngagement(client, postId);
  await acknowledgeEngagement(client, postId, 'wrong-batch');
  assert.deepEqual(await stageEngagement(client, postId), batch);
  redis.now = 999999;
  assert.ok(await readEngagement(client, postId));
  assert.equal(fixture.state().row.viewsCount, 0);
  fixture.failCommit(false);
  await fixture.worker.flushPost(postId);
  assert.equal(fixture.state().row.viewsCount, 1);
  assert.equal(fixture.state().row.likesCount, 0);
});

test('cold cache hydrates durable likes and supports unliking after restart', async () => {
  const redis = new MemoryRedis();
  const svc = serviceWith({
    redis,
    queue: { enqueueEngagementFlush: async () => {} },
    config: config(),
    existingLikes: [{ voterId: 'a', voterType: 'visitor' } as PostLike],
    engagementRow: { postId, viewsCount: 8, likesCount: 1 } as PostEngagement,
  });
  const viewer = { voterId: 'a', voterType: 'visitor' as const };
  assert.deepEqual(await svc.getEngagement(postId, viewer), {
    views: 8,
    likes: 1,
    viewerLiked: true,
  });
  assert.deepEqual(await svc.toggleLike(postId, viewer), {
    liked: false,
    likes: 0,
  });
});
