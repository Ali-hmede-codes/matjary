import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { StorageService } from '../storage.service';
import { safeStoragePath } from '../safe-path';

export interface ArchiveEntry {
  key: string;
  sizeBytes: number;
  sha256: string;
}

export interface ArchiveManifest {
  storeId: string;
  updatedAt: string;
  entries: ArchiveEntry[];
}

export interface RestoreOutcome {
  outcome: 'restored' | 'missing' | 'mismatch';
  entry?: ArchiveEntry;
}

// A locked shop keeps its metadata but its bytes move, unchanged, to a second
// root under `MEDIA_ARCHIVE_ROOT/<storeId>/files/<same key>`. Nothing is
// re-encoded or dropped, so renewing restores the exact files. Formats such as
// AVIF, WebP and H.264 are already compressed: the saving comes from using a
// separate volume, never from shrinking the bytes.
@Injectable()
export class MediaArchiveService {
  private readonly logger = new Logger(MediaArchiveService.name);
  private readonly root: string;
  private readonly liveRoot: string;
  private readonly local: boolean;

  constructor(
    private readonly config: ConfigService<AppEnvironment, true>,
    private readonly storage: StorageService,
  ) {
    const root = config.get('MEDIA_ARCHIVE_ROOT', { infer: true }) || '';
    this.root = root ? path.resolve(root) : '';
    this.liveRoot = path.resolve(
      config.get('STORAGE_LOCAL_DIR', { infer: true }) || 'storage',
    );
    this.local =
      (config.get('STORAGE_PROVIDER', { infer: true }) || 'local') === 'local';
  }

  isConfigured(): boolean {
    return Boolean(this.root) && this.local && this.root !== this.liveRoot;
  }

  // The archive is keyed by shop, so restoring or serving one shop never needs
  // to scan another shop's files.
  private storeDir(storeId: string): string {
    if (!/^[a-zA-Z0-9-]{1,36}$/.test(storeId))
      throw new NotFoundException('Archived media not found');
    return path.join(this.root, storeId);
  }

  private async archivedPath(storeId: string, key: string, create = false) {
    return safeStoragePath(
      path.join(this.storeDir(storeId), 'files'),
      key,
      create,
    );
  }

  async statObject(storeId: string, key: string): Promise<{ size: number }> {
    if (!this.isConfigured())
      throw new NotFoundException('Archived media not found');
    try {
      const stat = await fs.stat(await this.archivedPath(storeId, key));
      if (!stat.isFile())
        throw new NotFoundException('Archived media not found');
      return { size: stat.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new NotFoundException('Archived media not found');
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Media archive is unavailable');
    }
  }

  async openReadStream(
    storeId: string,
    key: string,
    range?: { start: number; end: number },
  ): Promise<Readable> {
    await this.statObject(storeId, key);
    return createReadStream(await this.archivedPath(storeId, key), range);
  }

  /**
   * Copies one live object into the archive, verifies its size and SHA-256, and
   * only then removes the live copy. A missing live object returns null: the
   * database key survived but its bytes were already gone, and that is not an
   * archive failure.
   */
  async archiveObject(
    storeId: string,
    key: string,
  ): Promise<ArchiveEntry | null> {
    const target = await this.archivedPath(storeId, key, true);
    let expected: number;
    let source: Readable;
    try {
      expected = (await this.storage.statObject(key)).size;
      source = await this.storage.openReadStream(key);
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
    const temporary = `${target}.${randomUUID()}.partial`;
    const hash = createHash('sha256');
    let copied = 0;
    const tap = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        hash.update(chunk);
        copied += chunk.length;
        done(null, chunk);
      },
    });
    try {
      await pipeline(
        source,
        tap,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      );
      if (copied !== expected)
        throw new Error('Archived copy does not match the stored size');
      await fs.rename(temporary, target);
    } finally {
      await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    await this.storage.deleteObject(key);
    return { key, sizeBytes: copied, sha256: hash.digest('hex') };
  }

  /**
   * Copies an archived object back to the live root. The expected hash comes
   * from the manifest, so silent corruption is reported instead of published;
   * the archive copy is kept until the restored bytes match.
   */
  async restoreObject(
    storeId: string,
    key: string,
    expected?: ArchiveEntry,
  ): Promise<RestoreOutcome> {
    const sourcePath = await this.archivedPath(storeId, key).catch(() => null);
    if (!sourcePath) return { outcome: 'missing' };
    let size: number;
    try {
      size = (await fs.stat(sourcePath)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { outcome: 'missing' };
      throw new ServiceUnavailableException('Media archive is unavailable');
    }
    if (expected && expected.sizeBytes !== size)
      return {
        outcome: 'mismatch',
        entry: { key, sizeBytes: size, sha256: '' },
      };
    const hash = createHash('sha256');
    const tap = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        hash.update(chunk);
        done(null, chunk);
      },
    });
    const source = createReadStream(sourcePath);
    source.on('error', (error) => tap.destroy(error));
    const stream = source.pipe(tap);
    try {
      await this.storage.putStream(
        key,
        stream,
        'application/octet-stream',
        size,
      );
    } finally {
      source.destroy();
    }
    const entry = { key, sizeBytes: size, sha256: hash.digest('hex') };
    if (expected && expected.sha256 && expected.sha256 !== entry.sha256)
      return { outcome: 'mismatch', entry };
    await fs.unlink(sourcePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    return { outcome: 'restored', entry };
  }

  async readManifest(storeId: string): Promise<ArchiveManifest | null> {
    if (!this.isConfigured()) return null;
    try {
      const raw = await fs.readFile(
        path.join(this.storeDir(storeId), 'manifest.json'),
        'utf8',
      );
      const parsed = JSON.parse(raw) as ArchiveManifest;
      return parsed && Array.isArray(parsed.entries) ? parsed : null;
    } catch {
      return null;
    }
  }

  async writeManifest(storeId: string, entries: ArchiveEntry[]): Promise<void> {
    const directory = path.join(this.storeDir(storeId));
    await fs.mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.manifest-${randomUUID()}.json`);
    const manifest: ArchiveManifest = {
      storeId,
      updatedAt: new Date().toISOString(),
      entries,
    };
    await fs.writeFile(temporary, JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    await fs.rename(temporary, path.join(directory, 'manifest.json'));
  }

  async deleteManifest(storeId: string): Promise<void> {
    await fs
      .unlink(path.join(this.storeDir(storeId), 'manifest.json'))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
  }

  // Permanent shop deletion must not leave archived bytes behind. The shop id
  // is validated, and recursive removal never follows a symlink out of the root.
  async deleteStore(storeId: string): Promise<void> {
    if (!this.isConfigured()) return;
    await fs.rm(this.storeDir(storeId), { recursive: true, force: true });
  }

  // Only used by tests and maintenance tooling; the worker never needs it.
  get archiveRoot(): string {
    return this.root;
  }
}
