// Shared Redis connectivity and BullMQ queue. The API enqueues media
// processing jobs; only the worker consumes them.
export { RedisModule } from './redis.module';
export { RedisService } from './redis.service';
export { QueueModule } from './queue.module';
export { QueueService } from './queue.service';
export type { MediaProcessingJob, EngagementFlushJob } from './queue.service';
export {
  MEDIA_PROCESSING_QUEUE,
  PROCESS_MEDIA_JOB,
  ENGAGEMENT_FLUSH_QUEUE,
  FLUSH_ENGAGEMENT_JOB,
} from './queue.service';
