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
} from '@app/database';
import { MediaProcessor } from './jobs/media.process';
import { MediaRecovery } from './jobs/media.recovery';
import { EngagementFlusher } from './jobs/engagement.flush';
import { WorkerHeartbeat } from './worker-heartbeat';

// Queue consumers belong in jobs/; encoding must stay outside the API process.
// StorageModule (StorageService), QueueModule (QueueService), and the TypeORM
// repositories for MediaAsset/MediaVariant are all needed by MediaProcessor.
// Showcase/PostEngagement/PostLike are needed by EngagementFlusher for the
// async Redis-to-MySQL engagement flush.
@Module({
  imports: [
    ConfigurationModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    StorageModule,
    TypeOrmModule.forFeature([
      MediaAsset,
      MediaVariant,
      Showcase,
      PostEngagement,
      PostLike,
    ]),
  ],
  providers: [MediaProcessor, MediaRecovery, EngagementFlusher, WorkerHeartbeat],
})
export class WorkerModule {}
