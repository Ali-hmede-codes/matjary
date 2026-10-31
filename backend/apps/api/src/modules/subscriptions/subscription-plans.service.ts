import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository, QueryFailedError, type EntityManager } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import {
  SubscriptionPlan,
  UserSubscription,
  SubscriptionLimits,
  SubscriptionStatus,
  BillingCycle,
  User,
  effectiveLimits,
  effectiveSubscription,
  subscriptionState,
  FREE_LIMITS,
  FREE_TRIAL_CAP_CODE,
  actorContext,
  appendAdminAudit,
  requireAdmin,
  StoreSubscriptionTier,
  syncIncludedBadgesForOwner,
  nextSubscriptionRenewalExpiry,
  unlockOwnerShops,
} from '@app/database';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';
import { SubscriptionPlanResponseDto } from './dto/subscription-plan-response.dto';
import { normalizeSubscriptionPhone } from './subscription-phone';

const PHONE_INVALID_CODE = 'SUBSCRIPTION_PHONE_INVALID';

export interface AssignSubscriptionInput {
  userId: string;
  planId: string;
  assignedBy: string;
  // The recipient's contact number, national format for `phoneCountryCode` or
  // a complete number typed with its own + code.
  phone: string;
  phoneCountryCode?: string;
  expiresAt?: Date;
  notes?: string;
}

@Injectable()
export class SubscriptionPlansService {
  constructor(
    @InjectRepository(SubscriptionPlan)
    private readonly plans: Repository<SubscriptionPlan>,
    @InjectRepository(UserSubscription)
    private readonly userSubscriptions: Repository<UserSubscription>,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  private async adminWrite<T>(
    actorId: string,
    action: string,
    id: string,
    fields: string[],
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const actor = actorContext(actorId);
    return this.plans.manager.transaction(async (manager) => {
      await requireAdmin(
        manager,
        actor,
        this.config.get('ADMIN_EMAILS', { infer: true }),
      );
      const result = await work(manager);
      await appendAdminAudit(
        manager,
        actor,
        'subscriptions',
        id,
        action,
        fields,
      );
      return result;
    });
  }

  private sanitize(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof QueryFailedError && error.driverError) {
      const mysqlError = error.driverError as { code?: string; errno?: number };
      if (mysqlError.code === 'ER_DUP_ENTRY') {
        throw new ConflictException(
          'A subscription plan with this slug already exists',
        );
      }
    }
    throw new ServiceUnavailableException(
      'Subscription storage is temporarily unavailable',
    );
  }

  async create(
    dto: CreateSubscriptionPlanDto,
    actorId: string,
  ): Promise<SubscriptionPlanResponseDto> {
    try {
      // Check if slug already exists
      const existing = await this.plans.findOneBy({ slug: dto.slug });
      if (existing) {
        throw new ConflictException(
          'A subscription plan with this slug already exists',
        );
      }

      // Validate limits
      this.validateLimits(dto.limits);

      if (
        dto.slug === 'free' &&
        (dto.isActive === false || (dto.priceCents ?? 0) !== 0)
      )
        throw new BadRequestException(
          'The free fallback must remain active and free',
        );
      const plan = this.plans.create({
        id: randomUUID(),
        name: dto.name,
        slug: dto.slug,
        description: dto.description ?? null,
        priceCents: (dto.priceCents ?? 0).toString(),
        currency: dto.currency ?? 'USD',
        billingCycle: dto.billingCycle ?? BillingCycle.MONTHLY,
        limits: {
          ...(dto.limits as SubscriptionLimits),
          // Storage is unlimited and posts have one total maximum per plan.
          maxStorageBytes: null,
          maxPostsPerMonth: null,
        },
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
        legacyTier: (dto.legacyTier as any) ?? null,
      });

      const saved = await this.adminWrite(
        actorId,
        'plan.save',
        plan.id ?? plan.slug,
        Object.keys(dto),
        (manager) => manager.save(plan),
      );
      return SubscriptionPlanResponseDto.fromEntity(saved);
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  async findAll(
    includeInactive = false,
  ): Promise<SubscriptionPlanResponseDto[]> {
    try {
      const query = this.plans
        .createQueryBuilder('plan')
        .orderBy('plan.sortOrder', 'ASC');
      if (!includeInactive) {
        query.where('plan.isActive = :active', { active: true });
      }
      const plans = await query.getMany();
      return plans.map((p) => SubscriptionPlanResponseDto.fromEntity(p));
    } catch (error) {
      this.sanitize(error);
    }
  }

  async findPublic() {
    const plans = await this.findAll(false);
    const trialDays = this.config.get('FREE_TRIAL_DAYS', { infer: true });
    return plans.map((plan) => ({
      name: plan.name,
      slug: plan.slug,
      description: plan.description,
      priceCents: plan.priceCents,
      currency: plan.currency,
      billingCycle: plan.billingCycle,
      // The free plan is a trial; paid plans have no trial label.
      trialDays: plan.slug === 'free' ? trialDays : null,
      // Storage is unlimited for every plan; posts use one total maximum.
      limits: {
        ...FREE_LIMITS,
        ...plan.limits,
        maxStorageBytes: null,
        maxPostsPerMonth: null,
      },
    }));
  }

  async findBySlug(slug: string): Promise<SubscriptionPlanResponseDto> {
    try {
      const plan = await this.plans.findOneBy({ slug });
      if (!plan) {
        throw new NotFoundException('Subscription plan not found');
      }
      return SubscriptionPlanResponseDto.fromEntity(plan);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  async findById(id: string): Promise<SubscriptionPlanResponseDto> {
    try {
      const plan = await this.plans.findOneBy({ id });
      if (!plan) {
        throw new NotFoundException('Subscription plan not found');
      }
      return SubscriptionPlanResponseDto.fromEntity(plan);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  async update(
    id: string,
    dto: UpdateSubscriptionPlanDto,
    actorId: string,
  ): Promise<SubscriptionPlanResponseDto> {
    try {
      const saved = await this.adminWrite(
        actorId,
        'plan.save',
        id,
        Object.keys(dto),
        async (manager) => {
          const plan = await manager.findOne(SubscriptionPlan, {
            where: { id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!plan) {
            throw new NotFoundException('Subscription plan not found');
          }

          if (
            plan.slug === 'free' &&
            ((dto.slug !== undefined && dto.slug !== 'free') ||
              dto.isActive === false ||
              (dto.priceCents !== undefined && dto.priceCents !== 0))
          )
            throw new BadRequestException(
              'The free fallback must remain active and free',
            );

          // If slug is being changed, check for conflicts
          if (dto.slug && dto.slug !== plan.slug) {
            const existing = await manager.findOneBy(SubscriptionPlan, {
              slug: dto.slug,
            });
            if (existing) {
              throw new ConflictException(
                'A subscription plan with this slug already exists',
              );
            }
          }

          // Validate limits if provided
          if (dto.limits) {
            this.validateLimits(dto.limits);
          }

          // Update fields
          if (dto.name !== undefined) plan.name = dto.name;
          if (dto.slug !== undefined) plan.slug = dto.slug;
          if (dto.description !== undefined) plan.description = dto.description;
          if (dto.priceCents !== undefined)
            plan.priceCents = dto.priceCents.toString();
          if (dto.currency !== undefined) plan.currency = dto.currency;
          if (dto.billingCycle !== undefined)
            plan.billingCycle = dto.billingCycle;
          if (dto.limits !== undefined)
            plan.limits = dto.limits as SubscriptionLimits;
          // Keep the platform invariants even when an older client sends values.
          plan.limits = {
            ...plan.limits,
            maxStorageBytes: null,
            maxPostsPerMonth: null,
          };
          if (dto.isActive !== undefined) plan.isActive = dto.isActive;
          if (dto.sortOrder !== undefined) plan.sortOrder = dto.sortOrder;
          if (dto.legacyTier !== undefined)
            plan.legacyTier = dto.legacyTier as StoreSubscriptionTier | null;
          if (
            plan.slug === 'free' &&
            (!plan.isActive || plan.priceCents !== '0')
          )
            throw new BadRequestException(
              'The free fallback must remain active and free',
            );
          return manager.save(plan);
        },
      );
      return SubscriptionPlanResponseDto.fromEntity(saved);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  async delete(id: string, actorId: string): Promise<void> {
    await this.update(id, { isActive: false }, actorId);
  }

  async cancelAssignment(id: string, actorId: string): Promise<void> {
    await this.adminWrite(
      actorId,
      'assignment.cancel',
      id,
      ['status'],
      async (manager) => {
        const subscription = await manager.findOneBy(UserSubscription, { id });
        if (!subscription)
          throw new NotFoundException('Subscription not found');
        await manager.findOne(User, {
          where: { id: subscription.userId },
          lock: { mode: 'pessimistic_write' },
        });
        await manager.update(
          UserSubscription,
          { id },
          { status: SubscriptionStatus.CANCELLED },
        );
        // Cancelling ends the subscription now, so bundled badges enter their
        // renewal window instead of running past the plan that paid for them.
        const now = new Date();
        await syncIncludedBadgesForOwner(
          manager,
          subscription.userId,
          { included: true, expiresAt: now },
          now,
        );
      },
    );
  }

  /**
   * One-click monthly renewal. The plan and recipient stay the same; only the
   * end date moves. A newer assignment makes this row obsolete, so it is
   * refused instead of silently extending an old plan. The free plan is a
   * one-time trial and has nothing to renew.
   */
  async extendSubscription(
    id: string,
    actorId: string,
  ): Promise<{ success: true; id: string; expiresAt: Date }> {
    try {
      return await this.adminWrite(
        actorId,
        'subscription.extend',
        id,
        ['expiresAt', 'renewalDeclinedAt'],
        async (manager) => {
          const subscription = await manager.findOne(UserSubscription, {
            where: { id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!subscription)
            throw new NotFoundException('Subscription not found');
          if (subscription.status !== SubscriptionStatus.ACTIVE)
            throw new BadRequestException(
              'Only an active assignment can be renewed',
            );
          const plan = await manager.findOne(SubscriptionPlan, {
            where: { id: subscription.planId },
            lock: { mode: 'pessimistic_read' },
          });
          if (!plan) throw new NotFoundException('Subscription plan not found');
          if (plan.slug === 'free')
            throw new BadRequestException({
              code: 'FREE_PLAN_NO_RENEWAL',
              message:
                'The free trial cannot be renewed. Assign a paid plan instead.',
            });
          // An assignment created after this row is the live one. Extending the
          // old row would report a renewal that the owner never receives.
          const newest = await manager.findOne(UserSubscription, {
            where: {
              userId: subscription.userId,
              status: SubscriptionStatus.ACTIVE,
            },
            order: { startsAt: 'DESC' },
          });
          if (newest && newest.id !== subscription.id)
            throw new BadRequestException({
              code: 'SUBSCRIPTION_SUPERSEDED',
              message:
                'A newer active assignment exists. Renew that assignment instead.',
            });
          const now = new Date();
          const expiresAt = nextSubscriptionRenewalExpiry(
            subscription.expiresAt,
            now,
          );
          subscription.expiresAt = expiresAt;
          subscription.renewalDeclinedAt = null;
          subscription.renewalRequestedAt = null;
          await manager.save(subscription);
          // A renewal reopens every shop the grace window locked, and queues a
          // byte-exact media restore for the ones already archived.
          await unlockOwnerShops(manager, subscription.userId);
          // Bundled badges are paid by this subscription, so they move with it.
          const maxBadges = plan.limits?.maxVerificationBadges;
          const includesBadges =
            maxBadges === null ||
            (typeof maxBadges === 'number' && maxBadges > 0);
          await syncIncludedBadgesForOwner(
            manager,
            subscription.userId,
            {
              included: includesBadges,
              expiresAt: includesBadges ? expiresAt : now,
            },
            now,
          );
          return { success: true as const, id, expiresAt };
        },
      );
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  /**
   * The owner's explicit renewal request. It records intent only: the paid
   * period, the grace window and every published shop stay untouched until an
   * administrator confirms the payment with extend or assign.
   */
  async requestRenewal(userId: string): Promise<{ requestedAt: Date }> {
    try {
      return await this.userSubscriptions.manager.transaction(
        async (manager) => {
          const user = await manager.findOne(User, {
            where: { id: userId },
            lock: { mode: 'pessimistic_read' },
          });
          if (!user || user.suspendedAt)
            throw new NotFoundException('Active user not found');
          // The newest assignment is the one the queue would extend; an older
          // superseded row must never be requested.
          const subscription = await manager.findOne(UserSubscription, {
            where: { userId, status: SubscriptionStatus.ACTIVE },
            relations: ['plan'],
            order: { startsAt: 'DESC' },
            lock: { mode: 'pessimistic_write' },
          });
          if (!subscription)
            throw new NotFoundException('Subscription not found');
          if (subscription.plan?.slug === 'free')
            throw new BadRequestException({
              code: 'FREE_PLAN_NO_RENEWAL',
              message:
                'The free trial cannot be renewed. Choose a paid plan instead.',
            });
          const requestedAt = new Date();
          subscription.renewalRequestedAt = requestedAt;
          subscription.renewalDeclinedAt = null;
          await manager.save(subscription);
          return { requestedAt };
        },
      );
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      )
        throw error;
      this.sanitize(error);
    }
  }

  /**
   * Get the active subscription for a user
   */
  async getUserActiveSubscription(
    userId: string,
  ): Promise<UserSubscription | null> {
    try {
      return await effectiveSubscription(
        this.userSubscriptions.manager,
        userId,
      );
    } catch (error) {
      this.sanitize(error);
    }
  }

  /**
   * Get effective limits for a user (from their active subscription or the
   * expired read-only state).
   */
  async getEffectiveLimits(userId: string): Promise<SubscriptionLimits> {
    return effectiveLimits(this.plans.manager, userId);
  }

  /**
   * Trial, paid or expired state for dashboards and upgrade prompts.
   */
  async getSubscriptionState(userId: string) {
    return subscriptionState(this.plans.manager, userId);
  }

  /**
   * Assign a subscription plan to a user (admin action). The assignment also
   * records the recipient's phone number for follow-up calls.
   */
  async assignSubscription({
    userId,
    planId,
    assignedBy,
    phone: phoneInput,
    phoneCountryCode,
    expiresAt,
    notes,
  }: AssignSubscriptionInput): Promise<UserSubscription> {
    try {
      const now = new Date();
      // Normalize before the transaction so a typo never locks user rows.
      const phone = normalizeSubscriptionPhone(phoneInput, phoneCountryCode);
      if (!phone)
        throw new BadRequestException({
          code: PHONE_INVALID_CODE,
          message: 'Enter a valid phone number with its country code',
        });
      if (
        expiresAt &&
        (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now)
      )
        throw new BadRequestException(
          'Subscription expiry must be in the future',
        );
      return await this.userSubscriptions.manager.transaction(
        async (manager) => {
          const actor = actorContext(assignedBy);
          await requireAdmin(
            manager,
            actor,
            this.config.get('ADMIN_EMAILS', { infer: true }),
          );
          const user = await manager.findOne(User, {
            where: { id: userId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!user || user.suspendedAt)
            throw new NotFoundException('Active user not found');
          // The number is part of the record, so a later assignment replaces it
          // and the change is audited on the user row.
          const phoneChanged = user.phone !== phone;
          if (phoneChanged) {
            user.phone = phone;
            await manager.save(user);
          }
          const plan = await manager.findOne(SubscriptionPlan, {
            where: { id: planId },
            lock: { mode: 'pessimistic_read' },
          });
          if (!plan || !plan.isActive)
            throw new NotFoundException('Active subscription plan not found');
          // The free plan is a one-time trial. Administrators can grant a
          // shorter window, never a longer one; paid plans carry longer access.
          if (plan.slug === 'free') {
            const trialDays = this.config.get('FREE_TRIAL_DAYS', {
              infer: true,
            });
            const ceiling = new Date(now.getTime() + trialDays * 86_400_000);
            if (expiresAt && expiresAt > ceiling)
              throw new BadRequestException({ code: FREE_TRIAL_CAP_CODE });
            expiresAt = expiresAt ?? ceiling;
          }
          await manager.update(
            UserSubscription,
            { userId, status: SubscriptionStatus.ACTIVE },
            { status: SubscriptionStatus.CANCELLED },
          );
          const saved = await manager.save(
            UserSubscription,
            manager.create(UserSubscription, {
              userId,
              planId,
              status: SubscriptionStatus.ACTIVE,
              startsAt: now,
              expiresAt: expiresAt ?? null,
              assignedBy,
              notes: notes ?? null,
            }),
          );
          // A plan assignment is the payment confirmation: locked shops reopen
          // here and their archived media is restored by the worker.
          await unlockOwnerShops(manager, userId);
          // A plan with bundled badge slots lets the owner's bundled badges run
          // to the subscription end; a plan without slots ends them now.
          const maxBadges = plan.limits?.maxVerificationBadges;
          const includesBadges =
            maxBadges === null ||
            (typeof maxBadges === 'number' && maxBadges > 0);
          const synced = await syncIncludedBadgesForOwner(
            manager,
            userId,
            {
              included: includesBadges,
              expiresAt: includesBadges ? (saved.expiresAt ?? null) : now,
            },
            now,
          );
          await appendAdminAudit(
            manager,
            actor,
            'subscriptions',
            saved.id,
            'assignment.create',
            synced
              ? ['planId', 'expiresAt', 'verificationBadgeExpiresAt']
              : ['planId', 'expiresAt'],
          );
          if (phoneChanged)
            await appendAdminAudit(
              manager,
              actor,
              'users',
              userId,
              'phone.update',
              ['phone'],
            );
          return saved;
        },
      );
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  private validateLimits(limits: Partial<SubscriptionLimits>): void {
    // Validate numeric limits are positive
    const numericFields: (keyof SubscriptionLimits)[] = [
      'maxVideoDurationSeconds',
      'maxVideoSizeBytes',
      'maxImageCount',
      'maxImageSizeBytes',
      'maxImageWidth',
      'maxImageHeight',
      'maxPostsPerMonth',
      'maxTotalPosts',
      'maxShops',
      'maxProducts',
      'maxCategories',
      'maxStorageBytes',
    ];

    for (const field of numericFields) {
      const value = limits[field];
      if (
        value !== undefined &&
        value !== null &&
        (typeof value !== 'number' ||
          !Number.isSafeInteger(value) ||
          value <= 0)
      ) {
        throw new BadRequestException(
          `${field} must be a positive number or null for unlimited`,
        );
      }
    }

    // Stories and badges treat zero as an answer, not as a missing quota:
    // 0 stories means the plan turns stories off (the free plan stores 0), and
    // 0 badges means the plan bundles none. Rejecting zero here made the admin
    // panel fail with a 400 whenever it saved a plan holding those values.
    const zeroAllowedFields: (keyof SubscriptionLimits)[] = [
      'maxStories',
      'maxVerificationBadges',
      'verificationBadgePriceCents',
    ];

    for (const field of zeroAllowedFields) {
      const value = limits[field];
      if (
        value !== undefined &&
        value !== null &&
        (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
      ) {
        throw new BadRequestException(
          `${field} must be a non-negative number or null`,
        );
      }
    }

    // Validate video quality format
    if (
      limits.maxVideoQuality !== undefined &&
      limits.maxVideoQuality !== null
    ) {
      const validQualities = ['480p', '720p', '1080p', '4k', '8k'];
      if (!validQualities.includes(limits.maxVideoQuality)) {
        throw new BadRequestException(
          `maxVideoQuality must be one of: ${validQualities.join(', ')}`,
        );
      }
    }
  }
}
