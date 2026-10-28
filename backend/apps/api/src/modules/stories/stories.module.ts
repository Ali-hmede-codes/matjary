import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  MediaAsset,
  MediaVariant,
  Product,
  Store,
  StoreCategory,
  StoreStory,
} from '@app/database';
import { StorageModule } from '@app/storage';
import { AuthModule } from '../auth/auth.module';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';

// Stories are public to read and owner-authorized to publish or delete, so the
// module only needs the story rows plus the shop, catalogue, and media tables
// its listings resolve.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StoreStory,
      Store,
      MediaAsset,
      MediaVariant,
      Product,
      StoreCategory,
    ]),
    AuthModule,
    StorageModule,
  ],
  controllers: [StoriesController],
  providers: [StoriesService],
})
export class StoriesModule {}
