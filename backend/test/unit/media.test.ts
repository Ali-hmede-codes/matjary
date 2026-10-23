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
  MediaKind,
  MediaStatus,
  ShowcaseStatus,
} from '../../libs/database/src/entities';
import { MediaService } from '../../apps/api/src/modules/showcases/media.service';
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
  encodeVideo,
  validateSignature,
  InvalidMediaError,
  type EncodingOptions,
} from '../../libs/media-processing/src/encode';

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
      findOneBy: async () => ({
        id: 'admin',
        email: 'admin@example.test',
        suspendedAt: null,
      }),
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
      'public, max-age=0, must-revalidate',
    );
    assert.equal(await part.text(), '2345');
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
