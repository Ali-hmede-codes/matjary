import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ByteLimit } from '../bounded-stream';
import path from 'path';
import type { StorageProvider } from '../contracts/storage.port';

/**
 * Local-disk storage provider. Writes media files to a directory on this VPS
 * instead of object storage.
 *
 * Trade-off (documented): unlike S3, media bytes flow through the API process
 * for both uploads (PUT /api/v1/uploads/:key) and serving (GET /api/v1/uploads/:key),
 * so this provider is best suited to small or self-hosted deployments. For a
 * many-visitor showcase, object storage (S3StorageProvider) is the
 * production recommendation.
 */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly root: string;
  private readonly publicBase: string;

  constructor(config: ConfigService<AppEnvironment, true>) {
    const dir = config.get('STORAGE_LOCAL_DIR', { infer: true }) || 'storage';
    // Resolve relative to the backend working directory so deployments and the
    // CLI agree on where media lives regardless of the current working dir.
    this.root = path.resolve(dir);
    this.publicBase =
      config.get('STORAGE_PUBLIC_BASE_URL', { infer: true }) || config.get('APP_ORIGIN', { infer: true });
  }

  private async filePath(key: string, create = false): Promise<string> {
    const segments = key.split('/');
    if (!key || key.length > 512 || !/^[a-zA-Z0-9_./-]+$/.test(key) || segments.some((part) => !part || part === '.' || part === '..')) {
      throw new BadRequestException('Invalid storage key');
    }
    const file = path.resolve(this.root, ...segments);
    const relative = path.relative(this.root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new BadRequestException('Invalid storage key');
    if (create) await fs.mkdir(this.root, { recursive: true });
    const rootInfo = await fs.lstat(this.root);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory() || path.relative(await fs.realpath(this.root), this.root) !== '') throw new BadRequestException('Invalid storage directory');
    let current = this.root;
    for (let i = 0; i < segments.length; i++) {
      current = path.join(current, segments[i]!);
      try {
        const entry = await fs.lstat(current);
        if (entry.isSymbolicLink() || (i < segments.length - 1 && !entry.isDirectory())) throw new BadRequestException('Invalid storage key');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (create && i < segments.length - 1) {
          await fs.mkdir(current).catch((mkdirError: NodeJS.ErrnoException) => { if (mkdirError.code !== 'EEXIST') throw mkdirError; });
          const entry = await fs.lstat(current);
          if (entry.isSymbolicLink() || !entry.isDirectory()) throw new BadRequestException('Invalid storage key');
        }
      }
    }
    return file;
  }

  async statObject(key: string): Promise<{ size: number }> {
    try {
      const stat = await fs.stat(await this.filePath(key));
      if (!stat.isFile()) throw new NotFoundException('Stored file not found');
      return { size: stat.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundException('Stored file not found');
      throw error;
    }
  }

  async openReadStream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    await this.statObject(key);
    return createReadStream(await this.filePath(key), range);
  }

  async putStream(key: string, body: Readable, _mimeType: string, size: number, options: { exclusive?: boolean; signal?: AbortSignal } = {}): Promise<void> {
    const file = await this.filePath(key, true);
    const temporary = path.join(path.dirname(file), `.${randomUUID()}.upload`);
    try {
      await pipeline(body, new ByteLimit(size, true), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal: options.signal });
      // Hard-link creation is atomic and cannot overwrite another upload.
      if (options.exclusive) await fs.link(temporary, file);
      else await fs.rename(temporary, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ConflictException('Media has already been uploaded');
      throw error;
    } finally {
      await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    }
  }

  async presignedPutUrl(key: string): Promise<{ url: string; key: string }> {
    // For local storage there is no object-storage signed URL; the client PUTs
    // the bytes straight to the API's local upload route.
    if (!this.publicBase) {
      throw new ServiceUnavailableException(
        'Local storage public base URL is not configured',
      );
    }
    const url = `${this.publicBase.replace(/\/$/, '')}/api/v1/uploads/${encodeURIComponent(key)}`;
    return { url, key };
  }

  async presignedGetUrl(key: string): Promise<string> {
    if (!this.publicBase) {
      throw new ServiceUnavailableException(
        'Local storage public base URL is not configured',
      );
    }
    return `${this.publicBase.replace(/\/$/, '')}/api/v1/uploads/${encodeURIComponent(key)}`;
  }

  async getObject(key: string): Promise<Buffer> {
    const file = await this.filePath(key);
    try {
      if ((await this.statObject(key)).size > 10485760) throw new BadRequestException('Use streaming for large media');
      return await fs.readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('Stored file not found');
      }
      throw new ServiceUnavailableException('Local storage read failed');
    }
  }

  async putObject(key: string, body: Buffer, mimeType: string): Promise<void> {
    await this.putStream(key, Readable.from(body), mimeType, body.length);
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await fs.unlink(await this.filePath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new ServiceUnavailableException('Local storage delete failed');
      }
    }
  }

  isConfigured(): boolean {
    return Boolean(this.root);
  }
}
