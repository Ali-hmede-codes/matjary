import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageProvider } from '../contracts/storage.port';

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
  ): Promise<{ url: string; key: string }> {
    const client = this.requireClient();
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
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

  async getObject(key: string): Promise<Buffer> {
    const client = this.requireClient();
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const response = await client.send(command);
    const chunks: Buffer[] = [];
    // eslint-disable-next-line no-restricted-syntax
    for await (const chunk of response.Body as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
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
