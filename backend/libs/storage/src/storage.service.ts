import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import type { StorageProvider } from './contracts/storage.port';
import { LocalStorageProvider } from './providers/local.storage.provider';
import { S3StorageProvider } from './providers/s3.storage.provider';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ByteLimit } from './bounded-stream';

type StorageProviderKind = 's3' | 'local';

/**
 * StorageService picks one StorageProvider based on STORAGE_PROVIDER and
 * delegates every call to it. Flipping STORAGE_PROVIDER between 's3' and
 * 'local' (and restarting) moves media between object storage and this VPS's
 * disk without touching any feature code.
 */
@Injectable()
export class StorageService implements StorageProvider, OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private provider: StorageProvider;

  constructor(private readonly config: ConfigService<AppEnvironment, true>) {
    this.provider = this.buildProvider();
  }

  onModuleInit(): void {
    this.logger.log(
      `Storage provider: ${this.provider.constructor.name} (${
        this.provider.isConfigured() ? 'configured' : 'not configured'
      })`,
    );
  }

  private buildProvider(): StorageProvider {
    const kind = (this.config.get('STORAGE_PROVIDER', { infer: true }) ||
      'local') as StorageProviderKind;
    if (kind === 'local') {
      return new LocalStorageProvider(this.config);
    }
    return new S3StorageProvider(this.config);
  }

  async presignedPutUrl(
    key: string,
    mimeType: string,
    size?: number,
  ): Promise<{ url: string; key: string }> {
    try {
      return await this.provider.presignedPutUrl(key, mimeType, size);
    } catch (error) {
      this.sanitize(error);
    }
  }

  async presignedGetUrl(key: string): Promise<string> {
    try {
      return await this.provider.presignedGetUrl(key);
    } catch (error) {
      this.sanitize(error);
    }
  }

  async getObject(key: string): Promise<Buffer> {
    try {
      return await this.provider.getObject(key);
    } catch (error) {
      this.sanitize(error);
    }
  }

  async putObject(key: string, body: Buffer, mimeType: string): Promise<void> {
    try {
      await this.provider.putObject(key, body, mimeType);
    } catch (error) {
      this.sanitize(error);
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.provider.deleteObject(key);
    } catch (error) {
      this.sanitize(error);
    }
  }

  isConfigured(): boolean {
    return this.provider.isConfigured();
  }

  /** Expose the underlying provider when feature code needs provider-specific behavior. */
  getProvider(): StorageProvider {
    return this.provider;
  }

  async statObject(key: string): Promise<{ size: number }> {
    try {
      return await this.provider.statObject(key);
    } catch (error) {
      this.sanitize(error);
    }
  }

  async openReadStream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<Readable> {
    try {
      return await this.provider.openReadStream(key, range);
    } catch (error) {
      this.sanitize(error);
    }
  }

  async putStream(
    key: string,
    body: Readable,
    mimeType: string,
    size: number,
    options: { exclusive?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    try {
      await this.provider.putStream(key, body, mimeType, size, options);
    } catch (error) {
      this.sanitize(error);
    }
  }

  async downloadToFile(
    key: string,
    file: string,
    maximum: number,
    signal: AbortSignal,
  ): Promise<void> {
    const source = await this.openReadStream(key);
    try {
      await pipeline(
        source,
        new ByteLimit(maximum),
        createWriteStream(file, { flags: 'wx', mode: 0o600 }),
        { signal },
      );
    } catch (error) {
      this.sanitize(error);
    }
  }

  async uploadFile(
    key: string,
    file: string,
    mimeType: string,
    signal: AbortSignal,
  ): Promise<void> {
    const { size } = await fs.stat(file);
    await this.putStream(key, createReadStream(file), mimeType, size, {
      signal,
    });
  }

  private sanitize(error: unknown): never {
    if (error instanceof HttpException) throw error;
    // Never leak raw driver errors, endpoints, or credentials in responses.
    throw new ServiceUnavailableException(
      'Media storage is temporarily unavailable',
    );
  }
}
