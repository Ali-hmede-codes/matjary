import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  SubscriptionPlan,
  SubscriptionStatus,
  UserSubscription,
  type SubscriptionLimits,
} from './entities';

export const FREE_LIMITS: SubscriptionLimits = {
  maxVideoDurationSeconds: 60,
  maxVideoSizeBytes: 52428800,
  maxVideoQuality: '720p',
  maxImageCount: 10,
  maxImageSizeBytes: 10485760,
  maxImageWidth: 1920,
  maxImageHeight: 1080,
  maxPostsPerMonth: 5,
  maxTotalPosts: 20,
  maxProducts: 10,
  maxStorageBytes: 1073741824,
  enableCart: true,
  enableWhatsAppCheckout: false,
  enableAnalytics: false,
  enableCustomDomain: false,
  enablePrioritySupport: false,
  maxVerificationBadges: 0,
};

export async function effectiveSubscription(
  manager: EntityManager,
  userId: string,
  now = new Date(),
): Promise<UserSubscription | null> {
  const subscriptions = await manager.getRepository(UserSubscription).find({
    where: { userId, status: SubscriptionStatus.ACTIVE },
    relations: ['plan'],
    order: { startsAt: 'DESC' },
  });
  return (
    subscriptions.find(
      (subscription) =>
        subscription.startsAt <= now &&
        (!subscription.expiresAt || subscription.expiresAt > now) &&
        subscription.plan,
    ) ?? null
  );
}

export async function effectiveLimits(
  manager: EntityManager,
  userId: string,
): Promise<SubscriptionLimits> {
  const subscription = await effectiveSubscription(manager, userId);
  const plan =
    subscription?.plan ??
    (await manager.getRepository(SubscriptionPlan).findOneBy({ slug: 'free' }));
  // Omitted settings use safe defaults; explicit null remains unlimited.
  return { ...FREE_LIMITS, ...plan?.limits };
}

export function assertQuota(
  current: number,
  limit: number | null | undefined,
  label: string,
): void {
  if (limit != null && current >= limit)
    throw new ConflictException(`${label} limit reached for your subscription`);
}

export function boundedLimit(
  hardLimit: number,
  planLimit: number | null | undefined,
): number {
  return planLimit == null ? hardLimit : Math.min(hardLimit, planLimit);
}
