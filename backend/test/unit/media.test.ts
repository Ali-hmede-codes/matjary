import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable, PassThrough } from 'node:stream';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { Module, UnauthorizedException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import type { Repository } from 'typeorm';
import {
  validateEnvironment,
  type AppEnvironment,
} from '../../libs/config/src/environment';
import { StorageService } from '../../libs/storage/src/storage.service';
import { LocalStorageProvider } from '../../libs/storage/src/providers/local.storage.provider';
import {
  MediaAsset,
  MediaVariant,
  Showcase,
  Store,
  StoreStatus,
  MediaKind,
  MediaStatus,
  ShowcaseStatus,
  StoreStory,
  SubscriptionPlan,
  SubscriptionStatus,
  User,
  UserSubscription,
} from '../../libs/database/src/entities';
import { MediaService } from '../../apps/api/src/modules/showcases/media.service';
import { MediaProcessor } from '../../apps/worker/src/jobs/media.process';
import {
  MediaController,
  parseMediaRange,
} from '../../apps/api/src/modules/showcases/media.controller';
import { AuthService } from '../../apps/api/src/modules/auth/auth.service';
import { AuthCookies } from '../../apps/api/src/modules/auth/auth.cookies';
import {
  SessionGuard,
  OptionalSessionGuard,
  AuthOriginGuard,
  BinaryOriginGuard,
  AuthRateLimitGuard,
} from '../../apps/api/src/modules/auth/guards/auth.guards';
import { setupApp } from '../../apps/api/src/setup-app';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { QueueService } from '../../libs/queue/src/queue.service';
import {
  encodeImage,
  encodeShareCard,
  encodeVideo,
  validateSignature,
  InvalidMediaError,
  type EncodingOptions,
} from '../../libs/media-processing/src/encode';

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Product, ProductStatus } from '../../libs/database/src/entities';
import { assertMediaAttachment } from '../../libs/database/src/media-target';
import {
  mediaAssetIdFromKey,
  storeShareCardKey,
} from '../../libs/storage/src/share-card-key';
import { OwnerMediaTargets1793832000000 } from '../../libs/database/src/migrations/1793832000000-OwnerMediaTargets';
import { StoryMediaPurpose1795128000000 } from '../../libs/database/src/migrations/1795128000000-StoryMediaPurpose';
import type { EntityManager, QueryRunner } from 'typeorm';

test('store and product images require the correct owner, target, readiness and public attachment', async () => {
  const store: Store = Object.assign(new Store(), {
    id: 'store',
    ownerId: 'owner',
    logoKey: null,
  });
  const post = Object.assign(new Showcase(), {
    id: 'post',
    ownerId: 'owner',
    storeId: store.id,
    status: ShowcaseStatus.PUBLISHED,
  });
  const product = Object.assign(new Product(), {
    id: 'product',
    storeId: store.id,
    status: ProductStatus.DRAFT,
    imageKeys: ['image-key'],
  });
  const asset: MediaAsset = Object.assign(new MediaAsset(), {
    id: 'asset',
    showcaseId: null,
    storeId: store.id,
    productId: null,
    purpose: 'store_logo',
    kind: MediaKind.IMAGE,
    status: MediaStatus.READY,
  });
  const variant = Object.assign(new MediaVariant(), {
    asset,
    assetId: asset.id,
    storageKey: 'image-key',
    mimeType: 'image/webp',
  });
  let hidden = false;
  const manager = {
    findOne: async (
      _target: unknown,
      options: { where: { storageKey: string } },
    ) => (options.where.storageKey === variant.storageKey ? variant : null),
    findOneBy: async (target: unknown) =>
      hidden
        ? null
        : target === Store
          ? store
          : target === Product
            ? product
            : target === Showcase
              ? post
              : null,
    getRepository: () => ({ findOne: async () => variant }),
  } as unknown as EntityManager;
  const media = new MediaService(
    {} as never,
    {} as never,
    { manager, findOne: async () => null } as never,
    {} as never,
    {} as never,
    configuration('.tmp'),
  );
  await assert.rejects(media.authorizeDownload('image-key'), NotFoundException);
  assert.deepEqual(await media.authorizeDownload('image-key', 'owner'), {
    mimeType: 'image/webp',
    public: false,
  });
  await assertMediaAttachment(manager, 'owner', 'store_logo', store.id, [
    'image-key',
  ]);
  await assert.rejects(
    assertMediaAttachment(manager, 'other', 'store_logo', store.id, [
      'image-key',
    ]),
    ConflictException,
  );
  await assert.rejects(
    assertMediaAttachment(manager, 'owner', 'store_banner', store.id, [
      'image-key',
    ]),
    ConflictException,
  );
  await assert.rejects(
    assertMediaAttachment(manager, 'owner', 'store_logo', 'another-store', [
      'image-key',
    ]),
    ConflictException,
  );
  store.logoKey = 'image-key';
  assert.equal((await media.authorizeDownload('image-key')).public, true);
  asset.status = MediaStatus.PROCESSING;
  await assert.rejects(
    assertMediaAttachment(manager, 'owner', 'store_logo', store.id, [
      'image-key',
    ]),
    ConflictException,
  );
  await assert.rejects(media.authorizeDownload('image-key'), NotFoundException);
  asset.status = MediaStatus.READY;
  asset.storeId = null;
  asset.productId = product.id;
  asset.purpose = 'product_image';
  await assert.rejects(media.authorizeDownload('image-key'), NotFoundException);
  product.status = ProductStatus.ACTIVE;
  assert.equal((await media.authorizeDownload('image-key')).public, true);
  for (const target of ['store', 'product', 'post'] as const) {
    asset.storeId = target === 'store' ? store.id : null;
    asset.productId = target === 'product' ? product.id : null;
    asset.showcaseId = target === 'post' ? post.id : null;
    for (const status of [StoreStatus.OFFLINE, StoreStatus.ARCHIVED]) {
      store.status = status;
      await assert.rejects(
        media.authorizeDownload('image-key'),
        NotFoundException,
      );
      assert.equal(
        (await media.authorizeDownload('image-key', 'owner')).public,
        false,
      );
    }
    store.status = StoreStatus.ACTIVE;
    assert.equal((await media.authorizeDownload('image-key')).public, true);
  }
  hidden = true;
  await assert.rejects(
    media.authorizeDownload('image-key', 'owner'),
    NotFoundException,
  );
});

test('share sizes of attached store and product images are public; detached ones are not', async () => {
  const storeId = '11111111-1111-4111-8111-111111111111';
  const assetId = '22222222-2222-4222-8222-222222222222';
  const otherAssetId = '33333333-3333-4333-8333-333333333333';
  const productId = '44444444-4444-4444-8444-444444444444';
  const logoKey = `media/${storeId}/${assetId}/webp-1080.webp`;
  const wideKey = `media/${storeId}/${assetId}/jpeg-1600.jpg`;
  const store = Object.assign(new Store(), {
    id: storeId,
    ownerId: 'owner',
    logoKey,
    bannerKey: null,
    status: StoreStatus.ACTIVE,
  });
  const product = Object.assign(new Product(), {
    id: productId,
    storeId,
    status: ProductStatus.ACTIVE,
    imageKeys: [logoKey],
  });
  const asset: MediaAsset = Object.assign(new MediaAsset(), {
    id: assetId,
    showcaseId: null,
    storeId,
    productId: null,
    purpose: 'store_logo',
    kind: MediaKind.IMAGE,
    status: MediaStatus.READY,
  });
  const variant = Object.assign(new MediaVariant(), {
    asset,
    assetId: asset.id,
    storageKey: wideKey,
    mimeType: 'image/jpeg',
    width: 1600,
  });
  const manager = {
    findOne: async (
      _target: unknown,
      options: { where: { storageKey: string } },
    ) => (options.where.storageKey === variant.storageKey ? variant : null),
    findOneBy: async (target: unknown) =>
      target === Store ? store : target === Product ? product : null,
    getRepository: () => ({
      findOne: async (options: { where: { storageKey: string } }) =>
        options.where.storageKey === variant.storageKey ? variant : null,
    }),
  } as unknown as EntityManager;
  const media = new MediaService(
    {} as never,
    {} as never,
    { manager, findOne: async () => null } as never,
    {} as never,
    {} as never,
    configuration('.tmp'),
  );
  // The owner saved one size; the wider JPEG sibling of the same asset is public.
  assert.equal((await media.authorizeDownload(wideKey)).public, true);
  asset.storeId = null;
  asset.productId = product.id;
  assert.equal((await media.authorizeDownload(wideKey)).public, true);
  product.imageKeys = [`media/${storeId}/${otherAssetId}/jpeg-1600.jpg`];
  await assert.rejects(media.authorizeDownload(wideKey), NotFoundException);
  product.imageKeys = [logoKey];
  product.status = ProductStatus.DRAFT;
  await assert.rejects(media.authorizeDownload(wideKey), NotFoundException);
  product.status = ProductStatus.ACTIVE;
  assert.equal((await media.authorizeDownload(wideKey)).public, true);
  store.status = StoreStatus.OFFLINE;
  await assert.rejects(media.authorizeDownload(wideKey), NotFoundException);
});

test('completion records the outbox and enqueues the job without waiting for the sweep', async () => {
  const log: string[] = [];
  const makeAsset = () =>
    ({
      id: 'media-1',
      showcaseId: 'post-1',
      storeId: null,
      productId: null,
      originalKey: 'originals/post-1/media-1/source',
      sizeBytes: '10',
      mimeType: 'image/jpeg',
      kind: MediaKind.IMAGE,
      status: MediaStatus.PENDING,
      uploadExpiresAt: new Date(Date.now() + 60_000),
      processingLimits: { maxBytes: 100 },
    }) as unknown as MediaAsset;
  const build = (
    asset: MediaAsset,
    enqueueMediaProcessing: () => Promise<void>,
  ) => {
    const manager = {
      findOneOrFail: async (target: unknown) =>
        target === MediaAsset ? asset : { id: 'owner', suspendedAt: null },
      findOneBy: async (target: unknown) =>
        target === Showcase
          ? { id: 'post-1', ownerId: 'owner', storeId: null }
          : null,
      save: async () => {
        log.push('save');
      },
      insert: async () => {
        log.push('outbox');
      },
    };
    return new MediaService(
      {} as never,
      {} as never,
      {
        findOneBy: async () => asset,
        manager: {
          ...manager,
          transaction: async (run: (em: unknown) => Promise<unknown>) =>
            run(manager),
        },
      } as never,
      { statObject: async () => ({ size: 10 }) } as never,
      { enqueueMediaProcessing } as unknown as QueueService,
      {} as unknown as ConfigService<AppEnvironment, true>,
    );
  };
  const asset = makeAsset();
  await build(asset, async () => {
    log.push('enqueue');
  }).complete('media-1', 'owner');
  assert.equal(asset.status, MediaStatus.PROCESSING);
  // The worker gets the job right away, after the durable outbox row exists.
  assert.deepEqual(log, ['save', 'outbox', 'enqueue']);
  // A Redis outage defers the job to the repair sweep instead of failing the
  // owner's request after the outbox row was already committed.
  const pending = makeAsset();
  await build(pending, async () => {
    throw new Error('queue unavailable');
  }).complete('media-1', 'owner');
  assert.equal(pending.status, MediaStatus.PROCESSING);
});

test('owner media migration preserves existing assets and refuses destructive reversal', async () => {
  const statements: string[] = [];
  let nonPostAssets = 0;
  const runner = {
    query: async (sql: string) => {
      statements.push(sql);
      return [{ count: nonPostAssets }];
    },
  } as unknown as QueryRunner;
  const migration = new OwnerMediaTargets1793832000000();
  await migration.up(runner);
  assert.match(statements.join(' '), /chk_media_parent/);
  assert.match(statements.join(' '), /ON DELETE RESTRICT/);
  nonPostAssets = 1;
  await assert.rejects(migration.down(runner), /Move non-post media/);
  nonPostAssets = 0;
  await migration.down(runner);
  assert.match(statements.at(-1)!, /DROP CHECK chk_media_parent/);
});

test('story media migration admits store_story rows and refuses destructive reversal', async () => {
  const statements: string[] = [];
  let storyAssets = 0;
  const runner = {
    query: async (sql: string) => {
      statements.push(sql);
      return sql.includes('COUNT(*)') ? [{ count: storyAssets }] : [];
    },
  } as unknown as QueryRunner;
  const migration = new StoryMediaPurpose1795128000000();
  await migration.up(runner);
  const up = statements.join(' ');
  assert.match(up, /purpose = 'store_story'/);
  assert.match(up, /DROP CHECK `chk_media_parent`/);
  // Branding and product rows keep their image-only rules.
  assert.match(up, /purpose IN \('store_logo', 'store_banner'\)/);
  assert.match(up, /kind = 'image'/);
  storyAssets = 1;
  await assert.rejects(migration.down(runner), /Remove story media/);
  storyAssets = 0;
  await migration.down(runner);
  assert.match(statements.at(-1)!, /ADD CONSTRAINT `chk_media_parent` CHECK/);
  assert.doesNotMatch(statements.at(-1)!, /store_story/);
});

async function tempDirectory(): Promise<string> {
  const root = path.resolve('.tmp');
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, 'media-test-'));
}
function configuration(directory: string) {
  return new ConfigService<AppEnvironment, true>(
    validateEnvironment({
      MYSQL_PASSWORD: 'test',
      REDIS_PASSWORD: 'test',
      STORAGE_LOCAL_DIR: directory,
    }),
  );
}
const bytes = Buffer.from('0123456789');

test('local storage is exclusive, bounded, durable across provider recreation and traversal-safe', async () => {
  const directory = await tempDirectory();
  try {
    const config = configuration(directory);
    const storage = new LocalStorageProvider(config);
    const key = 'originals/post/source';
    const uploads = await Promise.allSettled(
      [1, 2].map(() =>
        storage.putStream(
          key,
          Readable.from(bytes),
          'video/mp4',
          bytes.length,
          { exclusive: true },
        ),
      ),
    );
    assert.equal(
      uploads.filter((item) => item.status === 'fulfilled').length,
      1,
    );
    assert.deepEqual(
      await new LocalStorageProvider(config).getObject(key),
      bytes,
    );
    assert.match(
      (await storage.presignedPutUrl(key)).url,
      /\/api\/v1\/uploads\/originals%2Fpost%2Fsource$/,
    );
    for (const bad of [
      '../outside',
      '/absolute',
      'C:/escape',
      'a\\b',
      'a/../b',
      'a//b',
      '%2e%2e/escape',
    ]) {
      await assert.rejects(
        storage.putStream(bad, Readable.from(bytes), 'video/mp4', bytes.length),
      );
    }
    await assert.rejects(
      storage.putStream('too-big', Readable.from(bytes), 'video/mp4', 2),
    );
    await assert.rejects(
      storage.putStream('too-short', Readable.from(bytes), 'video/mp4', 20),
    );
    const input = new PassThrough();
    const abort = new AbortController();
    const pending = storage.putStream('interrupted', input, 'video/mp4', 100, {
      signal: abort.signal,
    });
    input.write('start');
    abort.abort();
    await assert.rejects(pending);
    for (const key of ['too-big', 'too-short', 'interrupted'])
      await assert.rejects(storage.statObject(key));
    assert.deepEqual(
      (await fs.readdir(directory)).filter((file) => file.endsWith('.upload')),
      [],
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('local storage rejects symlink escapes', async (t) => {
  const directory = await tempDirectory();
  const outside = await tempDirectory();
  try {
    try {
      await fs.symlink(
        outside,
        path.join(directory, 'escape'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        t.skip('Symlink privileges unavailable');
        return;
      }
      throw error;
    }
    const provider = new LocalStorageProvider(configuration(directory));
    await assert.rejects(
      provider.putStream(
        'escape/source',
        Readable.from(bytes),
        'video/mp4',
        bytes.length,
      ),
      /Invalid storage key/,
    );
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('range parser handles suffixes, clamping and unsatisfiable requests', () => {
  assert.deepEqual(parseMediaRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseMediaRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(parseMediaRange('bytes=5-99', 10), { start: 5, end: 9 });
  for (const value of [
    'bytes=10-',
    'bytes=-0',
    'bytes=5-2',
    'bytes=1-2,4-5',
    'bytes=-',
    'bytes=99999999999999999-',
  ])
    assert.equal(parseMediaRange(value, 10), null);
});

test('HTTP local bytes enforce ownership, publication, origin, provider and ranges', async () => {
  const directory = await tempDirectory();
  const config = configuration(directory);
  const storage = new StorageService(config);
  const showcase = {
    id: 'post',
    slug: 'post',
    ownerId: 'owner',
    status: ShowcaseStatus.DRAFT,
  } as Showcase;
  const asset = {
    id: 'asset',
    showcaseId: 'post',
    showcase,
    originalKey: 'originals/post/source',
    sizeBytes: '10',
    mimeType: 'video/mp4',
    kind: MediaKind.VIDEO,
    status: MediaStatus.PENDING,
    uploadExpiresAt: new Date(Date.now() + 60000),
  } as MediaAsset;
  const variant = {
    storageKey: 'processed/post/video.mp4',
    asset,
    mimeType: 'video/mp4',
  } as MediaVariant;
  let restrictedParent = false;
  const hidden = () =>
    Boolean(
      asset.adminArchivedAt || showcase.adminArchivedAt || restrictedParent,
    );
  config.set('ADMIN_EMAILS', 'admin@example.test');
  const assets = {
    findOne: async (options: {
      where: { originalKey: string; adminArchivedAt?: unknown };
    }) =>
      options.where.originalKey === asset.originalKey &&
      (!options.where.adminArchivedAt || !hidden())
        ? asset
        : null,
    manager: {
      findOneBy: async (target: unknown) =>
        target === Showcase
          ? hidden()
            ? null
            : showcase
          : {
              id: 'admin',
              email: 'admin@example.test',
              suspendedAt: null,
            },
      getRepository: () => ({
        findOne: async (options: {
          where: { storageKey: string; asset?: unknown };
        }) =>
          options.where.storageKey === variant.storageKey &&
          (!options.where.asset || !hidden())
            ? variant
            : null,
      }),
    },
  } as unknown as Repository<MediaAsset>;
  const media = new MediaService(
    {} as Repository<Showcase>,
    {} as Repository<Store>,
    assets,
    storage,
    {} as QueueService,
    config,
  );
  const auth = {
    currentUser: async (token?: string) => {
      if (!['owner', 'other', 'admin'].includes(token ?? ''))
        throw new UnauthorizedException();
      return { id: token, email: `${token}@example.test`, displayName: token };
    },
    rateLimit: async () => {},
  };
  @Module({
    controllers: [MediaController],
    providers: [
      { provide: MediaService, useValue: media },
      { provide: StorageService, useValue: storage },
      { provide: ConfigService, useValue: config },
      { provide: AuthService, useValue: auth },
      AuthCookies,
      SessionGuard,
      OptionalSessionGuard,
      AuthOriginGuard,
      BinaryOriginGuard,
      AuthRateLimitGuard,
    ],
  })
  class TestModule {}
  const app = await NestFactory.create<NestExpressApplication>(TestModule, {
    logger: false,
    bodyParser: false,
  });
  setupApp(app, false);
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const url = (key: string) =>
      `${base}/api/v1/uploads/${encodeURIComponent(key)}`;
    const upload = (cookie = 'owner', origin = 'http://localhost:3000') =>
      fetch(url(asset.originalKey!), {
        method: 'PUT',
        headers: {
          Cookie: `matjary_session=${cookie}`,
          Origin: origin,
          'Content-Type': 'video/mp4',
        },
        body: bytes,
      });
    assert.equal((await upload('other')).status, 404);
    assert.equal(
      (await upload('admin')).status,
      404,
      'administrators cannot upload for another owner',
    );
    assert.equal((await upload('')).status, 401);
    assert.equal((await upload('owner', 'https://evil.test')).status, 403);
    asset.uploadExpiresAt = new Date(0);
    assert.equal((await upload()).status, 409);
    asset.uploadExpiresAt = new Date(Date.now() + 60000);
    assert.equal((await upload()).status, 200);
    assert.equal((await upload()).status, 409);
    assert.equal((await fetch(url(asset.originalKey!))).status, 404);
    const original = await fetch(url(asset.originalKey!), {
      headers: { Cookie: 'matjary_session=owner' },
    });
    assert.equal(original.headers.get('cache-control'), 'private, no-store');
    assert.equal(await original.text(), bytes.toString());
    await storage.putObject(variant.storageKey, bytes, 'video/mp4');
    assert.equal((await fetch(url(variant.storageKey))).status, 404);
    asset.status = MediaStatus.READY;
    showcase.status = ShowcaseStatus.PUBLISHED;
    const part = await fetch(url(variant.storageKey), {
      headers: { Range: 'bytes=2-5' },
    });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(part.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(
      part.headers.get('cache-control'),
      'public, max-age=3600',
      'published variants are cacheable so repeat views skip the origin',
    );
    assert.equal(await part.text(), '2345');
    // A revalidating browser gets a bodyless response instead of the bytes.
    const etag = part.headers.get('etag');
    assert.ok(etag);
    const revalidated = await fetch(url(variant.storageKey), {
      headers: { 'If-None-Match': etag },
    });
    assert.equal(revalidated.status, 304);
    assert.equal(await revalidated.text(), '');
    const invalid = await fetch(url(variant.storageKey), {
      headers: { Range: 'bytes=10-' },
    });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get('content-range'), 'bytes */10');
    assert.equal((await fetch(url('../escape'))).status, 404);
    assert.equal((await fetch(url('unregistered'))).status, 404);
    for (const restriction of ['asset', 'post', 'parent']) {
      asset.adminArchivedAt = restriction === 'asset' ? new Date() : null;
      showcase.adminArchivedAt = restriction === 'post' ? new Date() : null;
      restrictedParent = restriction === 'parent';
      for (const cookie of ['', 'matjary_session=owner']) {
        assert.equal(
          (
            await fetch(url(variant.storageKey), {
              headers: { Cookie: cookie },
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await fetch(url(asset.originalKey!), {
              headers: { Cookie: cookie },
            })
          ).status,
          404,
        );
      }
      const preview = await fetch(url(variant.storageKey), {
        headers: { Cookie: 'matjary_session=admin' },
      });
      assert.equal(preview.status, 200);
      assert.equal(preview.headers.get('cache-control'), 'private, no-store');
      assert.equal(await preview.text(), bytes.toString());
    }
    asset.adminArchivedAt = null;
    showcase.adminArchivedAt = null;
    restrictedParent = false;
    assert.equal((await fetch(url(variant.storageKey))).status, 200);
    config.set('STORAGE_PROVIDER', 's3');
    assert.equal((await fetch(url(variant.storageKey))).status, 404);
    assert.equal((await upload()).status, 404);
  } finally {
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function encodingOptions(
  overrides: Partial<EncodingOptions> = {},
): EncodingOptions {
  return {
    limits: {
      maxBytes: 209715200,
      maxPixels: 40000000,
      maxWidth: 1920,
      maxHeight: 1080,
      maxDurationSeconds: 90,
    },
    signal: AbortSignal.timeout(60000),
    deadline: Date.now() + 60000,
    ffmpeg: 'ffmpeg',
    ffprobe: 'ffprobe',
    ...overrides,
  };
}

test('images auto-orient, strip EXIF and report real dimensions without upscaling', async () => {
  const directory = await tempDirectory();
  try {
    const input = path.join(directory, 'input.jpg');
    await sharp({
      create: { width: 80, height: 40, channels: 3, background: '#a04080' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toFile(input);
    await validateSignature(input, 'image/jpeg');
    const result = await encodeImage(input, directory, encodingOptions());
    assert.equal(result.width, 40);
    assert.equal(result.height, 80);
    assert.equal(result.variants.length, 9);
    for (const variant of result.variants) {
      const info = await sharp(variant.file).metadata();
      assert.equal(info.width, variant.width);
      assert.equal(info.height, variant.height);
      assert.equal(info.width, 40);
      assert.equal(info.height, 80);
      assert.equal(info.orientation, undefined);
      assert.equal(info.exif, undefined);
      assert.equal(
        String((await fs.stat(variant.file)).size),
        variant.sizeBytes,
      );
    }
    await assert.rejects(
      encodeImage(
        input,
        directory,
        encodingOptions({
          limits: { ...encodingOptions().limits, maxPixels: 1 },
        }),
      ),
      InvalidMediaError,
    );
    await fs.writeFile(input, 'MZ executable content');
    await assert.rejects(
      validateSignature(input, 'image/jpeg'),
      InvalidMediaError,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('share cards compose a branded 1200x630 JPEG from a shop logo', async () => {
  const directory = await tempDirectory();
  try {
    const input = path.join(directory, 'logo.png');
    await sharp({
      create: {
        width: 320,
        height: 320,
        channels: 4,
        background: { r: 240, g: 90, b: 40, alpha: 1 },
      },
    })
      .png()
      .toFile(input);
    const card = await encodeShareCard(input, directory, {
      background: '#994a2c',
      signal: AbortSignal.timeout(30000),
      deadline: Date.now() + 30000,
    });
    assert.equal(card.mimeType, 'image/jpeg');
    assert.equal(card.width, 1200);
    assert.equal(card.height, 630);
    const info = await sharp(card.file).metadata();
    assert.equal(info.format, 'jpeg');
    assert.equal(info.width, 1200);
    assert.equal(info.height, 630);
    assert.equal(String((await fs.stat(card.file)).size), card.sizeBytes);
    assert.ok(Number(card.sizeBytes) > 5000);
    await assert.rejects(
      encodeShareCard(path.join(directory, 'missing.png'), directory, {
        background: '#994a2c',
        signal: AbortSignal.timeout(5000),
        deadline: Date.now() + 5000,
      }),
      InvalidMediaError,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('share cards keep a light logo visible on a contrasting plate', async () => {
  const directory = await tempDirectory();
  try {
    const input = path.join(directory, 'white-logo.png');
    await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toFile(input);
    const card = await encodeShareCard(input, directory, {
      background: '#994a2c',
      signal: AbortSignal.timeout(30000),
      deadline: Date.now() + 30000,
    });
    const { data, info } = await sharp(card.file)
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Inside the rounded plate but outside the centered logo: white-on-white
    // artwork used to leave this area white, so the card looked empty.
    const offset = (130 * info.width + 360) * (info.channels ?? 3);
    const [red = 0, green = 0, blue = 0] = [
      data[offset] ?? 0,
      data[offset + 1] ?? 0,
      data[offset + 2] ?? 0,
    ];
    assert.ok(red + green + blue < 200, `${red},${green},${blue}`);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('missing share cards retry after failures without overlapping sweeps or restarting', async (t) => {
  const processor = new MediaProcessor(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const jobs = processor as unknown as {
    retryShareCards(): void;
    backfillShareCards(): Promise<void>;
    shareCardBackfill?: Promise<void>;
  };
  let passes = 0;
  let release!: () => void;
  t.mock.method(jobs, 'backfillShareCards', async () => {
    passes++;
    if (passes === 1) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      throw new Error('temporary failure');
    }
  });
  jobs.retryShareCards();
  jobs.retryShareCards();
  assert.equal(passes, 1);
  release();
  await jobs.shareCardBackfill;
  jobs.retryShareCards();
  await jobs.shareCardBackfill;
  assert.equal(passes, 2);
  await processor.beforeApplicationShutdown();
  jobs.retryShareCards();
  assert.equal(passes, 2);
});

test('share card publication updates the media fingerprint only after upload succeeds', async () => {
  const directory = await tempDirectory();
  try {
    const input = path.join(directory, 'logo.png');
    await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#204030' },
    })
      .png()
      .toFile(input);
    const events: string[] = [];
    let fail = false;
    const processor = new MediaProcessor(
      {
        manager: {
          findOneBy: async () => ({ id: 'store-1', brandColor: '#204030' }),
        },
        update: async (_where: unknown, changes: { updatedAt: Date }) => {
          assert.ok(changes.updatedAt instanceof Date);
          events.push('timestamp');
        },
      } as never,
      {} as never,
      {} as never,
      {
        uploadFile: async () => {
          if (fail) throw new Error('storage unavailable');
          events.push('upload');
        },
      } as never,
      {} as never,
    );
    const job = processor as unknown as {
      generateShareCard(
        storeId: string,
        assetId: string,
        input: string,
        directory: string,
        signal: AbortSignal,
        deadline: number,
      ): Promise<void>;
    };
    const run = () =>
      job.generateShareCard(
        'store-1',
        'asset-1',
        input,
        directory,
        AbortSignal.timeout(30_000),
        Date.now() + 30_000,
      );
    await run();
    assert.deepEqual(events, ['upload', 'timestamp']);
    fail = true;
    await run();
    assert.deepEqual(events, ['upload', 'timestamp']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('share card keys derive from the logo asset', () => {
  const storeId = '11111111-1111-4111-8111-111111111111';
  const assetId = '22222222-2222-4222-8222-222222222222';
  assert.equal(
    mediaAssetIdFromKey(`media/${storeId}/${assetId}/jpeg-1600.jpg`),
    assetId,
  );
  assert.equal(mediaAssetIdFromKey('image-key'), null);
  assert.equal(mediaAssetIdFromKey(null), null);
  assert.equal(
    storeShareCardKey(storeId, assetId),
    `og/store/${storeId}/${assetId}.jpg`,
  );
});

test('FFmpeg smoke: valid MP4/poster, overlong rejection and bounded deadlines', async (t) => {
  if (
    spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status !== 0 ||
    spawnSync('ffprobe', ['-version'], { windowsHide: true }).status !== 0
  ) {
    t.skip('FFmpeg/ffprobe unavailable');
    return;
  }
  const directory = await tempDirectory();
  try {
    const input = path.join(directory, 'input.mp4');
    await promisify(execFile)(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=160x90:d=2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-threads',
        '1',
        '-y',
        input,
      ],
      { timeout: 15000, windowsHide: true },
    );
    await validateSignature(input, 'video/mp4');
    const result = await encodeVideo(input, directory, encodingOptions());
    assert.equal(result.variants.length, 2);
    assert.equal(result.variants[0]!.width, 160);
    assert.equal(result.variants[0]!.height, 90);
    assert.ok(result.durationMs! >= 1900 && result.durationMs! <= 2100);
    await assert.rejects(
      encodeVideo(
        input,
        directory,
        encodingOptions({
          limits: { ...encodingOptions().limits, maxDurationSeconds: 1 },
        }),
      ),
      InvalidMediaError,
    );
    await assert.rejects(
      encodeVideo(
        input,
        directory,
        encodingOptions({ deadline: Date.now() - 1 }),
      ),
      /deadline/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function storySubscription(
  ownerId: string,
  limits: Record<string, unknown>,
  slug = 'basic',
) {
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
    // The free plan is a trial, so it needs a bounded window to be effective.
    expiresAt: slug === 'free' ? new Date(Date.now() + 3_600_000) : null,
    plan,
  });
}

test('story uploads accept video, cap the duration at 30s and count live slots', async () => {
  const ownerId = 'owner';
  const storeId = '11111111-1111-4111-8111-111111111111';
  const store = Object.assign(new Store(), {
    id: storeId,
    ownerId,
    status: StoreStatus.ACTIVE,
    adminArchivedAt: null,
  });
  let live = 1;
  let pending = 0;
  let limits: Record<string, unknown> = {
    maxStories: 2,
    maxVideoDurationSeconds: 60,
    maxVideoSizeBytes: 50_000_000,
  };
  let planSlug = 'basic';
  const created: MediaAsset[] = [];
  const manager = {
    findOneOrFail: async (target: unknown) =>
      target === User ? { id: ownerId, suspendedAt: null } : {},
    findOneBy: async (target: unknown) => (target === Store ? store : null),
    count: async () => live,
    create: (_target: unknown, value: Partial<MediaAsset>) =>
      Object.assign(new MediaAsset(), value),
    save: async (value: MediaAsset) => {
      created.push(value);
      return value;
    },
    getRepository: (target: unknown) => {
      if (target === UserSubscription)
        return {
          find: async () => [storySubscription(ownerId, limits, planSlug)],
        };
      const builder = {
        where: () => builder,
        andWhere: () => builder,
        getCount: async () => pending,
      };
      return { createQueryBuilder: () => builder };
    },
    transaction: async (work: (entityManager: unknown) => Promise<unknown>) =>
      work(manager),
  };
  const media = new MediaService(
    {} as never,
    {} as never,
    { manager } as never,
    { presignedPutUrl: async () => ({ url: '/api/v1/uploads/key' }) } as never,
    {} as never,
    configuration('.tmp'),
  );
  const dto = {
    targetId: storeId,
    purpose: 'store_story' as const,
    fileName: 'clip.mp4',
    fileType: 'video/mp4',
    fileSize: 1000,
    kind: MediaKind.VIDEO,
  };
  await media.negotiate(dto, ownerId);
  const asset = created.at(-1)!;
  assert.equal(asset.storeId, storeId);
  assert.equal(asset.purpose, 'store_story');
  assert.equal(
    asset.processingLimits?.maxDurationSeconds,
    30,
    'the platform story ceiling wins over a longer plan limit',
  );

  live = 1;
  pending = 1;
  await assert.rejects(media.negotiate(dto, ownerId), ConflictException);

  live = 2;
  pending = 0;
  await assert.rejects(media.negotiate(dto, ownerId), ConflictException);

  live = 0;
  limits = { maxStories: 0 };
  planSlug = 'free';
  await assert.rejects(media.negotiate(dto, ownerId), ConflictException);

  // Branding stays image-only; only stories accept video.
  live = 0;
  limits = { maxStories: 2 };
  planSlug = 'basic';
  await assert.rejects(
    media.negotiate({ ...dto, purpose: 'store_logo' }, ownerId),
    BadRequestException,
  );
});

test('story media is public only while its story is live', async () => {
  const store = Object.assign(new Store(), {
    id: 'store',
    ownerId: 'owner',
    status: StoreStatus.ACTIVE,
    adminArchivedAt: null,
    logoKey: null,
    bannerKey: null,
  });
  const asset = Object.assign(new MediaAsset(), {
    id: 'asset',
    showcaseId: null,
    storeId: store.id,
    productId: null,
    purpose: 'store_story',
    kind: MediaKind.IMAGE,
    status: MediaStatus.READY,
    adminArchivedAt: null,
  });
  const variant = Object.assign(new MediaVariant(), {
    asset,
    assetId: asset.id,
    storageKey: 'story-image',
    mimeType: 'image/webp',
  });
  let live = true;
  const manager = {
    findOne: async (
      _target: unknown,
      options: { where: { storageKey?: string } },
    ) => (options.where.storageKey === variant.storageKey ? variant : null),
    findOneBy: async (target: unknown) => (target === Store ? store : null),
    exists: async (target: unknown) => target === StoreStory && live,
    getRepository: () => ({ findOne: async () => variant }),
  } as unknown as EntityManager;
  const media = new MediaService(
    {} as never,
    {} as never,
    { manager, findOne: async () => null } as never,
    {} as never,
    {} as never,
    configuration('.tmp'),
  );
  assert.equal((await media.authorizeDownload('story-image')).public, true);
  live = false;
  await assert.rejects(
    media.authorizeDownload('story-image'),
    NotFoundException,
  );
  assert.deepEqual(await media.authorizeDownload('story-image', 'owner'), {
    mimeType: 'image/webp',
    public: false,
  });
});
