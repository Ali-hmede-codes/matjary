import { formatProductPrice, linkCompareAtPriceCents } from './storefront.ts';

export interface SubscriptionPlan {
  name: string;
  slug: string;
  description: string | null;
  priceCents: string;
  currency: string;
  billingCycle: 'monthly' | 'yearly' | 'lifetime';
  // Present on the free plan; the API derives it from FREE_TRIAL_DAYS.
  trialDays?: number | null;
  limits: {
    maxPostsPerMonth?: number | null;
    maxTotalPosts?: number | null;
    maxShops?: number | null;
    maxProducts?: number | null;
    maxStories?: number | null;
    maxCategories?: number | null;
    maxStorageBytes?: number | null;
    // Monthly verification badge slots and the add-on price beyond them.
    maxVerificationBadges?: number | null;
    verificationBadgePriceCents?: number | null;
    enableCart?: boolean;
    enableWhatsAppCheckout?: boolean;
    enableAnalytics?: boolean;
    enableCustomDomain?: boolean;
    enablePrioritySupport?: boolean;
  };
}

export function planPrice(plan: SubscriptionPlan) {
  return formatProductPrice(plan.priceCents, plan.currency);
}

export function billingLabel(cycle: SubscriptionPlan['billingCycle']) {
  return (
    { monthly: '/ month', yearly: '/ year', lifetime: 'one-time' }[cycle] ??
    'See plan terms'
  );
}

export function planBadge(plan: SubscriptionPlan) {
  if (plan.slug === 'free' && plan.trialDays)
    return `${plan.trialDays}-day free trial`;
  return /^0+$/u.test(plan.priceCents) ? 'Free plan' : 'Paid plan';
}

// The third paid tier is promoted from this fixed anchor. It is display-only:
// the dashboard price stays the amount charged, and a plan priced at or above
// the anchor shows no sale at all, so a stale price can never fake a discount.
const PLAN_SALE_ANCHOR_CENTS = '2999';

export function planCompareAtPriceCents(
  plan: SubscriptionPlan,
  index: number,
): string | null {
  // Index keeps the promotion on "plan 3"; the slug keeps it on Premium when
  // an administrator reorders the list.
  const third = index === 2 || plan.slug.toLowerCase().includes('premium');
  if (!third) return null;
  return linkCompareAtPriceCents(PLAN_SALE_ANCHOR_CENTS, plan.priceCents);
}

function quota(value: number | null | undefined): string {
  if (value === null) return 'Unlimited';
  if (value === undefined) return 'Not specified';
  return value.toLocaleString('en-US');
}

function storageQuota(bytes: number | null | undefined): string {
  if (bytes == null) return quota(bytes);
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(
    Math.max(0, Math.floor(Math.log2(bytes || 1) / 10)),
    units.length - 1,
  );
  const value = (bytes / 1024 ** index).toLocaleString('en-US', {
    maximumFractionDigits: 2,
  });
  return `${value} ${units[index]}`;
}

export interface PlanVerification {
  // A null slot count means the plan never runs out of badges.
  unlimited: boolean;
  included: number;
  addOnPriceCents: number | null;
}

/*
 * The pricing page gives the blue tick its own block, so a plan that offers it
 * hides the plain feature row and reads this shape instead. A plan with no
 * slots and no add-on price keeps the ordinary "not included" row.
 */
export function planVerification(
  plan: SubscriptionPlan,
): PlanVerification | null {
  const slots = plan.limits.maxVerificationBadges;
  const price = plan.limits.verificationBadgePriceCents;
  const addOnPriceCents = typeof price === 'number' && price > 0 ? price : null;
  if (slots === null) return { unlimited: true, included: 0, addOnPriceCents };
  const included = typeof slots === 'number' && slots > 0 ? slots : 0;
  if (!included && addOnPriceCents === null) return null;
  return { unlimited: false, included, addOnPriceCents };
}

function verificationFeature(limits: SubscriptionPlan['limits']) {
  const included = limits.maxVerificationBadges;
  const price = limits.verificationBadgePriceCents;
  const extra =
    typeof price === 'number' && price > 0
      ? `+${formatProductPrice(String(price), 'USD')}/mo`
      : null;
  if (included === null) return extra ? `Unlimited · ${extra}` : 'Unlimited';
  if (typeof included === 'number' && included > 0)
    return extra ? `${included} included · ${extra}` : `${included} included`;
  return extra ?? false;
}

export function planFeatures(plan: SubscriptionPlan) {
  const limits = plan.limits;
  return [
    { label: 'Max shops', value: quota(limits.maxShops) },
    { label: 'Max categories', value: quota(limits.maxCategories) },
    { label: 'Max posts', value: quota(limits.maxTotalPosts) },
    { label: 'Max products', value: quota(limits.maxProducts) },
    { label: 'Story slots per shop', value: quota(limits.maxStories) },
    { label: 'Verification badge', value: verificationFeature(limits) },
    { label: 'Media storage', value: storageQuota(limits.maxStorageBytes) },
    { label: 'Shopping cart', value: limits.enableCart === true },
    {
      label: 'WhatsApp checkout',
      value: limits.enableWhatsAppCheckout === true,
    },
    { label: 'Analytics', value: limits.enableAnalytics === true },
    { label: 'Custom domain', value: limits.enableCustomDomain === true },
    { label: 'Priority support', value: limits.enablePrioritySupport === true },
  ];
}
