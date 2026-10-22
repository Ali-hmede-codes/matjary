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

// Presigned URLs are valid for 15 minutes by default. Long enough for a
// browser or mobile client to finish an upload, short enough to limit abuse.
const PRESIGNED_URL_TTL_SECONDS = 900;

// Allowed MIME types for direct uploads. No executable or script types.
const ALLOWED_IMAGE_PREFIXES = ['image/'];
const ALLOWED_VIDEO_PREFIXES = ['video/'];

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<AppEnvironment, true>) {
    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    const region = config.get('S3_REGION', { infer: true });
    this.bucket = config.get('S3_BUCKET', { infer: true });

    // S3 is optional until media upload is wired up. When no endpoint or
    // bucket is configured, the client is left uninitialized and every
    // presigned URL call throws a sanitized ServiceUnavailableException.
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

  /**
   * Generate a presigned PUT URL for a direct client-to-object-storage upload.
   * Returns the URL and the object key the client must use as the PUT target.
   */
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

  /**
   * Generate a presigned GET URL for downloading or viewing an object.
   * Used for serving processed media variants to clients.
   */
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

  /**
   * Download an object from object storage as a Buffer.
   * Used by the worker to fetch the original media for processing.
   */
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

  /**
   * Upload an object to object storage.
   * Used by the worker to store processed media variants.
   */
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

  /**
   * Delete an object from object storage.
   * Used to remove the original upload after processing is complete.
   */
  async deleteObject(key: string): Promise<void> {
    const client = this.requireClient();
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await client.send(command);
  }
}

export { ALLOWED_IMAGE_PREFIXES, ALLOWED_VIDEO_PREFIXES };
