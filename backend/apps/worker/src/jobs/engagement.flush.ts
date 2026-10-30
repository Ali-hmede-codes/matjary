import {
  Injectable,
  Logger,
  BeforeApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { AppEnvironment } from '@app/config';
import {
  PostEngagement,
  PostLike,
  Showcase,
  EngagementFlushReceipt,
} from '@app/database';
import {
  stageEngagement,
  acknowledgeEngagement,
  ENGAGEMENT_DIRTY,
} from '@app/queue/engagement-buffer';
import { RedisService } from '@app/queue';
import {
  QueueService,
  type EngagementFlushJob,
  ENGAGEMENT_FLUSH_QUEUE,
} from '@app/queue';
import { Worker } from 'bullmq';

// Persistence is worker-only; Redis owns the immutable batch until commit.

@Injectable()
export class EngagementFlusher
  implements OnModuleInit, BeforeApplicationShutdown
{
  private readonly logger = new Logger(EngagementFlusher.name);
  private worker: Worker | null = null;

  constructor(
    @InjectRepository(Showcase)
    private readonly showcases: Repository<Showcase>,
    @InjectRepository(PostEngagement)
    private readonly engagement: Repository<PostEngagement>,
    @InjectRepository(PostLike)
    private readonly postLikes: Repository<PostLike>,
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(
      ENGAGEMENT_FLUSH_QUEUE,
      async (job) => {
        const data = job.data as EngagementFlushJob;
        await this.flushJob(data);
      },
      { connection: this.queue.createWorkerConnection(), concurrency: 1 },
    );
    this.worker.on('error', () =>
      this.logger.warn('Engagement queue unavailable'),
    );
  }

  isRunning(): boolean {
    return this.worker?.isRunning() ?? false;
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }

  private async flushJob(data: EngagementFlushJob): Promise<void> {
    // When `postIds` is given flush exactly those posts; otherwise flush every
    // post currently marked dirty in Redis. Dirty-only flushing keeps the cost
    // proportional to activity, not to the total number of posts.
    const postIds =
      data.postIds ?? (await this.redis.smembers(ENGAGEMENT_DIRTY));
    let failed = false;
    for (const postId of postIds) {
      try {
        await this.flushPost(postId);
      } catch {
        failed = true;
        this.logger.warn(`Engagement flush deferred for ${postId}`);
      }
    }
    if (failed) throw new Error('Engagement flush will retry');
  }

  async flushPost(postId: string): Promise<void> {
    const batchId = await this.showcases.manager.transaction(
      async (manager) => {
        // Every flusher and cold-cache hydrator uses this same lock order.
        await manager.findOneOrFail(Showcase, {
          where: { id: postId },
          lock: { mode: 'pessimistic_write' },
        });
        const batch = await stageEngagement(this.redis, postId);
        if (!batch) return null;
        if (
          await manager.existsBy(EngagementFlushReceipt, { batchId: batch.id })
        )
          return batch.id;
        const existing = await manager.findBy(PostLike, { postId });
        const voters = new Set(existing.map((like) => like.voterId));
        for (const [voterId, voterType] of Object.entries(batch.likes)) {
          if (!voters.has(voterId))
            await manager.save(
              PostLike,
              manager.create(PostLike, { postId, voterId, voterType }),
            );
        }
        for (const like of existing)
          if (!batch.likes[like.voterId])
            await manager.delete(PostLike, { id: like.id });
        const row =
          (await manager.findOneBy(PostEngagement, { postId })) ??
          manager.create(PostEngagement, { postId, viewsCount: 0 });
        row.likesCount = Object.keys(batch.likes).length;
        row.viewsCount += batch.views;
        row.lastBatchId = batch.id;
        await manager.save(row);
        // The share-shell fingerprint watches content timestamps, so a
        // counter-only write must not look like an edit. The statement pins
        // `updated_at` to itself because MySQL would otherwise refresh an
        // auto-updated column on any other column change, and every flushed
        // view would rebuild the whole storefront preview catalogue.
        await manager.query(
          'UPDATE `showcases` SET `likes_count` = ?, `views_count` = ?, `updated_at` = `updated_at` WHERE `id` = ?',
          [row.likesCount, row.viewsCount, postId],
        );
        await manager.insert(EngagementFlushReceipt, {
          batchId: batch.id,
          postId,
        });
        return batch.id;
      },
    );
    // A crash here replays the batch but the durable receipt prevents double-counting.
    if (batchId) await acknowledgeEngagement(this.redis, postId, batchId);
  }
}
