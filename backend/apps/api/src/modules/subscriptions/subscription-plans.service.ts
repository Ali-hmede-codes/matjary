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
} from '@app/database';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';
import { SubscriptionPlanResponseDto } from './dto/subscription-plan-response.dto';

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
      },
    );
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
   * Assign a subscription plan to a user (admin action)
   */
  async assignSubscription(
    userId: string,
    planId: string,
    assignedBy: string,
    expiresAt?: Date,
    notes?: string,
  ): Promise<UserSubscription> {
    try {
      const now = new Date();
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
          await appendAdminAudit(
            manager,
            actor,
            'subscriptions',
            saved.id,
            'assignment.create',
            ['planId', 'expiresAt'],
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
      'maxProducts',
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

    // Validate badge fields (can be 0 = no badges, or positive number)
    const badgeFields: (keyof SubscriptionLimits)[] = [
      'maxVerificationBadges',
      'verificationBadgePriceCents',
    ];

    for (const field of badgeFields) {
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
