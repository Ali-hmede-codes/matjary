import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  SubscriptionStatus,
  UserSubscription,
  type SubscriptionLimits,
} from './entities';
import { TRIAL_EXPIRED_CODE } from './subscription-errors';

export const FREE_LIMITS: SubscriptionLimits = {
  maxVideoDurationSeconds: 60,
  maxVideoSizeBytes: 52428800,
  maxVideoQuality: '720p',
  maxImageCount: 10,
  maxImageSizeBytes: 10485760,
  maxImageWidth: 1920,
  maxImageHeight: 1080,
  // Posts have one account-wide maximum. The legacy monthly quota is ignored
  // and PlanEditor no longer exposes it.
  maxPostsPerMonth: null,
  maxTotalPosts: 20,
  maxShops: 1,
  maxProducts: 10,
  // One category allowance covers every shop the owner creates.
  maxCategories: 10,
  // Storage is a platform resource, not a plan entitlement. Every plan is
  // unlimited; only global per-file/duration ceilings still apply.
  maxStorageBytes: null,
  enableCart: true,
  enableWhatsAppCheckout: false,
  enableAnalytics: false,
  enableCustomDomain: false,
  enablePrioritySupport: false,
  maxVerificationBadges: 0,
};

// No effective subscription means every quota and feature fails closed. This is
// the trial-expired state: content stays public, but the owner cannot add or
// change anything until an administrator assigns a plan.
export const EXPIRED_LIMITS: SubscriptionLimits = {
  maxVideoDurationSeconds: 0,
  maxVideoSizeBytes: 0,
  maxVideoQuality: null,
  maxImageCount: 0,
  maxImageSizeBytes: 0,
  maxImageWidth: 0,
  maxImageHeight: 0,
  maxPostsPerMonth: 0,
  maxTotalPosts: 0,
  maxShops: 0,
  maxProducts: 0,
  maxCategories: 0,
  maxStorageBytes: 0,
  enableCart: false,
  enableWhatsAppCheckout: false,
  enableAnalytics: false,
  enableCustomDomain: false,
  enablePrioritySupport: false,
  maxVerificationBadges: 0,
  verificationBadgePriceCents: null,
};

const DAY_MS = 86_400_000;

export interface SubscriptionState {
  state: 'trial' | 'paid' | 'expired';
  subscription: UserSubscription | null;
  planName: string | null;
  planSlug: string | null;
  expiresAt: Date | null;
  daysRemaining: number | null;
}

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
        subscription.plan &&
        // The free plan is the trial plan; an unbounded free row is stale state
        // and must not grant permanent access.
        (subscription.plan.slug !== 'free' || subscription.expiresAt != null),
    ) ?? null
  );
}

export async function subscriptionState(
  manager: EntityManager,
  userId: string,
  now = new Date(),
): Promise<SubscriptionState> {
  const subscription = await effectiveSubscription(manager, userId, now);
  if (!subscription || !subscription.plan)
    return {
      state: 'expired',
      subscription: null,
      planName: null,
      planSlug: null,
      expiresAt: null,
      daysRemaining: null,
    };
  const trial = subscription.plan.slug === 'free';
  const expiresAt = subscription.expiresAt ?? null;
  return {
    state: trial ? 'trial' : 'paid',
    subscription,
    planName: subscription.plan.name,
    planSlug: subscription.plan.slug,
    expiresAt,
    daysRemaining: expiresAt
      ? Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS))
      : null,
  };
}

export async function effectiveLimits(
  manager: EntityManager,
  userId: string,
  now = new Date(),
): Promise<SubscriptionLimits> {
  const subscription = await effectiveSubscription(manager, userId, now);
  if (!subscription || !subscription.plan) return EXPIRED_LIMITS;
  // Omitted settings use safe defaults; explicit null remains unlimited.
  return {
    ...FREE_LIMITS,
    ...subscription.plan.limits,
    // Platform invariants: storage is unlimited and posts use one total max.
    maxStorageBytes: null,
    maxPostsPerMonth: null,
  };
}

export async function assertSubscriptionActive(
  manager: EntityManager,
  userId: string,
  now = new Date(),
): Promise<UserSubscription> {
  const subscription = await effectiveSubscription(manager, userId, now);
  if (!subscription) throw new ForbiddenException({ code: TRIAL_EXPIRED_CODE });
  return subscription;
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
