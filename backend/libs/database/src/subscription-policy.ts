import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  Product,
  Showcase,
  Store,
  SubscriptionStatus,
  UserSubscription,
  type SubscriptionLimits,
} from './entities';
import { ownerWhere } from './visibility-policy';
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
  // Stories are a live-count quota, not a monthly one; the free plan has none.
  maxStories: 0,
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
  maxStories: 0,
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

// Content sections are the two stores of plan allowance: posts and the
// products/menu items. Owners may turn one off and let the other use the
// unused part of the combined allowance.
export type ContentSectionKind = 'posts' | 'products';

export interface ContentSectionUsage {
  posts: number;
  products: number;
}

export interface ContentSectionAvailability {
  posts: boolean;
  products: boolean;
}

export interface ContentSectionCaps {
  posts: number | null;
  products: number | null;
}

export interface OwnerSectionShop {
  id: string;
  enablePostsSection: boolean;
  enableProductsSection: boolean;
}

export interface OwnerContentState {
  usage: ContentSectionUsage;
  availability: ContentSectionAvailability;
  shops: OwnerSectionShop[];
}

// The shared allowance exists only when both plan quotas are finite. An
// unlimited section has no ceiling to donate, so the other side keeps its own.
export function sharedContentAllowance(
  limits: Pick<SubscriptionLimits, 'maxTotalPosts' | 'maxProducts'>,
): number | null {
  const posts = limits.maxTotalPosts;
  const products = limits.maxProducts;
  return posts != null && products != null ? posts + products : null;
}

// Caps are maximum allowed counts (assertQuota blocks when used >= cap). A
// turned-off section donates only its unused quota: existing rows always keep
// counting, so hiding a full section never creates free room elsewhere.
export function contentSectionCaps(
  limits: Pick<SubscriptionLimits, 'maxTotalPosts' | 'maxProducts'>,
  usage: ContentSectionUsage,
  availability: ContentSectionAvailability,
): ContentSectionCaps {
  const posts = limits.maxTotalPosts ?? null;
  const products = limits.maxProducts ?? null;
  const allowance = sharedContentAllowance(limits);
  if (!availability.posts && !availability.products)
    return { posts: 0, products: 0 };
  if (!availability.posts)
    return {
      posts: 0,
      products:
        products == null || allowance == null
          ? products
          : products + Math.max(0, (posts ?? 0) - usage.posts),
    };
  if (!availability.products)
    return {
      posts:
        posts == null || allowance == null
          ? posts
          : posts + Math.max(0, (products ?? 0) - usage.products),
      products: 0,
    };
  // With both sections on, each keeps its plan quota while the shared ceiling
  // still limits the total, so a section can only use what the other left.
  return {
    posts:
      posts == null
        ? null
        : allowance == null
          ? posts
          : Math.min(posts, Math.max(0, allowance - usage.products)),
    products:
      products == null
        ? null
        : allowance == null
          ? products
          : Math.min(products, Math.max(0, allowance - usage.posts)),
  };
}

// Re-opening a section must leave at least one free slot. A section that still
// has rows can always be shown again; the rows already count toward the pool.
export function sectionHasRoom(
  section: ContentSectionKind,
  caps: ContentSectionCaps,
  usage: ContentSectionUsage,
): boolean {
  const cap = section === 'posts' ? caps.posts : caps.products;
  const used = section === 'posts' ? usage.posts : usage.products;
  return used > 0 || cap == null || cap > used;
}

// Section state for one owner: plan usage across every shop plus whether each
// section is still on somewhere. With no live shop there is no section to turn
// off, so both keep their plan quotas.
export async function ownerContentState(
  manager: EntityManager,
  ownerId: string,
): Promise<OwnerContentState> {
  const [posts, products, shops] = await Promise.all([
    manager.count(Showcase, { where: { ownerId } }),
    manager.count(Product, { where: { store: { ownerId } } }),
    manager.find(Store, {
      where: { ownerId, ...ownerWhere('store') },
      select: {
        id: true,
        enablePostsSection: true,
        enableProductsSection: true,
      },
    }),
  ]);
  return {
    usage: { posts, products },
    availability: shops.length
      ? {
          posts: shops.some((shop) => shop.enablePostsSection),
          products: shops.some((shop) => shop.enableProductsSection),
        }
      : { posts: true, products: true },
    shops,
  };
}
