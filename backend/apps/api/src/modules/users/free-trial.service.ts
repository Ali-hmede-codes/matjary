import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AppEnvironment } from '@app/config';
import {
  SubscriptionPlan,
  SubscriptionStatus,
  User,
  UserSubscription,
} from '@app/database';

const DAY_MS = 86_400_000;

@Injectable()
export class FreeTrialService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  /**
   * Starts the one-time free trial for a brand-new account. Any subscription
   * history means the account already had its trial or a plan, so this is a
   * no-op. The user row lock makes concurrent first sign-ins idempotent.
   */
  async startIfNew(userId: string): Promise<void> {
    try {
      await this.users.manager.transaction(async (manager) => {
        const user = await manager.findOne(User, {
          where: { id: userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!user || user.suspendedAt) return;
        const history = await manager.count(UserSubscription, {
          where: { userId },
        });
        if (history > 0) return;
        const plan = await manager.findOne(SubscriptionPlan, {
          where: { slug: 'free', isActive: true },
          lock: { mode: 'pessimistic_read' },
        });
        // The migration seeds this plan and the API forbids disabling it.
        if (!plan)
          throw new ServiceUnavailableException('Free plan is unavailable');
        const startsAt = new Date();
        const days = this.config.get('FREE_TRIAL_DAYS', { infer: true });
        await manager.save(
          UserSubscription,
          manager.create(UserSubscription, {
            userId,
            planId: plan.id,
            status: SubscriptionStatus.ACTIVE,
            startsAt,
            expiresAt: new Date(startsAt.getTime() + days * DAY_MS),
            assignedBy: null,
            notes: 'Free trial',
          }),
        );
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      // A missing trial would leave the account locked, so fail the sign-in
      // without leaking driver details. The user can simply retry.
      throw new ServiceUnavailableException(
        'Subscription storage is temporarily unavailable',
      );
    }
  }
}
