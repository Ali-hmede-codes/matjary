import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageProvider } from '../contracts/storage.port';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ByteLimit } from '../bounded-stream';

// Presigned URLs are valid for 15 minutes by default. Long enough for a
// browser or mobile client to finish an upload, short enough to limit abuse.
const PRESIGNED_URL_TTL_SECONDS = 900;

@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly logger = new Logger(S3StorageProvider.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<AppEnvironment, true>) {
    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    const region = config.get('S3_REGION', { infer: true });
    this.bucket = config.get('S3_BUCKET', { infer: true });

    // S3 is optional until media upload is wired up. When no endpoint or
    // bucket is configured, the client is left uninitialized and every call
    // throws a sanitized ServiceUnavailableException.
    if (!endpoint || !this.bucket) {
      this.client = undefined as unknown as S3Client;
      return;
    }

    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
      },
    });
  }

  private requireClient(): S3Client {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException('Media storage is not configured');
    }
    return this.client;
  }

  async presignedPutUrl(
    key: string,
    mimeType: string,
    size?: number,
  ): Promise<{ url: string; key: string }> {
    const client = this.requireClient();
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
      ContentLength: size,
      IfNoneMatch: '*',
    });
    const url = await getSignedUrl(client, command, {
      expiresIn: PRESIGNED_URL_TTL_SECONDS,
    });
    return { url, key };
  }

  async presignedGetUrl(key: string): Promise<string> {
    const client = this.requireClient();
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(client, command, {
      expiresIn: PRESIGNED_URL_TTL_SECONDS,
    });
  }

  async statObject(key: string): Promise<{ size: number }> {
    try {
      const response = await this.requireClient().send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: AbortSignal.timeout(30000) });
      if (!Number.isSafeInteger(response.ContentLength) || response.ContentLength! < 0) throw new BadRequestException('Invalid stored media');
      return { size: response.ContentLength! };
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) throw new NotFoundException('Stored file not found');
      throw error;
    }
  }

  async openReadStream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const response = await this.requireClient().send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range ? `bytes=${range.start}-${range.end}` : undefined }), { abortSignal: AbortSignal.timeout(30000) });
    if (!(response.Body instanceof Readable)) throw new ServiceUnavailableException('Media storage is temporarily unavailable');
    return response.Body;
  }

  async putStream(key: string, body: Readable, mimeType: string, size: number, options: { exclusive?: boolean; signal?: AbortSignal } = {}): Promise<void> {
    const limited = new ByteLimit(size, true);
    const transfer = pipeline(body, limited, { signal: options.signal });
    try {
      await Promise.all([transfer, this.requireClient().send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: limited, ContentType: mimeType, ContentLength: size, IfNoneMatch: options.exclusive ? '*' : undefined }), { abortSignal: options.signal })]);
    } finally {
      limited.destroy();
      body.destroy();
      await transfer.catch(() => undefined);
    }
  }

  async getObject(key: string): Promise<Buffer> {
    const { size } = await this.statObject(key);
    if (size > 10485760) throw new BadRequestException('Use streaming for large media');
    const source = await this.openReadStream(key);
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for await (const chunk of source) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 10485760) throw new BadRequestException('Media exceeds the size limit');
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } finally { source.destroy(); }
  }

  async putObject(key: string, body: Buffer, mimeType: string): Promise<void> {
    const client = this.requireClient();
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
    });
    await client.send(command);
  }

  async deleteObject(key: string): Promise<void> {
    const client = this.requireClient();
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await client.send(command);
  }

  isConfigured(): boolean {
    return Boolean(this.client && this.bucket);
  }
}
