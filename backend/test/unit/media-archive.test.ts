import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../../libs/config/src/environment';
import { MediaArchiveService } from '../../libs/storage/src/archive/media-archive.service';
import type { StorageService } from '../../libs/storage/src/storage.service';

const configWith = (values: Record<string, unknown>) =>
  ({
    get: (key: string) => values[key],
  }) as unknown as ConfigService<AppEnvironment, true>;

// Mirrors the provider contract the archive relies on. Bytes stay in memory so
// the test can prove exactly what moved and what was left behind.
class FakeStorage {
  readonly objects = new Map<string, Buffer>();
  readonly deletes: string[] = [];
  async statObject(key: string): Promise<{ size: number }> {
    const body = this.objects.get(key);
    if (!body) throw new NotFoundException('Stored file not found');
    return { size: body.length };
  }
  async openReadStream(key: string): Promise<Readable> {
    const body = this.objects.get(key);
    if (!body) throw new NotFoundException('Stored file not found');
    return Readable.from([body]);
  }
  async putStream(
    key: string,
    body: Readable,
    _mimeType: string,
    size: number,
  ): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    assert.equal(bytes.length, size, 'restored bytes match the stored size');
    this.objects.set(key, bytes);
  }
  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
    this.deletes.push(key);
  }
}

const liveRoot = path.resolve('.tmp', 'archive-live-test');

async function archiveFixture() {
  const root = await fs.mkdtemp(path.resolve('.tmp', 'archive-test-'));
  const live = path.join(root, 'live');
  const archive = path.join(root, 'archive');
  await fs.mkdir(live, { recursive: true });
  await fs.mkdir(archive, { recursive: true });
  const storage = new FakeStorage();
  const service = new MediaArchiveService(
    configWith({
      STORAGE_PROVIDER: 'local',
      STORAGE_LOCAL_DIR: live,
      MEDIA_ARCHIVE_ROOT: archive,
    }),
    storage as unknown as StorageService,
  );
  return { root, archive, storage, service };
}

test('the archive tier is disabled without its own root', () => {
  const service = new MediaArchiveService(
    configWith({
      STORAGE_PROVIDER: 'local',
      STORAGE_LOCAL_DIR: liveRoot,
      MEDIA_ARCHIVE_ROOT: '',
    }),
    new FakeStorage() as unknown as StorageService,
  );
  assert.equal(service.isConfigured(), false);
  // The same directory would move bytes nowhere.
  const sameRoot = new MediaArchiveService(
    configWith({
      STORAGE_PROVIDER: 'local',
      STORAGE_LOCAL_DIR: liveRoot,
      MEDIA_ARCHIVE_ROOT: liveRoot,
    }),
    new FakeStorage() as unknown as StorageService,
  );
  assert.equal(sameRoot.isConfigured(), false);
});

test('archiving moves verified bytes and restoring returns them unchanged', async () => {
  const { root, storage, service } = await archiveFixture();
  try {
    const key = 'media/store/asset/avif-480.avif';
    const bytes = Buffer.from('original-quality-bytes');
    storage.objects.set(key, bytes);
    assert.equal(service.isConfigured(), true);

    const entry = await service.archiveObject('store-1', key);
    assert.ok(entry);
    assert.equal(entry.sizeBytes, bytes.length);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    // The live copy is gone only after the archive copy exists.
    assert.equal(storage.objects.has(key), false);
    assert.deepEqual(storage.deletes, [key]);

    await service.writeManifest('store-1', [entry]);
    const manifest = await service.readManifest('store-1');
    assert.deepEqual(manifest?.entries, [entry]);
    assert.equal((await service.statObject('store-1', key)).size, bytes.length);

    const restored = await service.restoreObject('store-1', key, entry);
    assert.equal(restored.outcome, 'restored');
    assert.deepEqual(storage.objects.get(key), bytes);
    // The archive copy is removed only after the live bytes verified.
    await assert.rejects(service.statObject('store-1', key), NotFoundException);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a missing live object is treated as already archived, not as a failure', async () => {
  const { root, service } = await archiveFixture();
  try {
    assert.equal(
      await service.archiveObject('store-1', 'media/store/asset/avif-480.avif'),
      null,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a tampered archive copy is reported and kept for inspection', async () => {
  const { root, storage, service } = await archiveFixture();
  try {
    const key = 'media/store/asset/mp4-720.mp4';
    const original = Buffer.from('video-bytes');
    storage.objects.set(key, original);
    const entry = await service.archiveObject('store-1', key);
    assert.ok(entry);
    // Simulate corruption of the archive file.
    const archivedPath = path.join(root, 'archive', 'store-1', 'files', key);
    await fs.writeFile(archivedPath, Buffer.from('corrupted-bytes'));
    const result = await service.restoreObject('store-1', key, entry);
    assert.equal(result.outcome, 'mismatch');
    await fs.stat(archivedPath);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('archive paths reject traversal and foreign store ids', async () => {
  const { root, service } = await archiveFixture();
  try {
    await assert.rejects(
      service.statObject('store-1', '../escaped.avif'),
      /Invalid storage key/,
    );
    await assert.rejects(
      service.statObject('../../etc', 'media/a.avif'),
      NotFoundException,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
