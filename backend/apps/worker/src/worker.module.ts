import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigurationModule } from '@app/config';
import { DatabaseModule } from '@app/database';
import { QueueModule, RedisModule } from '@app/queue';
import { StorageModule } from '@app/storage';
import {
  MediaAsset,
  MediaVariant,
  Showcase,
  PostEngagement,
  PostLike,
  Store,
  StoreStory,
} from '@app/database';
import { MediaProcessor } from './jobs/media.process';
import { MediaRecovery } from './jobs/media.recovery';
import { StorySweeper } from './jobs/story.sweeper';
import { ShopMediaArchiver } from './jobs/shop.archive';
import { TrialShopPurger } from './jobs/trial.purge';
import { EngagementFlusher } from './jobs/engagement.flush';
import { WorkerHeartbeat } from './worker-heartbeat';
import { ObservabilityModule } from '@app/observability';

// Queue consumers belong in jobs/; encoding must stay outside the API process.
// StorageModule (StorageService), QueueModule (QueueService), and the TypeORM
// repositories for MediaAsset/MediaVariant are all needed by MediaProcessor.
// Showcase/PostEngagement/PostLike are needed by EngagementFlusher for the
// async Redis-to-MySQL engagement flush.
@Module({
  imports: [
    ConfigurationModule,
    DatabaseModule,
    ObservabilityModule.forWorker(),
    RedisModule,
    QueueModule,
    StorageModule,
    TypeOrmModule.forFeature([
      MediaAsset,
      MediaVariant,
      Showcase,
      PostEngagement,
      PostLike,
      StoreStory,
      // Store rows drive the locked-shop media archive pass.
      Store,
    ]),
  ],
  providers: [
    MediaProcessor,
    MediaRecovery,
    StorySweeper,
    ShopMediaArchiver,
    TrialShopPurger,
    EngagementFlusher,
    WorkerHeartbeat,
  ],
})
export class WorkerModule {}
