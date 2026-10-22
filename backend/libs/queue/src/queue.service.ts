import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

// BullMQ queue and job names for media processing. The API enqueues jobs;
// only the worker consumes them. BullMQ v5 does not allow ':' in queue names.
export const MEDIA_PROCESSING_QUEUE = 'media-processing';
export const PROCESS_MEDIA_JOB = 'process-media';

// Data enqueued for each media processing job. The worker downloads the
// original object from S3, produces variants, and updates MediaAsset/MediaVariant.
export interface MediaProcessingJob {
  mediaId: string;
  originalKey: string;
  kind: string;
  mimeType: string;
  sizeBytes: string;
}

// Queue and job names for engagement (like/view) flushing. The API enqueues
// flush jobs; only the worker consumes them, so MySQL writes happen in a single
// isolated process and are never duplicated across API nodes.
export const ENGAGEMENT_FLUSH_QUEUE = 'engagement';
export const FLUSH_ENGAGEMENT_JOB = 'flush-engagement';

// Data enqueued for each engagement flush job. When `postIds` is omitted the
// worker flushes every post currently marked dirty in Redis.
export interface EngagementFlushJob {
  postIds?: string[];
  all?: boolean;
}

// Job options tuned for background media encoding: retries with exponential
// backoff, and bounded retention so completed/failed jobs don't grow forever.
const QUEUE_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: 100,
  removeOnFail: 50,
};

// Job options for engagement flushing: lighter retries since flushes are
// idempotent and run frequently.
const ENGAGEMENT_QUEUE_OPTIONS = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 500,
};

@Injectable()
export class QueueService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  private readonly redis: Redis;
  private queue: Queue | null = null;
  private engagementQueue: Queue | null = null;
  private readonly workerConnections: Redis[] = [];

  constructor(config: ConfigService<AppEnvironment, true>) {
    this.redis = new Redis({
      host: config.get('REDIS_HOST', { infer: true }),
      port: config.get('REDIS_PORT', { infer: true }),
      password: config.get('REDIS_PASSWORD', { infer: true }),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      commandTimeout: 5000,
    });
    this.redis.on('error', () =>
      this.logger.warn('Queue connection unavailable'),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.redis.connect();
    this.queue = new Queue(MEDIA_PROCESSING_QUEUE, {
      connection: this.redis,
    });
    this.engagementQueue = new Queue(ENGAGEMENT_FLUSH_QUEUE, {
      connection: this.redis,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.queue?.close(), this.engagementQueue?.close()]);
    for (const connection of this.workerConnections) connection.disconnect();
    this.redis.disconnect();
  }

  createWorkerConnection(): Redis {
    // Blocking consumers must retry indefinitely; API producers must not.
    const connection = this.redis.duplicate({
      maxRetriesPerRequest: null,
      commandTimeout: undefined,
      enableOfflineQueue: true,
      lazyConnect: true,
    });
    connection.on('error', () =>
      this.logger.warn('Worker queue connection unavailable'),
    );
    this.workerConnections.push(connection);
    return connection;
  }

  /**
   * Enqueue a media processing job for the worker. Throws if the queue is not
   * initialized (e.g. Redis is down) so the caller can return a sanitized 503.
   */
  async enqueueMediaProcessing(data: MediaProcessingJob): Promise<void> {
    if (!this.queue) {
      throw new Error('Media processing queue is not initialized');
    }
    await this.queue.add(PROCESS_MEDIA_JOB, data, {
      ...QUEUE_OPTIONS,
      jobId: `media-${data.mediaId}`,
    });
  }

  /**
   * Enqueue an engagement flush job for the worker. The worker writes buffered
   * Redis counters back to MySQL, so the API never writes engagement to MySQL
   * synchronously and never duplicates writes across API nodes.
   */
  async enqueueEngagementFlush(data: EngagementFlushJob): Promise<void> {
    if (!this.engagementQueue) {
      throw new Error('Engagement flush queue is not initialized');
    }
    await this.engagementQueue.add(
      FLUSH_ENGAGEMENT_JOB,
      data,
      ENGAGEMENT_QUEUE_OPTIONS,
    );
  }

  /**
   * Return the underlying BullMQ Queue so the API can enqueue jobs.
   */
  getQueue(): Queue {
    if (!this.queue) {
      throw new Error('Media processing queue is not initialized');
    }
    return this.queue;
  }

  /**
   * Return the engagement flush Queue so the API can enqueue flush jobs.
   */
  getEngagementQueue(): Queue {
    if (!this.engagementQueue) {
      throw new Error('Engagement flush queue is not initialized');
    }
    return this.engagementQueue;
  }

  /**
   * Return the underlying Redis client so the worker can create a BullMQ
   * Worker sharing the same connection (BullMQ v5 uses Worker instead of
   * Queue.process()).
   */
  getRedis(): Redis {
    return this.redis;
  }
}
