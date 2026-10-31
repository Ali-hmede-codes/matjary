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
import { VERIFICATION_GRACE_DAYS } from './verification-policy';

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

// A lapsed plan keeps its shop public, with the owner read-only, for one week.
// When the window ends the sweeper locks the shop (hidden, renew only) and
// queues its media for the lossless archive tier. The same seven days apply to
// an add-on verification badge's grace window.
export const SUBSCRIPTION_GRACE_DAYS = 7;

export type SubscriptionPhase = 'active' | 'grace' | 'locked';

export interface SubscriptionLifecycle {
  phase: SubscriptionPhase;
  // End of the paid period. Null means the plan has no end date.
  endsAt: Date | null;
  // Moment the public grace window ends and the shop is locked.
  graceEndsAt: Date | null;
  // Days left in the paid period, or in the grace window once it ended.
  daysRemaining: number | null;
}

export function subscriptionGraceEndsAt(endsAt: Date | null): Date | null {
  return endsAt
    ? new Date(endsAt.getTime() + SUBSCRIPTION_GRACE_DAYS * DAY_MS)
    : null;
}

// Boundaries are exclusive: the moment the paid period ends the phase becomes
// `grace`, and the moment the window ends it becomes `locked`. A plan with no
// end date never locks, which matches the admin-assigned never-ending plan.
export function subscriptionLifecycle(
  endsAt: Date | null,
  now = new Date(),
): SubscriptionLifecycle {
  if (!endsAt)
    return {
      phase: 'active',
      endsAt: null,
      graceEndsAt: null,
      daysRemaining: null,
    };
  const graceEndsAt = subscriptionGraceEndsAt(endsAt)!;
  const remaining = (until: Date) =>
    Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY_MS));
  if (now.getTime() < endsAt.getTime())
    return {
      phase: 'active',
      endsAt,
      graceEndsAt,
      daysRemaining: remaining(endsAt),
    };
  if (now.getTime() < graceEndsAt.getTime())
    return {
      phase: 'grace',
      endsAt,
      graceEndsAt,
      daysRemaining: remaining(graceEndsAt),
    };
  return { phase: 'locked', endsAt, graceEndsAt, daysRemaining: 0 };
}

// When an abandoned free-trial shop becomes eligible for permanent deletion.
// The clock starts at the lock (trial end + grace window), and only trial-only
// accounts qualify. Hours of 0 disables deletion entirely.
export function trialDeletionAt(
  lockedAt: Date | null,
  hours: number,
): Date | null {
  if (!lockedAt || hours <= 0) return null;
  return new Date(lockedAt.getTime() + hours * 3_600_000);
}

export function trialDeletionDue(
  lockedAt: Date | null,
  hours: number,
  now = new Date(),
): boolean {
  const at = trialDeletionAt(lockedAt, hours);
  return Boolean(at && at.getTime() <= now.getTime());
}

// When the grace clock starts for the newest subscription row. An active row
// uses its recorded end date; a cancelled row was ended early, so the
// cancellation moment wins when it is earlier than the old end date. A paid
// plan with no end date never starts the clock.
export function subscriptionLockAnchor(
  row: Pick<UserSubscription, 'expiresAt' | 'status' | 'updatedAt'>,
): Date | null {
  if (row.status === SubscriptionStatus.ACTIVE) return row.expiresAt;
  if (row.status === SubscriptionStatus.CANCELLED) {
    if (!row.expiresAt) return row.updatedAt;
    return row.expiresAt.getTime() < row.updatedAt.getTime()
      ? row.expiresAt
      : row.updatedAt;
  }
  return row.expiresAt ?? row.updatedAt;
}

export interface SubscriptionState {
  state: 'trial' | 'paid' | 'expired';
  subscription: UserSubscription | null;
  planName: string | null;
  planSlug: string | null;
  expiresAt: Date | null;
  daysRemaining: number | null;
  // Where the account sits after the paid period: active, the seven-day grace
  // window (shops stay public and read-only), or locked (shops hidden).
  phase: SubscriptionPhase;
  graceEndsAt: Date | null;
  // The owner asked the team to renew the newest assignment.
  renewalRequestedAt: Date | null;
}

// One row is effective only while it runs and its plan is loaded. The free plan
// is the trial plan; an unbounded free row is stale state and must not grant
// permanent access. Shared so batched reads (admin owner pickers) never drift
// from the single-user lookup.
export function isEffectiveSubscription(
  subscription: UserSubscription,
  now = new Date(),
): boolean {
  return Boolean(
    subscription.startsAt <= now &&
    (!subscription.expiresAt || subscription.expiresAt > now) &&
    subscription.plan &&
    (subscription.plan.slug !== 'free' || subscription.expiresAt != null),
  );
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
    subscriptions.find((subscription) =>
      isEffectiveSubscription(subscription, now),
    ) ?? null
  );
}

export async function subscriptionState(
  manager: EntityManager,
  userId: string,
  now = new Date(),
): Promise<SubscriptionState> {
  const subscription = await effectiveSubscription(manager, userId, now);
  if (!subscription || !subscription.plan) {
    // No live assignment: the newest row still tells the dashboard when the
    // grace window ends, so the lock appears on its own without a scheduler read.
    const latestRows = await manager.getRepository(UserSubscription).find({
      where: { userId },
      relations: ['plan'],
      order: { startsAt: 'DESC' },
      take: 1,
    });
    const latest = latestRows[0] ?? null;
    const lifecycle = subscriptionLifecycle(
      latest ? subscriptionLockAnchor(latest) : null,
      now,
    );
    return {
      state: 'expired',
      subscription: null,
      // The newest row still names the plan that ended, so the dashboard can
      // offer the plans page for a free trial instead of a renewal request.
      planName: latest?.plan?.name ?? null,
      planSlug: latest?.plan?.slug ?? null,
      expiresAt: latest?.expiresAt ?? null,
      daysRemaining: lifecycle.daysRemaining,
      phase: lifecycle.phase,
      graceEndsAt: lifecycle.graceEndsAt,
      renewalRequestedAt: latest?.renewalRequestedAt ?? null,
    };
  }
  const trial = subscription.plan.slug === 'free';
  const expiresAt = subscription.expiresAt ?? null;
  const lifecycle = subscriptionLifecycle(expiresAt, now);
  return {
    state: trial ? 'trial' : 'paid',
    subscription,
    planName: subscription.plan.name,
    planSlug: subscription.plan.slug,
    expiresAt,
    daysRemaining: expiresAt
      ? Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS))
      : null,
    phase: lifecycle.phase,
    graceEndsAt: lifecycle.graceEndsAt,
    renewalRequestedAt: subscription.renewalRequestedAt,
  };
}

// Limits of an already loaded subscription. Callers that inspect several owners
// at once (the admin owner picker) resolve them in one batch instead of paying a
// query per row, while the rules stay identical to `effectiveLimits`.
export function limitsFromSubscription(
  subscription: UserSubscription | null,
): SubscriptionLimits {
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

export async function effectiveLimits(
  manager: EntityManager,
  userId: string,
  now = new Date(),
): Promise<SubscriptionLimits> {
  return limitsFromSubscription(
    await effectiveSubscription(manager, userId, now),
  );
}

// Plan-bundled verification badges are paid by the subscription, so they
// follow the plan: a new or extended subscription moves their end date, and a
// plan without badge slots ends them (the usual grace window still applies).
// Only badges still inside the renewal window are touched, so a lapsed badge is
// never revived without a fresh administrator review. Shared by plan assignment
// and the one-click monthly extension so both write the same dates.
export async function syncIncludedBadgesForOwner(
  manager: EntityManager,
  userId: string,
  next: { included: boolean; expiresAt: Date | null },
  now = new Date(),
): Promise<number> {
  const graceBorder = new Date(
    now.getTime() - VERIFICATION_GRACE_DAYS * DAY_MS,
  );
  const stores = await manager
    .getRepository(Store)
    .createQueryBuilder('store')
    .where('store.ownerId = :userId', { userId })
    .andWhere('store.hasVerificationBadge = true')
    .andWhere('store.verificationIncludedInPlan = true')
    .andWhere(
      '(store.verificationBadgeExpiresAt IS NULL OR store.verificationBadgeExpiresAt > :graceBorder)',
      { graceBorder },
    )
    .setLock('pessimistic_write')
    .getMany();
  for (const store of stores) {
    if (!next.included) store.verificationIncludedInPlan = false;
    if (next.included && next.expiresAt === null) {
      // The plan itself never ends, so the bundled badge does not either.
      store.verificationBadgeExpiresAt = null;
    } else if (next.expiresAt && next.expiresAt.getTime() > now.getTime()) {
      store.verificationBadgeExpiresAt = next.expiresAt;
    } else if (
      !store.verificationBadgeExpiresAt ||
      store.verificationBadgeExpiresAt.getTime() > now.getTime()
    ) {
      // Cancelled or slotless plans end the bundled badge now; a badge already
      // inside its renewal window keeps the original end date.
      store.verificationBadgeExpiresAt = now;
    }
  }
  if (stores.length) await manager.save(stores);
  return stores.length;
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
