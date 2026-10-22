import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { parse } from 'cookie';
import type { AppEnvironment } from '@app/config';
import {
  PostEngagement,
  PostLike,
  Showcase,
  ShowcaseStatus,
} from '@app/database';
import {
  hydrateEngagement,
  readEngagement,
  mutateEngagement,
  type EngagementState,
} from '@app/queue/engagement-buffer';
import { RedisService } from '@app/queue';
import { QueueService, type EngagementFlushJob } from '@app/queue';
import { AuthService } from '../../auth/auth.service';

const VISITOR_COOKIE_NAME = 'matjary_visitor';
// Visitors keep their id for a year so their likes/views accumulate stably.
const VISITOR_COOKIE_TTL_SECONDS = 365 * 24 * 3600;

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
        this.logger.warn('Flush scheduling tick skipped');
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
    const secure = this.config
      .get('APP_ORIGIN', { infer: true })
      .startsWith('https:');
    const sessionToken =
      cookies[secure ? '__Host-matjary_session' : 'matjary_session'];
    if (sessionToken) {
      try {
        const user = await this.auth.currentUser(sessionToken);
        if (user) {
          return { voterId: user.id, voterType: 'user' };
        }
      } catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error;
      }
    }

    // 2. Visitor cookie.
    const visitorToken = cookies[VISITOR_COOKIE_NAME];
    if (visitorToken && /^[0-9a-f]{32}$/.test(visitorToken)) {
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

  private rateKey(action: string, voterId: string): string {
    return `${RATE_PREFIX}${action}:${voterId}`;
  }

  private async ensurePost(postId: string): Promise<void> {
    const post = await this.showcases.findOneBy({ id: postId });
    if (!post || post.status !== ShowcaseStatus.PUBLISHED) {
      throw new NotFoundException('Post not found');
    }
  }

  private async hydratedState(postId: string): Promise<EngagementState> {
    let state = await readEngagement(this.redis, postId);
    if (state) return state;
    // Serialize cold hydration against the worker's commit. An old baseline
    // must never replace a freshly committed snapshot after cache loss.
    await this.showcases.manager.transaction(async (manager) => {
      await manager.findOneOrFail(Showcase, {
        where: { id: postId },
        lock: { mode: 'pessimistic_write' },
      });
      const likes = await manager.findBy(PostLike, { postId });
      const row = await manager.findOneBy(PostEngagement, { postId });
      await hydrateEngagement(
        this.redis,
        postId,
        Object.fromEntries(likes.map((like) => [like.voterId, like.voterType])),
        row?.viewsCount ?? 0,
      );
    });
    state = await readEngagement(this.redis, postId);
    if (!state)
      throw new ServiceUnavailableException(
        'Engagement temporarily unavailable',
      );
    return state;
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

    try {
      await this.hydratedState(postId);
      const state = await mutateEngagement(
        this.redis,
        postId,
        'like',
        viewer.voterId,
        viewer.voterType,
        1,
      );
      if (!state) throw new Error('Cache changed');
      return {
        liked: Boolean(state.likes[viewer.voterId]),
        likes: Object.keys(state.likes).length,
      };
    } catch {
      throw new ServiceUnavailableException(
        'Engagement temporarily unavailable',
      );
    }
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

      await this.hydratedState(postId);
      const state = await mutateEngagement(
        this.redis,
        postId,
        'view',
        viewer.voterId,
        viewer.voterType,
        this.config.get('ENGAGEMENT_VIEW_DEDUPE_TTL_SECONDS', { infer: true }),
      );
      if (!state) throw new Error('Cache changed');
      return { views: state.views };
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

    try {
      const state = await this.hydratedState(postId);
      // views includes the hydrated durable baseline plus every new event;
      // acknowledgement does not add the committed batch a second time.
      return {
        likes: Object.keys(state.likes).length,
        views: state.views,
        viewerLiked: Boolean(viewer && state.likes[viewer.voterId]),
      };
    } catch {
      const row = await this.engagement.findOneBy({ postId });
      const like = viewer
        ? await this.postLikes.findOneBy({ postId, voterId: viewer.voterId })
        : null;
      return {
        likes: row?.likesCount ?? 0,
        views: row?.viewsCount ?? 0,
        viewerLiked: Boolean(like),
      };
    }
  }

  async flushEngagement(postIds?: string[]): Promise<void> {
    await this.queue.enqueueEngagementFlush(
      postIds ? { postIds } : { all: true },
    );
  }
}
