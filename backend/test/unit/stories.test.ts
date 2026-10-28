import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  MediaAsset,
  MediaKind,
  MediaStatus,
  MediaVariant,
  Product,
  ProductStatus,
  Store,
  StoreCategory,
  StoreStatus,
  StoreStory,
  SubscriptionPlan,
  SubscriptionStatus,
  User,
  UserSubscription,
} from '../../libs/database/src/entities';
import {
  liveStoryWhere,
  storyExpiresAt,
  STORY_TTL_MS,
} from '../../libs/database/src/story-policy';
import {
  FREE_LIMITS,
  EXPIRED_LIMITS,
} from '../../libs/database/src/subscription-policy';
import { SAFE_SUBSCRIPTION_CODES } from '../../libs/database/src/subscription-errors';
import { purgeStoryRecords } from '../../libs/database/src/story-purge';
import { StoriesService } from '../../apps/api/src/modules/stories/stories.service';

const storeId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const assetId = '33333333-3333-4333-8333-333333333333';

function subscription(limits: Record<string, unknown>, slug = 'basic') {
  const plan = Object.assign(new SubscriptionPlan(), {
    id: 'plan',
    name: 'Basic',
    slug,
    limits,
  });
  return Object.assign(new UserSubscription(), {
    id: 'subscription',
    userId: ownerId,
    planId: plan.id,
    status: SubscriptionStatus.ACTIVE,
    startsAt: new Date(0),
    expiresAt: slug === 'free' ? new Date(Date.now() + 3_600_000) : null,
    plan,
  });
}

interface StoryFakes {
  live?: number;
  limits?: Record<string, unknown>;
  planSlug?: string;
  store?: Partial<Store>;
  asset?: Partial<MediaAsset>;
  attached?: boolean;
  product?: Partial<Product> | null;
  category?: Partial<StoreCategory> | null;
}

function storyService(fakes: StoryFakes = {}) {
  const store = Object.assign(new Store(), {
    id: storeId,
    ownerId,
    slug: 'cedar-shop',
    status: StoreStatus.ACTIVE,
    adminArchivedAt: null,
    ...fakes.store,
  });
  const asset = Object.assign(new MediaAsset(), {
    id: assetId,
    showcaseId: null,
    storeId,
    productId: null,
    purpose: 'store_story',
    kind: MediaKind.IMAGE,
    status: MediaStatus.READY,
    adminArchivedAt: null,
    ...fakes.asset,
  });
  const variant = Object.assign(new MediaVariant(), {
    id: 'variant',
    assetId: asset.id,
    asset,
    label: 'webp-1080',
    storageKey: `media/${storeId}/${assetId}/webp-1080.webp`,
    mimeType: 'image/webp',
    width: 1080,
    height: 1620,
  });
  const saved: StoreStory[] = [];
  const manager = {
    findOne: async (target: unknown) => {
      if (target === User) return { id: ownerId, suspendedAt: null };
      if (target === MediaAsset) return asset;
      return null;
    },
    findOneBy: async (target: unknown) => {
      if (target === Store) return store;
      if (target === StoreStory) return fakes.attached ? { id: 'other' } : null;
      if (target === Product) return fakes.product ?? null;
      if (target === StoreCategory) return fakes.category ?? null;
      return null;
    },
    findOneOrFail: async (target: unknown) => {
      if (target === User) return { id: ownerId, suspendedAt: null };
      if (target === MediaAsset) return asset;
      throw new NotFoundException();
    },
    count: async () => fakes.live ?? 0,
    create: (_target: unknown, value: Partial<StoreStory>) =>
      Object.assign(new StoreStory(), value),
    save: async (value: StoreStory) => {
      value.id = value.id ?? 'story-1';
      value.createdAt = new Date();
      value.updatedAt = value.createdAt;
      saved.push(value);
      return value;
    },
    getRepository: (target: unknown) =>
      target === UserSubscription
        ? {
            find: async () => [
              subscription(
                fakes.limits ?? { maxStories: 2 },
                fakes.planSlug ?? 'basic',
              ),
            ],
          }
        : { findOneBy: async () => null },
    transaction: async (work: (entityManager: unknown) => Promise<unknown>) =>
      work(manager),
  };
  const service = new StoriesService(
    { manager, findOneBy: async () => null, find: async () => [] } as never,
    { findOneBy: async () => store } as never,
    { find: async () => [asset] } as never,
    { find: async () => [variant] } as never,
    { findBy: async () => [] } as never,
    { findBy: async () => [] } as never,
    { presignedGetUrl: async (key: string) => `/signed/${key}` } as never,
  );
  return { service, store, asset, saved };
}

test('story policy publishes for 24 hours and counts only live rows', () => {
  const now = new Date('2026-10-28T10:00:00Z');
  assert.equal(
    storyExpiresAt(now).getTime() - now.getTime(),
    STORY_TTL_MS,
    'a story lives exactly one day',
  );
  assert.equal(STORY_TTL_MS, 24 * 3_600_000);
  const where = liveStoryWhere(now) as unknown as {
    expiresAt: { type: string; value: Date };
  };
  assert.equal(where.expiresAt.type, 'moreThan');
  assert.equal(where.expiresAt.value, now);
  assert.equal(FREE_LIMITS.maxStories, 0);
  assert.equal(EXPIRED_LIMITS.maxStories, 0);
  // The composer can only read codes the exception filter allows through.
  assert.ok(SAFE_SUBSCRIPTION_CODES.has('STORY_LIMIT'));
  assert.ok(SAFE_SUBSCRIPTION_CODES.has('STORY_STORE_OFFLINE'));
});

test('a story uses one free slot and answers with its media and live window', async () => {
  const { service, saved } = storyService({ live: 1 });
  const story = await service.create(
    { storeSlug: 'cedar-shop', mediaId: assetId },
    ownerId,
  );
  assert.equal(saved.length, 1);
  assert.equal(saved[0]!.storeId, storeId);
  assert.equal(saved[0]!.ownerId, ownerId);
  assert.equal(saved[0]!.mediaAssetId, assetId);
  assert.equal(story.media.id, assetId);
  assert.equal(
    story.media.primaryUrl,
    `/signed/media/${storeId}/${assetId}/webp-1080.webp`,
  );
  assert.ok(story.expiresAt.getTime() > Date.now());
});

test('story slots are refused when every live slot is taken or the plan has none', async () => {
  const full = storyService({ live: 2 });
  await assert.rejects(
    full.service.create({ storeSlug: 'cedar-shop', mediaId: assetId }, ownerId),
    ConflictException,
  );
  assert.equal(full.saved.length, 0);

  // A bounded free trial still carries the free plan's zero stories.
  const free = storyService({ limits: { maxStories: 0 }, planSlug: 'free' });
  await assert.rejects(
    free.service.create({ storeSlug: 'cedar-shop', mediaId: assetId }, ownerId),
    ConflictException,
  );

  // An expired trial cannot publish at all, even before the quota is read.
  const expired = storyService({ limits: { maxStories: 0 }, planSlug: 'free' });
  const expiredManager = {
    findOne: async () => ({ id: ownerId, suspendedAt: null }),
    findOneBy: async (target: unknown) =>
      target === Store ? expired.store : null,
    getRepository: () => ({ find: async () => [] }),
    transaction: async (work: (entityManager: unknown) => Promise<unknown>) =>
      work(expiredManager),
  };
  const expiredService = new StoriesService(
    { manager: expiredManager } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await assert.rejects(
    expiredService.create(
      { storeSlug: 'cedar-shop', mediaId: assetId },
      ownerId,
    ),
    ForbiddenException,
  );
});

test('story publishing rejects foreign, unprocessed, reused and mismatched media', async () => {
  const foreign = storyService({ asset: { storeId: 'another-shop' } });
  await assert.rejects(
    foreign.service.create(
      { storeSlug: 'cedar-shop', mediaId: assetId },
      ownerId,
    ),
    NotFoundException,
  );

  const logo = storyService({ asset: { purpose: 'store_logo' } });
  await assert.rejects(
    logo.service.create({ storeSlug: 'cedar-shop', mediaId: assetId }, ownerId),
    NotFoundException,
  );

  const processing = storyService({
    asset: { status: MediaStatus.PROCESSING },
  });
  await assert.rejects(
    processing.service.create(
      { storeSlug: 'cedar-shop', mediaId: assetId },
      ownerId,
    ),
    ConflictException,
  );

  const reused = storyService({ attached: true });
  await assert.rejects(
    reused.service.create(
      { storeSlug: 'cedar-shop', mediaId: assetId },
      ownerId,
    ),
    ConflictException,
  );

  const bothLinks = storyService();
  await assert.rejects(
    bothLinks.service.create(
      {
        storeSlug: 'cedar-shop',
        mediaId: assetId,
        linkedProductId: 'product',
        linkedCategoryId: 'category',
      },
      ownerId,
    ),
    BadRequestException,
  );

  const otherShopProduct = storyService({
    product: {
      id: 'product',
      storeId: 'another-shop',
      status: ProductStatus.ACTIVE,
      adminArchivedAt: null,
    },
  });
  await assert.rejects(
    otherShopProduct.service.create(
      { storeSlug: 'cedar-shop', mediaId: assetId, linkedProductId: 'product' },
      ownerId,
    ),
    NotFoundException,
  );
});

test('a suspended owner and an offline shop cannot publish stories', async () => {
  const offline = storyService({ store: { status: StoreStatus.OFFLINE } });
  await assert.rejects(
    offline.service.create(
      { storeSlug: 'cedar-shop', mediaId: assetId },
      ownerId,
    ),
    ConflictException,
  );

  const manager = {
    findOne: async () => ({ id: ownerId, suspendedAt: new Date() }),
    findOneBy: async (target: unknown) =>
      target === Store
        ? Object.assign(new Store(), {
            id: storeId,
            ownerId,
            slug: 'cedar-shop',
            status: StoreStatus.ACTIVE,
            adminArchivedAt: null,
          })
        : null,
    transaction: async (work: (entityManager: unknown) => Promise<unknown>) =>
      work(manager),
  };
  const suspended = new StoriesService(
    { manager } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await assert.rejects(
    suspended.create({ storeSlug: 'cedar-shop', mediaId: assetId }, ownerId),
    ForbiddenException,
  );
});

test('story purge removes the row before its media and returns every byte key', async () => {
  const statements: string[] = [];
  const manager = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.startsWith('SELECT original_key'))
        return [{ storageKey: `originals/${storeId}/${assetId}/source` }];
      if (sql.startsWith('SELECT storage_key'))
        return [{ storageKey: `media/${storeId}/${assetId}/webp-1080.webp` }];
      return [];
    },
  } as unknown as EntityManager;
  const keys = await purgeStoryRecords(manager, {
    id: 'story-1',
    storeId,
    mediaAssetId: assetId,
  });
  assert.ok(keys.includes(`originals/${storeId}/${assetId}/source`));
  assert.ok(keys.includes(`media/${storeId}/${assetId}/webp-1080.webp`));
  assert.ok(keys.includes(`media/${storeId}/${assetId}/jpeg-1600.jpg`));
  assert.ok(keys.includes(`media/${storeId}/${assetId}/poster-jpeg.jpg`));
  assert.equal(
    statements.find((sql) => sql.startsWith('DELETE')),
    'DELETE FROM store_stories WHERE id = ?',
    'the story row goes before the media it references',
  );
  assert.ok(statements.some((sql) => sql.includes('media_variants')));
  assert.ok(statements.some((sql) => sql.includes('media_assets')));
});
