import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DataSource,
  In,
  IsNull,
  LessThan,
  type EntityManager,
  type FindOptionsWhere,
} from 'typeorm';
import { randomUUID } from 'node:crypto';
import type { AppEnvironment } from '@app/config';
import {
  RENEWAL_WINDOW_MS,
  RenewalKind,
  RenewalNotice,
  Store,
  StoreStatus,
  StoreVerificationRequest,
  SubscriptionStatus,
  UserSubscription,
  VerificationSettings,
  effectiveSubscription,
  isEffectiveSubscription,
  limitsFromSubscription,
  renewalDaysLeft,
  renewalNoticeIsLive,
  renewalNoticeKey,
  requireAdmin,
  verificationAddOnPriceCents,
  verificationBadgeInfo,
  type AdminActor,
  type User,
} from '@app/database';
import type { RenewalKindFilter } from './dto/renewal.dto';

const NOTICE_RETENTION_DAYS = 90;
// The timer is the normal path. This guard only repairs a missed midnight after
// a restart, so it is intentionally coarse to keep ordinary reads cheap.
const FRESHNESS_MS = 10 * 60_000;

interface OwnerRenewalNotice {
  id: string;
  kind: RenewalKind;
  dueAt: Date;
  seenAt: Date | null;
  declinedAt: Date | null;
  plan: {
    id: string;
    name: string;
    priceCents: string;
    currency: string;
  } | null;
  store: {
    id: string;
    name: string;
    slug: string;
    state: string;
    graceEndsAt: Date | null;
    daysRemaining: number | null;
    priceCents: string;
    currency: string;
  } | null;
}

interface DueQueryOptions {
  // A notice is only stored while the target still runs; the administrator's
  // queue also keeps lapsed rows until they are renewed.
  futureOnly: boolean;
  includeDeclined: boolean;
}

@Injectable()
export class RenewalNoticesService {
  private readonly logger = new Logger(RenewalNoticesService.name);
  private lastSweep = 0;
  private sweeping: Promise<void> | null = null;

  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  private sanitize(error: unknown): never {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(
      'Renewal reminders are temporarily unavailable',
    );
  }

  // ============================================
  // GENERATION
  // ============================================

  /**
   * Daily reminder sweep. It is idempotent (one row per target and due instant)
   * and deliberately small: two indexed reads and one bulk insert. A failure is
   * logged generically and never breaks a request or the API process.
   */
  async generate(now = new Date()): Promise<number> {
    try {
      const manager = this.database.manager;
      const subscriptions = this.newestPerUser(
        await this.dueSubscriptions(manager, now, {
          futureOnly: true,
          includeDeclined: false,
        }),
      );
      const stores = await this.dueStores(manager, now, {
        futureOnly: true,
        includeDeclined: false,
      });
      const rows: Array<
        Pick<
          RenewalNotice,
          | 'id'
          | 'userId'
          | 'kind'
          | 'subscriptionId'
          | 'storeId'
          | 'dueAt'
          | 'seenAt'
          | 'dedupeKey'
        >
      > = [];
      for (const subscription of subscriptions) {
        const dueAt = subscription.expiresAt;
        if (!dueAt) continue;
        rows.push({
          id: randomUUID(),
          userId: subscription.userId,
          kind: RenewalKind.SUBSCRIPTION,
          subscriptionId: subscription.id,
          storeId: null,
          dueAt,
          seenAt: null,
          dedupeKey: renewalNoticeKey(
            RenewalKind.SUBSCRIPTION,
            subscription.id,
            dueAt,
          ),
        });
      }
      for (const store of stores) {
        const dueAt = store.verificationBadgeExpiresAt;
        if (!dueAt) continue;
        rows.push({
          id: randomUUID(),
          userId: store.ownerId,
          kind: RenewalKind.VERIFICATION,
          subscriptionId: null,
          storeId: store.id,
          dueAt,
          seenAt: null,
          dedupeKey: renewalNoticeKey(
            RenewalKind.VERIFICATION,
            store.id,
            dueAt,
          ),
        });
      }
      if (rows.length)
        await manager
          .createQueryBuilder()
          .insert()
          .into(RenewalNotice)
          .values(rows)
          .orIgnore()
          .execute();
      // Reminders are disposable; a quarterly prune keeps the table bounded
      // without ever racing a read (stale rows are already hidden).
      await manager.delete(RenewalNotice, {
        createdAt: LessThan(
          new Date(now.getTime() - NOTICE_RETENTION_DAYS * 86_400_000),
        ),
      });
      return rows.length;
    } catch {
      this.logger.warn('Renewal reminder sweep did not finish');
      return 0;
    }
  }

  /**
   * A missed midnight (restart, deploy) is repaired on the next read. The
   * ten-minute guard keeps ordinary page loads from paying for a sweep.
   */
  async ensureFresh(now = new Date()): Promise<void> {
    if (Date.now() - this.lastSweep < FRESHNESS_MS) return;
    if (this.sweeping) return this.sweeping;
    this.sweeping = this.generate(now)
      .then(() => undefined)
      .finally(() => {
        this.lastSweep = Date.now();
        this.sweeping = null;
      });
    return this.sweeping;
  }

  private dueSubscriptions(
    manager: EntityManager,
    now: Date,
    options: DueQueryOptions,
  ): Promise<UserSubscription[]> {
    const horizon = new Date(now.getTime() + RENEWAL_WINDOW_MS);
    const query = manager
      .getRepository(UserSubscription)
      .createQueryBuilder('subscription')
      .innerJoinAndSelect('subscription.plan', 'plan')
      .innerJoinAndSelect('subscription.user', 'user')
      .where('subscription.status = :active', {
        active: SubscriptionStatus.ACTIVE,
      })
      .andWhere('subscription.expiresAt IS NOT NULL')
      .andWhere('subscription.expiresAt < :horizon', { horizon })
      .andWhere('subscription.startsAt <= :now', { now })
      .andWhere('plan.slug <> :free', { free: 'free' })
      .andWhere('user.suspendedAt IS NULL');
    if (options.futureOnly)
      query.andWhere('subscription.expiresAt > :now', { now });
    if (!options.includeDeclined)
      query.andWhere('subscription.renewalDeclinedAt IS NULL');
    return query
      .orderBy('subscription.startsAt', 'DESC')
      .addOrderBy('subscription.expiresAt', 'ASC')
      .getMany();
  }

  private dueStores(
    manager: EntityManager,
    now: Date,
    options: DueQueryOptions,
  ): Promise<Store[]> {
    const horizon = new Date(now.getTime() + RENEWAL_WINDOW_MS);
    const query = manager
      .getRepository(Store)
      .createQueryBuilder('store')
      .innerJoinAndSelect('store.owner', 'owner')
      .where('store.hasVerificationBadge = true')
      // A plan-bundled badge ends with the subscription, so the plan reminder
      // covers it; duplicating it here would double-message the owner.
      .andWhere('store.verificationIncludedInPlan = false')
      .andWhere('store.verificationBadgeExpiresAt IS NOT NULL')
      .andWhere('store.verificationBadgeExpiresAt < :horizon', { horizon })
      .andWhere('store.status <> :trashed', { trashed: StoreStatus.TRASHED })
      .andWhere('store.adminArchivedAt IS NULL')
      .andWhere('owner.suspendedAt IS NULL');
    if (options.futureOnly)
      query.andWhere('store.verificationBadgeExpiresAt > :now', { now });
    if (!options.includeDeclined)
      query.andWhere('store.renewalDeclinedAt IS NULL');
    return query.orderBy('store.verificationBadgeExpiresAt', 'ASC').getMany();
  }

  // Assigning a new plan cancels the previous active row, so this is defensive:
  // one reminder per owner even if an older active row survived a bad write.
  private newestPerUser(rows: UserSubscription[]): UserSubscription[] {
    const seen = new Set<string>();
    const result: UserSubscription[] = [];
    for (const row of rows) {
      if (seen.has(row.userId)) continue;
      seen.add(row.userId);
      result.push(row);
    }
    return result;
  }

  // ============================================
  // OWNER
  // ============================================

  async ownerList(userId: string, limit: number, offset: number) {
    await this.ensureFresh();
    try {
      const { items, unread } = await this.liveOwnerNotices(
        this.database.manager,
        userId,
      );
      return {
        unread,
        total: items.length,
        items: items.slice(offset, offset + limit),
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  async ownerSummary(userId: string) {
    await this.ensureFresh();
    try {
      const { unread } = await this.liveOwnerNotices(
        this.database.manager,
        userId,
      );
      return { unread };
    } catch (error) {
      this.sanitize(error);
    }
  }

  async markSeen(userId: string, id: string): Promise<{ seenAt: Date }> {
    const seenAt = new Date();
    try {
      const result = await this.database.manager.update(
        RenewalNotice,
        { id, userId },
        { seenAt },
      );
      if (!result.affected)
        throw new NotFoundException('Notification not found');
      return { seenAt };
    } catch (error) {
      this.sanitize(error);
    }
  }

  async markAllSeen(userId: string): Promise<{ updated: number }> {
    try {
      const result = await this.database.manager.update(
        RenewalNotice,
        { userId, seenAt: IsNull() },
        { seenAt: new Date() },
      );
      return { updated: result.affected ?? 0 };
    } catch (error) {
      this.sanitize(error);
    }
  }

  async decline(userId: string, id: string) {
    return this.setDecline(userId, id, true);
  }

  async resume(userId: string, id: string) {
    return this.setDecline(userId, id, false);
  }

  /**
   * Recording intent is the only write: the paid month, its grace window, and
   * published content are untouched. Ownership is checked on the target itself,
   * not only on the notice row.
   */
  private async setDecline(userId: string, id: string, declined: boolean) {
    try {
      return await this.database.transaction(async (manager) => {
        const notice = await manager.findOneBy(RenewalNotice, { id, userId });
        if (!notice) throw new NotFoundException('Notification not found');
        const value = declined ? new Date() : null;
        if (notice.kind === RenewalKind.SUBSCRIPTION) {
          if (!notice.subscriptionId)
            throw new NotFoundException('Subscription not found');
          const subscription = await manager.findOne(UserSubscription, {
            where: { id: notice.subscriptionId, userId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!subscription)
            throw new NotFoundException('Subscription not found');
          this.assertLive(
            notice,
            subscription.expiresAt,
            subscription.status === SubscriptionStatus.ACTIVE,
          );
          subscription.renewalDeclinedAt = value;
          await manager.save(subscription);
        } else {
          if (!notice.storeId) throw new NotFoundException('Store not found');
          const store = await manager.findOne(Store, {
            where: { id: notice.storeId, ownerId: userId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!store) throw new NotFoundException('Store not found');
          this.assertLive(
            notice,
            store.verificationBadgeExpiresAt,
            store.hasVerificationBadge && !store.verificationIncludedInPlan,
          );
          store.renewalDeclinedAt = value;
          await manager.save(store);
        }
        await manager.update(
          RenewalNotice,
          { id },
          { seenAt: notice.seenAt ?? new Date() },
        );
        return { declinedAt: value };
      });
    } catch (error) {
      this.sanitize(error);
    }
  }

  private assertLive(
    notice: RenewalNotice,
    targetExpiresAt: Date | null,
    stillRelevant: boolean,
  ): void {
    if (!renewalNoticeIsLive(notice.dueAt, targetExpiresAt, stillRelevant))
      throw new ConflictException('This reminder is no longer active');
  }

  /**
   * Loads every stored notice for the owner and keeps only the ones that still
   * describe the current target (same expiry, badge still an add-on, plan still
   * active). Renewing changes the expiry, which hides the old reminder without
   * a cross-service cleanup.
   */
  private async liveOwnerNotices(
    manager: EntityManager,
    userId: string,
  ): Promise<{ items: OwnerRenewalNotice[]; unread: number }> {
    const notices = await manager.find(RenewalNotice, {
      where: { userId },
      order: { dueAt: 'ASC', createdAt: 'DESC' },
    });
    if (!notices.length) return { items: [], unread: 0 };
    const subscriptionIds = [
      ...new Set(
        notices
          .map((notice) => notice.subscriptionId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const storeIds = [
      ...new Set(
        notices
          .map((notice) => notice.storeId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const [subscriptions, stores, activeSubscription, settings] =
      await Promise.all([
        subscriptionIds.length
          ? manager.find(UserSubscription, {
              where: { id: In(subscriptionIds) },
              relations: ['plan'],
            })
          : Promise.resolve([] as UserSubscription[]),
        storeIds.length
          ? manager.find(Store, { where: { id: In(storeIds) } })
          : Promise.resolve([] as Store[]),
        effectiveSubscription(manager, userId),
        manager.findOneBy(VerificationSettings, { id: 1 }),
      ]);
    const platformPrice = Math.max(0, settings?.badgePriceCents ?? 0);
    const badgePriceCents = verificationAddOnPriceCents(
      limitsFromSubscription(activeSubscription),
      platformPrice,
    );
    const subscriptionMap = new Map(
      subscriptions.map((subscription) => [subscription.id, subscription]),
    );
    const storeMap = new Map(stores.map((store) => [store.id, store]));
    const items: OwnerRenewalNotice[] = [];
    for (const notice of notices) {
      if (notice.kind === RenewalKind.SUBSCRIPTION && notice.subscriptionId) {
        const subscription = subscriptionMap.get(notice.subscriptionId);
        if (
          !subscription ||
          subscription.userId !== userId ||
          subscription.status !== SubscriptionStatus.ACTIVE ||
          subscription.plan?.slug === 'free' ||
          !renewalNoticeIsLive(notice.dueAt, subscription.expiresAt, true)
        )
          continue;
        items.push({
          id: notice.id,
          kind: notice.kind,
          dueAt: notice.dueAt,
          seenAt: notice.seenAt,
          declinedAt: subscription.renewalDeclinedAt,
          plan: subscription.plan
            ? {
                id: subscription.plan.id,
                name: subscription.plan.name,
                priceCents: subscription.plan.priceCents,
                currency: subscription.plan.currency,
              }
            : null,
          store: null,
        });
        continue;
      }
      if (notice.kind === RenewalKind.VERIFICATION && notice.storeId) {
        const store = storeMap.get(notice.storeId);
        if (
          !store ||
          store.ownerId !== userId ||
          store.status === StoreStatus.TRASHED ||
          store.adminArchivedAt !== null ||
          !store.hasVerificationBadge ||
          store.verificationIncludedInPlan ||
          !renewalNoticeIsLive(
            notice.dueAt,
            store.verificationBadgeExpiresAt,
            true,
          )
        )
          continue;
        const badge = verificationBadgeInfo(store);
        items.push({
          id: notice.id,
          kind: notice.kind,
          dueAt: notice.dueAt,
          seenAt: notice.seenAt,
          declinedAt: store.renewalDeclinedAt,
          plan: null,
          store: {
            id: store.id,
            name: store.name,
            slug: store.slug,
            state: badge.state,
            graceEndsAt: badge.graceEndsAt,
            daysRemaining: badge.daysRemaining,
            priceCents: String(badgePriceCents),
            currency: 'USD',
          },
        });
      }
    }
    items.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    return {
      items,
      unread: items.filter((item) => !item.seenAt).length,
    };
  }

  // ============================================
  // ADMIN
  // ============================================

  /**
   * The live renewal queue. It is derived from the targets themselves, so it is
   * always current even when the midnight sweep has not run; the stored notices
   * only add "reminder sent / opened" information.
   */
  async adminQueue(actor: AdminActor, kind: RenewalKindFilter = 'all') {
    await this.requireAdmin(actor);
    await this.ensureFresh();
    try {
      const manager = this.database.manager;
      const now = new Date();
      const subscriptions =
        kind === 'verification'
          ? []
          : this.newestPerUser(
              await this.dueSubscriptions(manager, now, {
                futureOnly: false,
                includeDeclined: true,
              }),
            );
      const stores =
        kind === 'subscription'
          ? []
          : await this.dueStores(manager, now, {
              futureOnly: false,
              includeDeclined: true,
            });
      const ownerIds = [
        ...new Set([
          ...subscriptions.map((subscription) => subscription.userId),
          ...stores.map((store) => store.ownerId),
        ]),
      ];
      const storeIds = stores.map((store) => store.id);
      const [activeSubscriptions, requests, settings] = await Promise.all([
        ownerIds.length
          ? manager.find(UserSubscription, {
              where: {
                userId: In(ownerIds),
                status: SubscriptionStatus.ACTIVE,
              },
              relations: ['plan'],
              order: { startsAt: 'DESC' },
            })
          : Promise.resolve([] as UserSubscription[]),
        storeIds.length
          ? manager.find(StoreVerificationRequest, {
              where: { storeId: In(storeIds) },
              order: { createdAt: 'DESC' },
            })
          : Promise.resolve([] as StoreVerificationRequest[]),
        manager.findOneBy(VerificationSettings, { id: 1 }),
      ]);
      const currentSubscriptions = new Map<string, UserSubscription>();
      for (const subscription of activeSubscriptions)
        if (
          !currentSubscriptions.has(subscription.userId) &&
          isEffectiveSubscription(subscription, now)
        )
          currentSubscriptions.set(subscription.userId, subscription);
      const phoneByStore = new Map<string, string>();
      // A transferred shop may still hold requests from its previous owner; the
      // current owner's plan phone is the safe fallback in that case.
      const ownerByStore = new Map(
        stores.map((store) => [store.id, store.ownerId]),
      );
      for (const request of requests)
        if (
          !phoneByStore.has(request.storeId) &&
          ownerByStore.get(request.storeId) === request.ownerId
        )
          phoneByStore.set(request.storeId, request.phone);
      const notices = await this.noticesForTargets(
        manager,
        subscriptions.map((subscription) => subscription.id),
        storeIds,
      );
      const platformPrice = Math.max(0, settings?.badgePriceCents ?? 0);

      const subscriptionRows = subscriptions.map((subscription) => {
        const notice = this.noticesForRow(
          notices.get(`${RenewalKind.SUBSCRIPTION}:${subscription.id}`),
          subscription.expiresAt,
        );
        return {
          id: subscription.id,
          owner: this.ownerView(subscription.user),
          plan: subscription.plan
            ? {
                id: subscription.plan.id,
                name: subscription.plan.name,
                priceCents: subscription.plan.priceCents,
                currency: subscription.plan.currency,
              }
            : null,
          expiresAt: subscription.expiresAt,
          daysLeft: subscription.expiresAt
            ? renewalDaysLeft(subscription.expiresAt, now)
            : null,
          declinedAt: subscription.renewalDeclinedAt,
          notifiedAt: notice?.createdAt ?? null,
          seenAt: notice?.seenAt ?? null,
        };
      });
      const badgeRows = stores.map((store) => {
        const notice = this.noticesForRow(
          notices.get(`${RenewalKind.VERIFICATION}:${store.id}`),
          store.verificationBadgeExpiresAt,
        );
        const badge = verificationBadgeInfo(store, now);
        const price = verificationAddOnPriceCents(
          limitsFromSubscription(
            currentSubscriptions.get(store.ownerId) ?? null,
          ),
          platformPrice,
        );
        return {
          id: store.id,
          owner: this.ownerView(store.owner),
          store: {
            id: store.id,
            name: store.name,
            slug: store.slug,
            logoKey: store.logoKey,
          },
          expiresAt: store.verificationBadgeExpiresAt,
          graceEndsAt: badge.graceEndsAt,
          state: badge.state,
          visible: badge.visible,
          daysLeft: store.verificationBadgeExpiresAt
            ? renewalDaysLeft(store.verificationBadgeExpiresAt, now)
            : null,
          daysRemaining: badge.daysRemaining,
          priceCents: String(price),
          currency: 'USD',
          // The verification request phone is the number the owner expects the
          // team to call; the plan phone is the fallback.
          contactPhone: phoneByStore.get(store.id) ?? store.owner.phone,
          declinedAt: store.renewalDeclinedAt,
          notifiedAt: notice?.createdAt ?? null,
          seenAt: notice?.seenAt ?? null,
        };
      });
      this.sortRenewals(subscriptionRows);
      this.sortRenewals(badgeRows);
      const declinedSubscriptions = subscriptionRows.filter(
        (row) => row.declinedAt,
      ).length;
      const declinedBadges = badgeRows.filter((row) => row.declinedAt).length;
      const subscriptionCount = subscriptionRows.length - declinedSubscriptions;
      const verificationCount = badgeRows.length - declinedBadges;
      return {
        now,
        counts: {
          subscription: subscriptionCount,
          verification: verificationCount,
          total: subscriptionCount + verificationCount,
          declined: declinedSubscriptions + declinedBadges,
        },
        subscriptions: subscriptionRows,
        badges: badgeRows,
      };
    } catch (error) {
      this.sanitize(error);
    }
  }

  /**
   * Counts for the navigation badge. It deliberately skips hydration, so every
   * admin page can ask for it without paying for the full queue.
   */
  async adminSummary(actor: AdminActor) {
    await this.requireAdmin(actor);
    try {
      const manager = this.database.manager;
      const now = new Date();
      const horizon = new Date(now.getTime() + RENEWAL_WINDOW_MS);
      const [subscription, verification] = await Promise.all([
        manager
          .getRepository(UserSubscription)
          .createQueryBuilder('subscription')
          .innerJoin('subscription.plan', 'plan')
          .innerJoin('subscription.user', 'user')
          .where('subscription.status = :active', {
            active: SubscriptionStatus.ACTIVE,
          })
          .andWhere('subscription.expiresAt IS NOT NULL')
          .andWhere('subscription.expiresAt < :horizon', { horizon })
          .andWhere('subscription.startsAt <= :now', { now })
          .andWhere('subscription.renewalDeclinedAt IS NULL')
          .andWhere('plan.slug <> :free', { free: 'free' })
          .andWhere('user.suspendedAt IS NULL')
          .getCount(),
        manager
          .getRepository(Store)
          .createQueryBuilder('store')
          .innerJoin('store.owner', 'owner')
          .where('store.hasVerificationBadge = true')
          .andWhere('store.verificationIncludedInPlan = false')
          .andWhere('store.verificationBadgeExpiresAt IS NOT NULL')
          .andWhere('store.verificationBadgeExpiresAt < :horizon', { horizon })
          .andWhere('store.renewalDeclinedAt IS NULL')
          .andWhere('store.status <> :trashed', {
            trashed: StoreStatus.TRASHED,
          })
          .andWhere('store.adminArchivedAt IS NULL')
          .andWhere('owner.suspendedAt IS NULL')
          .getCount(),
      ]);
      return { subscription, verification, total: subscription + verification };
    } catch (error) {
      this.sanitize(error);
    }
  }

  private async noticesForTargets(
    manager: EntityManager,
    subscriptionIds: string[],
    storeIds: string[],
  ): Promise<Map<string, RenewalNotice>> {
    const where: FindOptionsWhere<RenewalNotice>[] = [];
    if (subscriptionIds.length)
      where.push({
        kind: RenewalKind.SUBSCRIPTION,
        subscriptionId: In(subscriptionIds),
      });
    if (storeIds.length)
      where.push({
        kind: RenewalKind.VERIFICATION,
        storeId: In(storeIds),
      });
    if (!where.length) return new Map();
    const rows = await manager.find(RenewalNotice, {
      where,
      order: { createdAt: 'DESC' },
    });
    const map = new Map<string, RenewalNotice>();
    for (const notice of rows) {
      const targetId =
        notice.kind === RenewalKind.SUBSCRIPTION
          ? notice.subscriptionId
          : notice.storeId;
      if (!targetId) continue;
      const key = `${notice.kind}:${targetId}`;
      if (!map.has(key)) map.set(key, notice);
    }
    return map;
  }

  private sortRenewals<
    T extends { expiresAt: Date | null; declinedAt: Date | null },
  >(rows: T[]): void {
    rows.sort((a, b) => {
      const declined =
        Number(Boolean(a.declinedAt)) - Number(Boolean(b.declinedAt));
      if (declined) return declined;
      return (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0);
    });
  }

  // A reminder from an older cycle (same target, previous expiry) must not be
  // reported as "sent" for the current due date.
  private noticesForRow(
    notice: RenewalNotice | undefined,
    expiresAt: Date | null,
  ): RenewalNotice | null {
    if (!notice || !expiresAt) return null;
    return notice.dueAt.getTime() === expiresAt.getTime() ? notice : null;
  }

  private ownerView(owner: User) {
    return {
      id: owner.id,
      displayName: owner.displayName,
      email: owner.email,
      phone: owner.phone,
    };
  }

  private async requireAdmin(actor: AdminActor): Promise<unknown> {
    return requireAdmin(
      this.database.manager,
      actor,
      this.config.get('ADMIN_EMAILS', { infer: true }),
    );
  }
}
