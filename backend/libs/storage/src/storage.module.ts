import { Module } from '@nestjs/common';
import { ConfigurationModule } from '@app/config';
import { StorageService } from './storage.service';
import { LocalStorageProvider } from './providers/local.storage.provider';
import { S3StorageProvider } from './providers/s3.storage.provider';

// StorageService picks the active provider (S3 or local disk) from
// STORAGE_PROVIDER and delegates every storage call to it.
@Module({
  imports: [ConfigurationModule],
  providers: [StorageService, LocalStorageProvider, S3StorageProvider],
  exports: [StorageService],
})
export class StorageModule {}
