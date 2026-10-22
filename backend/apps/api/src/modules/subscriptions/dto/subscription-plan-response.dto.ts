import {
  SubscriptionPlan,
  SubscriptionLimits,
  BillingCycle,
} from '@app/database';

export class SubscriptionPlanResponseDto {
  id!: string;
  name!: string;
  slug!: string;
  description!: string | null;
  priceCents!: string;
  currency!: string;
  billingCycle!: BillingCycle;
  limits!: SubscriptionLimits;
  isActive!: boolean;
  sortOrder!: number;
  legacyTier!: string | null;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(plan: SubscriptionPlan): SubscriptionPlanResponseDto {
    const dto = new SubscriptionPlanResponseDto();
    dto.id = plan.id;
    dto.name = plan.name;
    dto.slug = plan.slug;
    dto.description = plan.description;
    dto.priceCents = plan.priceCents;
    dto.currency = plan.currency;
    dto.billingCycle = plan.billingCycle;
    dto.limits = plan.limits;
    dto.isActive = plan.isActive;
    dto.sortOrder = plan.sortOrder;
    dto.legacyTier = plan.legacyTier;
    dto.createdAt = plan.createdAt;
    dto.updatedAt = plan.updatedAt;
    return dto;
  }
}
