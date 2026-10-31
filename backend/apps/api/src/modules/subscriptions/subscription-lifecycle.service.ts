import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { AppEnvironment } from '@app/config';
import {
  AdminScope,
  SUBSCRIPTION_GRACE_DAYS,
  UserRole,
  UserSubscription,
  effectiveSubscription,
  isGlobalAdminUser,
  isTrialOnlyOwner,
  lockOwnerShops,
  lockedShopsForOwner,
  subscriptionLifecycle,
  subscriptionLockAnchor,
  trialDeletionAt,
} from '@app/database';

interface CandidateOwner {
  id: string;
  email: string;
  role: UserRole;
  adminScope: AdminScope;
}

/**
 * The plan lifecycle after the paid period: the owner keeps a public,
 * read-only shop for seven days, then every shop is locked (hidden, renewal
 * only) and its media is handed to the archive worker. The sweep is idempotent:
 * it only visits owners that still have an unlocked shop, so a restart or a
 * second API process cannot double-lock anything.
 */
@Injectable()
export class SubscriptionLifecycleService {
  private readonly logger = new Logger(SubscriptionLifecycleService.name);
  private sweeping: Promise<number> | null = null;

  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  lockExpiredShops(now = new Date()): Promise<number> {
    if (this.sweeping) return this.sweeping;
    this.sweeping = this.sweep(now).finally(() => {
      this.sweeping = null;
    });
    return this.sweeping;
  }

  private async sweep(now: Date): Promise<number> {
    try {
      const cutoff = new Date(
        now.getTime() - SUBSCRIPTION_GRACE_DAYS * 86_400_000,
      );
      // The SQL is only a prefilter so a large account base never starves the
      // batch: no non-cancelled row may run past the cutoff, no cancellation may
      // be recent, and the account must have subscription history. The exact
      // anchor and phase are still decided in TypeScript by the shared policy.
      const owners = await this.database.manager.query<
        Array<{
          id: string;
          email: string;
          role: UserRole;
          adminScope: AdminScope;
        }>
      >(
        `SELECT DISTINCT u.id, u.email, u.role, u.admin_scope AS adminScope
           FROM users u
           JOIN stores s ON s.owner_id = u.id
          WHERE u.suspended_at IS NULL
            AND s.status <> 'trashed'
            AND s.admin_archived_at IS NULL
            AND s.subscription_locked_at IS NULL
            AND EXISTS (
              SELECT 1 FROM user_subscriptions history
               WHERE history.user_id = u.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM user_subscriptions recent
               WHERE recent.user_id = u.id
                 AND recent.status <> 'cancelled'
                 AND (recent.expires_at IS NULL OR recent.expires_at > ?)
            )
            AND NOT EXISTS (
              SELECT 1 FROM user_subscriptions cancelled
               WHERE cancelled.user_id = u.id
                 AND cancelled.status = 'cancelled'
                 AND cancelled.updated_at > ?
            )
          LIMIT 200`,
        [cutoff, cutoff],
      );
      const allowlist = this.config.get('ADMIN_EMAILS', { infer: true });
      let locked = 0;
      for (const owner of owners as CandidateOwner[]) {
        // A platform administrator owns shops without a plan; their shops must
        // never be hidden by this sweep.
        if (
          isGlobalAdminUser(
            {
              email: owner.email,
              role: owner.role,
              adminScope: owner.adminScope,
            },
            allowlist,
          )
        )
          continue;
        if (await effectiveSubscription(this.database.manager, owner.id, now))
          continue;
        const newest = await this.database.manager.findOne(UserSubscription, {
          where: { userId: owner.id },
          order: { startsAt: 'DESC' },
        });
        // No assignment history means the account was never charged; it stays
        // untouched until an administrator assigns a plan.
        if (!newest) continue;
        const lifecycle = subscriptionLifecycle(
          subscriptionLockAnchor(newest),
          now,
        );
        if (lifecycle.phase !== 'locked') continue;
        locked += await this.database.transaction((manager) =>
          lockOwnerShops(manager, owner.id, now),
        );
      }
      return locked;
    } catch {
      // A failed sweep is retried by the timer; it must never break a request.
      this.logger.warn('Subscription lock sweep did not finish');
      return 0;
    }
  }

  /**
   * Locked shops plus the moment each one is deleted, but only for trial-only
   * accounts. Paid-plan shops report null: they are archived, never deleted.
   */
  async lockedShops(userId: string) {
    const shops = await lockedShopsForOwner(this.database.manager, userId);
    const hours = this.trialDeleteAfterHours();
    const trialOnly =
      shops.length > 0 &&
      (await isTrialOnlyOwner(this.database.manager, userId));
    return shops.map((shop) => ({
      ...shop,
      deletesAt:
        trialOnly && hours > 0 ? trialDeletionAt(shop.lockedAt, hours) : null,
    }));
  }

  trialDeleteAfterHours(): number {
    return this.config.get('TRIAL_SHOP_DELETE_AFTER_HOURS', { infer: true });
  }
}
