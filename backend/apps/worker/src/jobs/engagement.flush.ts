import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { AppEnvironment } from '@app/config';
import { PostEngagement, PostLike, Showcase } from '@app/database';
import { RedisService } from '@app/queue';
import {
  QueueService,
  type EngagementFlushJob,
  ENGAGEMENT_FLUSH_QUEUE,
} from '@app/queue';
import { Worker } from 'bullmq';

const LIKE_SET_PREFIX = 'matjary:eng:like:set:';
const VIEW_COUNTER_PREFIX = 'matjary:eng:views:';
const DIRTY_SET_KEY = 'matjary:eng:dirty';

@Injectable()
export class EngagementFlusher implements OnModuleInit, OnModuleDestroy {
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
      { connection: this.queue.getRedis() },
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }

  private async flushJob(data: EngagementFlushJob): Promise<void> {
    // When `postIds` is given flush exactly those posts; otherwise flush every
    // post currently marked dirty in Redis. Dirty-only flushing keeps the cost
    // proportional to activity, not to the total number of posts.
    const postIds = data.postIds ?? (await this.redis.smembers(DIRTY_SET_KEY));
    for (const postId of postIds) {
      try {
        await this.flushPost(postId);
      } catch (error) {
        this.logger.warn(
          `Failed to flush engagement for post ${postId}`,
          error as Error,
        );
      }
    }

    if (data.postIds) {
      for (const postId of data.postIds) {
        await this.redis.srem(DIRTY_SET_KEY, postId);
      }
    } else {
      await this.redis.remove(DIRTY_SET_KEY);
    }
  }

  private async flushPost(postId: string): Promise<void> {
    // --- Like set -----------------------------------------------------
    const likeKey = `${LIKE_SET_PREFIX}${postId}`;
    const voters = await this.redis.hgetall(likeKey);
    const likesCount = Object.keys(voters).length;

    let row = await this.engagement.findOneBy({ postId });
    if (row) {
      row.likesCount = likesCount;
      await this.engagement.save(row);
    } else {
      await this.engagement.save(
        this.engagement.create({ postId, likesCount, viewsCount: 0 }),
      );
    }

    // Mirror individual votes into post_likes so the durable record matches
    // Redis: insert new likes, remove unlikes.
    const existing = await this.postLikes.find({ where: { postId } });
    const existingVoters = new Set(existing.map((like) => like.voterId));
    const redisVoters = new Set(Object.keys(voters));

    for (const voterId of redisVoters) {
      if (!existingVoters.has(voterId)) {
        const like = this.postLikes.create({
          postId,
          voterId,
          voterType: this.voterTypeFor(voterId),
        });
        await this.postLikes.save(like);
      }
    }
    for (const like of existing) {
      if (!redisVoters.has(like.voterId)) {
        await this.postLikes.remove(like);
      }
    }
    await this.redis.remove(likeKey);

    // --- View counter -------------------------------------------------
    const viewKey = `${VIEW_COUNTER_PREFIX}${postId}`;
    const raw = await this.redis.get(viewKey);
    const delta = Number(raw ?? '0');
    if (delta) {
      let viewRow = await this.engagement.findOneBy({ postId });
      if (viewRow) {
        viewRow.viewsCount += delta;
        await this.engagement.save(viewRow);
      } else {
        await this.engagement.save(
          this.engagement.create({ postId, likesCount: 0, viewsCount: delta }),
        );
      }
      await this.redis.remove(viewKey);
    }
  }

  private voterTypeFor(voterId: string): 'user' | 'visitor' {
    // User ids are uuids; visitor ids are raw hex. Heuristic only, used for
    // the durable like log; reads re-identify type from the session.
    return /^[0-9a-f-]{36}$/.test(voterId) ? 'user' : 'visitor';
  }
}
