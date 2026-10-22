import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaAsset, MediaVariant } from '@app/database';

// Reserved for signed direct uploads, upload completion, and asset metadata.
// Media bytes go directly to object storage; processing belongs to the worker.
@Module({ imports: [TypeOrmModule.forFeature([MediaAsset, MediaVariant])] })
export class MediaModule {}
