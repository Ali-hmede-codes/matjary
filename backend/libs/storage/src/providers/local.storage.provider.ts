import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import { promises as fs } from 'fs';
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
      config.get('STORAGE_PUBLIC_BASE_URL', { infer: true }) || '';
  }

  private filePath(key: string): string {
    // Reject path traversal: keys must not escape the storage root.
    const safeKey = key.replace(/\.\./g, '');
    return path.join(this.root, safeKey);
  }

  private async ensureDir(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
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
    const file = this.filePath(key);
    try {
      return await fs.readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('Stored file not found');
      }
      throw new ServiceUnavailableException('Local storage read failed');
    }
  }

  async putObject(key: string, body: Buffer, mimeType: string): Promise<void> {
    const file = this.filePath(key);
    await this.ensureDir(file);
    await fs.writeFile(file, body);
    // mimeType is stored on disk as metadata only via the key extension;
    // the filesystem does not enforce a content type.
    void mimeType;
  }

  async deleteObject(key: string): Promise<void> {
    const file = this.filePath(key);
    try {
      await fs.unlink(file);
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
