export { StorageModule } from './storage.module';
export { StorageService } from './storage.service';
export {
  MediaArchiveService,
  type ArchiveEntry,
  type ArchiveManifest,
  type RestoreOutcome,
} from './archive/media-archive.service';
export { S3StorageProvider } from './providers/s3.storage.provider';
export { LocalStorageProvider } from './providers/local.storage.provider';
export {
  mediaAssetIdFromKey,
  storeBrandCardKey,
  storeBrandCardVersion,
  storeShareCardKey,
} from './share-card-key';
export type { StorageProvider } from './contracts/storage.port';
