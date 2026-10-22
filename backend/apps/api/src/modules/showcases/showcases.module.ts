import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShowcasesController } from './showcases.controller';
import { ShowcasesService } from './showcases.service';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { PostEngagementController } from './engagement/post-engagement.controller';
import { PostEngagementService } from './engagement/post-engagement.service';
import { FeedExploreController } from './feed-explore.controller';
import { FeedExploreService } from './services/feed-explore.service';
import {
  Showcase,
  Store,
  MediaAsset,
  MediaVariant,
  PostEngagement,
  PostLike,
} from '@app/database';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '@app/storage';
import { QueueModule, RedisModule } from '@app/queue';
import { StoresModule } from '../stores/stores.module';
import { SeoModule } from '../seo/seo.module';

// Reserved for showcase content, publishing, and cache-friendly public reads.
// Public read endpoints let visitors browse posts without signing in.
// Mutations require an authenticated session and ownership of the post.
// Import AuthModule so its guards (SessionGuard, AuthOriginGuard,
// AuthRateLimitGuard) are injectable into ShowcasesController.
// StorageModule provides S3Service for presigned media uploads.
// QueueModule provides QueueService for enqueuing media processing jobs.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Showcase,
      Store,
      MediaAsset,
      MediaVariant,
      PostEngagement,
      PostLike,
    ]),
    AuthModule,
    StorageModule,
    QueueModule,
    RedisModule,
    StoresModule, // For LocationService
    SeoModule, // For SEO auto-generation
  ],
  controllers: [
    ShowcasesController,
    MediaController,
    PostEngagementController,
    FeedExploreController,
  ],
  providers: [
    ShowcasesService,
    MediaService,
    PostEngagementService,
    FeedExploreService,
  ],
  exports: [ShowcasesService, FeedExploreService],
})
export class ShowcasesModule {}
