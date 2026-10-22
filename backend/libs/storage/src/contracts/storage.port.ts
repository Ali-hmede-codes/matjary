/**
 * Storage port: the abstraction the media layer depends on.
 *
 * Two implementations exist:
 *  - S3StorageProvider  -> object storage (Contabo S3, or Cloudflare R2 later)
 *  - LocalStorageProvider -> files written to a directory on this VPS
 *
 * The active provider is chosen with the STORAGE_PROVIDER environment
 * variable, so it can be flipped from S3 to local (or back) by changing
 * config and restarting, without touching any feature code. Object storage
 * is the production recommendation (see infrastructure-contabo-media-v3.md);
 * local is offered for small/self-hosted deployments and local development.
 */
export interface StorageProvider {
  /** Generate a time-limited PUT URL the client uploads to directly. */
  presignedPutUrl(
    key: string,
    mimeType: string,
  ): Promise<{ url: string; key: string }>;
  /** Generate a time-limited GET URL for viewing/downloading an object. */
  presignedGetUrl(key: string): Promise<string>;
  /** Download an object as a Buffer (used by the worker). */
  getObject(key: string): Promise<Buffer>;
  /** Upload an object (used by the local upload route and the worker). */
  putObject(key: string, body: Buffer, mimeType: string): Promise<void>;
  /** Delete an object. */
  deleteObject(key: string): Promise<void>;
  /** Whether this provider is actually configured and usable. */
  isConfigured(): boolean;
}
