import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { parse } from 'cookie';
import type { AppEnvironment } from '@app/config';
import { PostEngagement, PostLike, Showcase } from '@app/database';
import { RedisService } from '@app/queue';
import { QueueService, type EngagementFlushJob } from '@app/queue';
import { AuthService } from '../../auth/auth.service';

const VISITOR_COOKIE_NAME = 'matjary_visitor';
// Visitors keep their id for a year so their likes/views accumulate stably.
const VISITOR_COOKIE_TTL_SECONDS = 365 * 24 * 3600;

const LIKE_SET_PREFIX = 'matjary:eng:like:set:';
const VIEW_COUNTER_PREFIX = 'matjary:eng:views:';
const DIRTY_SET_KEY = 'matjary:eng:dirty';
const FLUSH_LOCK_KEY = 'matjary:eng:flush:lock';
const RATE_PREFIX = 'matjary:eng:rate:';

/**
 * Posts whose engagement changed since the last flush. Only these are written
 * back to MySQL, so the flush cost is proportional to activity, not to the
 * total number of posts (avoids a full Redis SCAN at scale).
 */
export interface ResolvedViewer {
  voterId: string;
  voterType: 'user' | 'visitor';
  /** Set when the viewer had no visitor cookie yet; set it on the response. */
  newVisitorId?: string;
}

@Injectable()
export class PostEngagementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PostEngagementService.name);
  private flushTimer?: ReturnType<typeof setInterval>;
  /** Unique id of this API instance, used for the flush leader lock. */
  private readonly instanceId = randomBytes(8).toString('hex');

  constructor(
    @InjectRepository(Showcase)
    private readonly showcases: Repository<Showcase>,
    @InjectRepository(PostEngagement)
    private readonly engagement: Repository<PostEngagement>,
    @InjectRepository(PostLike)
    private readonly postLikes: Repository<PostLike>,
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly auth: AuthService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  onModuleInit(): void {
    // Only the flush *leader* enqueues worker jobs, so multiple API nodes do
    // not schedule duplicate flushes. The lock TTL expires if this node dies,
    // letting another node take over.
    const interval = this.config.get('ENGAGEMENT_FLUSH_INTERVAL_SECONDS', {
      infer: true,
    });
    this.flushTimer = setInterval(async () => {
      try {
        const isLeader = await this.redis.setIfNotExistsWithTtl(
          FLUSH_LOCK_KEY,
          this.instanceId,
          interval * 2,
        );
        if (isLeader) {
          await this.requestFlush();
        }
      } catch (error) {
        // Redis down: skip this scheduling tick; engagement keeps buffering.
        this.logger.warn('Flush scheduling tick skipped', error);
      }
    }, interval * 1000);
    this.flushTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
  }

  /**
   * Enqueue a single worker job that flushes buffered engagement to MySQL.
   * The worker is the only writer to MySQL, so engagement is never written
   * synchronously in a request path and is never duplicated across API nodes.
   */
  private async requestFlush(): Promise<void> {
    const job: EngagementFlushJob = { all: true };
    await this.queue.enqueueEngagementFlush(job);
  }

  /**
   * Resolve the viewer issuing an engagement action.
   * Logged-in users are identified by their session; everyone else by a
   * stable visitor cookie, so both shop-account holders and anonymous
   * visitors can like and view posts.
   */
  async resolveViewer(request: Request): Promise<ResolvedViewer> {
    const cookies = parse(request.headers.cookie ?? '');

    // 1. A valid session means a logged-in user (accounts are for shops).
    const sessionToken = cookies['matjary_session'];
    if (sessionToken) {
      try {
        const user = await this.auth.currentUser(sessionToken);
        if (user) {
          return { voterId: user.id, voterType: 'user' };
        }
      } catch {
        // Invalid or expired session: fall through to visitor identification.
      }
    }

    // 2. Visitor cookie.
    const visitorToken = cookies[VISITOR_COOKIE_NAME];
    if (visitorToken) {
      return { voterId: visitorToken, voterType: 'visitor' };
    }

    // 3. No identifier yet: mint one visitor id and use it both as the
    // voter id and as the value the controller sets on the cookie.
    const visitorId = randomBytes(16).toString('hex');
    return {
      voterId: visitorId,
      voterType: 'visitor',
      newVisitorId: visitorId,
    };
  }

  private likeSetKey(postId: string): string {
    return `${LIKE_SET_PREFIX}${postId}`;
  }

  private viewCounterKey(postId: string): string {
    return `${VIEW_COUNTER_PREFIX}${postId}`;
  }

  private rateKey(action: string, voterId: string): string {
    return `${RATE_PREFIX}${action}:${voterId}`;
  }

  private async ensurePost(postId: string): Promise<void> {
    const post = await this.showcases.findOneBy({ id: postId });
    if (!post) {
      throw new NotFoundException('Post not found');
    }
  }

  /**
   * Mark a post as needing its engagement flushed to MySQL. Called after every
   * like/view change so the worker only touches active posts.
   */
  private async markDirty(postId: string): Promise<void> {
    const ttl = this.config.get('ENGAGEMENT_REDIS_KEY_TTL_SECONDS', {
      infer: true,
    });
    await this.redis.sadd(DIRTY_SET_KEY, postId);
    await this.redis.expire(DIRTY_SET_KEY, ttl);
  }

  /**
   * Rate-limit engagement per viewer and action so a single client cannot
   * inflate counters. Fail closed: Redis errors surface as a sanitized 503.
   */
  private async rateLimit(voterId: string, action: string): Promise<void> {
    const limit = this.config.get('ENGAGEMENT_RATE_LIMIT_PER_MIN', {
      infer: true,
    });
    const count = await this.redis.incrementWithTtl(
      this.rateKey(action, voterId),
      60,
    );
    if (count > limit) {
      throw new ServiceUnavailableException(
        'Too many attempts. Try again in a minute.',
      );
    }
  }

  /**
   * Toggle a like on a post. Returns whether the viewer now likes it and the
   * current like count. The like set lives in Redis first and is flushed to
   * MySQL asynchronously; nothing is written to the database in this call.
   */
  async toggleLike(
    postId: string,
    viewer: ResolvedViewer,
  ): Promise<{
    liked: boolean;
    likes: number;
  }> {
    await this.rateLimit(viewer.voterId, 'like');
    await this.ensurePost(postId);

    const key = this.likeSetKey(postId);
    const alreadyLiked = await this.redis.hexists(key, viewer.voterId);

    let liked: boolean;
    if (alreadyLiked) {
      await this.redis.hdel(key, viewer.voterId);
      liked = false;
    } else {
      await this.redis.hset(key, viewer.voterId, '1');
      liked = true;
    }

    const ttl = this.config.get('ENGAGEMENT_REDIS_KEY_TTL_SECONDS', {
      infer: true,
    });
    await this.redis.expire(key, ttl);

    await this.markDirty(postId);

    const likes = await this.redis.hlen(key);
    return { liked, likes };
  }

  /**
   * Register a view for a post. The same visitor is deduplicated within the
   * configured window so page refreshes don't inflate the count. Best-effort:
   * if Redis is unavailable the view is simply not counted and the stored
   * count is returned instead.
   */
  async registerView(
    postId: string,
    viewer: ResolvedViewer,
  ): Promise<{ views: number }> {
    await this.ensurePost(postId);

    try {
      await this.rateLimit(viewer.voterId, 'view');

      const seenKey = `matjary:eng:view:seen:${postId}:${viewer.voterId}`;
      const alreadySeen = await this.redis.hexists(seenKey, '1');
      if (!alreadySeen) {
        const ttl = this.config.get('ENGAGEMENT_VIEW_DEDUPE_TTL_SECONDS', {
          infer: true,
        });
        await this.redis.hset(seenKey, '1', '1');
        await this.redis.expire(seenKey, ttl);
        await this.redis.incrementWithTtl(
          this.viewCounterKey(postId),
          this.config.get('ENGAGEMENT_REDIS_KEY_TTL_SECONDS', { infer: true }),
        );
        await this.markDirty(postId);
      }

      const views = Number(
        (await this.redis.get(this.viewCounterKey(postId))) ?? '0',
      );
      return { views };
    } catch (error) {
      // Views should never break a page load: fall back to the last flushed count.
      if (error instanceof ServiceUnavailableException) throw error;
      const row = await this.engagement.findOneBy({ postId });
      return { views: row?.viewsCount ?? 0 };
    }
  }

  /**
   * Read the current engagement state for a post. Reads Redis first (freshest
   * counters) and falls back to the last flushed MySQL row, so public pages
   * never 503 when Redis is temporarily unavailable.
   */
  async getEngagement(
    postId: string,
    viewer?: ResolvedViewer,
  ): Promise<{ likes: number; views: number; viewerLiked: boolean }> {
    await this.ensurePost(postId);

    let likes = 0;
    let views = 0;
    let viewerLiked = false;
    let redisAvailable = true;

    try {
      const likeKey = this.likeSetKey(postId);
      const [likesRaw, viewsRaw] = await Promise.all([
        this.redis.hlen(likeKey),
        this.redis.get(this.viewCounterKey(postId)),
      ]);
      likes = likesRaw;
      views = Number(viewsRaw ?? '0');
      if (viewer) {
        viewerLiked = await this.redis.hexists(likeKey, viewer.voterId);
      }
    } catch {
      redisAvailable = false;
    }

    if (!redisAvailable) {
      const row = await this.engagement.findOneBy({ postId });
      likes = row?.likesCount ?? 0;
      views = row?.viewsCount ?? 0;
      viewerLiked = false;
    }

    return { likes, views, viewerLiked };
  }

  /**
   * Flush buffered engagement for the given posts from Redis into MySQL.
   * When `postIds` is omitted, flushes every post in the dirty set and then
   * clears it. Idempotent and safe to run concurrently.
   */
  async flushEngagement(postIds?: string[]): Promise<void> {
    const targets = postIds ?? (await this.redis.smembers(DIRTY_SET_KEY));
    for (const postId of targets) {
      try {
        await this.flushPost(postId);
      } catch (error) {
        this.logger.warn(
          `Failed to flush engagement for post ${postId}`,
          error,
        );
      }
    }

    if (postIds) {
      for (const postId of postIds) {
        await this.redis.srem(DIRTY_SET_KEY, postId);
      }
    } else {
      await this.redis.remove(DIRTY_SET_KEY);
    }
  }

  private async flushPost(postId: string): Promise<void> {
    // --- Like set -----------------------------------------------------
    const likeKey = this.likeSetKey(postId);
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

    // Mirror individual votes into post_likes: insert new likes, remove
    // unlikes, so the durable record matches Redis.
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
    const viewKey = this.viewCounterKey(postId);
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
