export enum SubscriptionTier {
  FREE = 'free',
  BASIC = 'basic',
  PREMIUM = 'premium',
}

export interface SubscriptionTierLimits {
  maxPostsPerMonth: number | null; // null = unlimited
}

export const SUBSCRIPTION_TIERS: Record<
  SubscriptionTier,
  SubscriptionTierLimits
> = {
  [SubscriptionTier.FREE]: { maxPostsPerMonth: 10 },
  [SubscriptionTier.BASIC]: { maxPostsPerMonth: 100 },
  [SubscriptionTier.PREMIUM]: { maxPostsPerMonth: null },
};

export function getMaxPostsPerMonth(tier: string): number | null {
  return SUBSCRIPTION_TIERS[tier as SubscriptionTier].maxPostsPerMonth;
}

export function isUnlimited(tier: string): boolean {
  return SUBSCRIPTION_TIERS[tier as SubscriptionTier].maxPostsPerMonth === null;
}
