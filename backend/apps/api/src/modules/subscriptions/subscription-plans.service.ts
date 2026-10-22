import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import {
  SubscriptionPlan,
  UserSubscription,
  SubscriptionLimits,
  SubscriptionStatus,
  BillingCycle,
  User,
  effectiveLimits,
  effectiveSubscription,
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
  ) {}

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

      const plan = this.plans.create({
        name: dto.name,
        slug: dto.slug,
        description: dto.description ?? null,
        priceCents: (dto.priceCents ?? 0).toString(),
        currency: dto.currency ?? 'USD',
        billingCycle: dto.billingCycle ?? BillingCycle.MONTHLY,
        limits: dto.limits as SubscriptionLimits,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
        legacyTier: (dto.legacyTier as any) ?? null,
      });

      const saved = await this.plans.save(plan);
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
  ): Promise<SubscriptionPlanResponseDto> {
    try {
      const plan = await this.plans.findOneBy({ id });
      if (!plan) {
        throw new NotFoundException('Subscription plan not found');
      }

      // If slug is being changed, check for conflicts
      if (dto.slug && dto.slug !== plan.slug) {
        const existing = await this.plans.findOneBy({ slug: dto.slug });
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
      if (dto.billingCycle !== undefined) plan.billingCycle = dto.billingCycle;
      if (dto.limits !== undefined)
        plan.limits = dto.limits as SubscriptionLimits;
      if (dto.isActive !== undefined) plan.isActive = dto.isActive;
      if (dto.sortOrder !== undefined) plan.sortOrder = dto.sortOrder;
      if (dto.legacyTier !== undefined) plan.legacyTier = dto.legacyTier as any;

      const saved = await this.plans.save(plan);
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

  async delete(id: string): Promise<void> {
    try {
      const plan = await this.plans.findOneBy({ id });
      if (!plan) {
        throw new NotFoundException('Subscription plan not found');
      }

      // Check if any users are subscribed to this plan
      const activeSubscriptions = await this.userSubscriptions.count({
        where: { planId: id },
      });

      if (activeSubscriptions > 0) {
        throw new BadRequestException(
          'Cannot delete a referenced plan. Deactivate it to retain subscription history.',
        );
      }

      await this.plans.remove(plan);
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
   * Get effective limits for a user (from their active subscription or default free plan)
   */
  async getEffectiveLimits(userId: string): Promise<SubscriptionLimits> {
    return effectiveLimits(this.plans.manager, userId);
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
      if (
        expiresAt &&
        (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())
      )
        throw new BadRequestException(
          'Subscription expiry must be in the future',
        );
      return await this.userSubscriptions.manager.transaction(
        async (manager) => {
          const user = await manager.findOne(User, {
            where: { id: userId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!user) throw new NotFoundException('User not found');
          const plan = await manager.findOne(SubscriptionPlan, {
            where: { id: planId },
            lock: { mode: 'pessimistic_read' },
          });
          if (!plan || !plan.isActive)
            throw new NotFoundException('Active subscription plan not found');
          await manager.update(
            UserSubscription,
            { userId, status: SubscriptionStatus.ACTIVE },
            { status: SubscriptionStatus.CANCELLED },
          );
          return manager.save(
            UserSubscription,
            manager.create(UserSubscription, {
              userId,
              planId,
              status: SubscriptionStatus.ACTIVE,
              startsAt: new Date(),
              expiresAt: expiresAt ?? null,
              assignedBy,
              notes: notes ?? null,
            }),
          );
        },
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
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
