import { formatProductPrice } from './storefront.ts';

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
    maxCategories?: number | null;
    maxStorageBytes?: number | null;
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

export function planFeatures(plan: SubscriptionPlan) {
  const limits = plan.limits;
  return [
    { label: 'Max shops', value: quota(limits.maxShops) },
    { label: 'Max categories', value: quota(limits.maxCategories) },
    { label: 'Max posts', value: quota(limits.maxTotalPosts) },
    { label: 'Max products', value: quota(limits.maxProducts) },
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
