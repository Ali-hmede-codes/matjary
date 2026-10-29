import type { SubscriptionLimits } from './entities';

// A verification badge is a monthly subscription. After the paid month ends the
// blue tick stays visible for a short grace window so an owner can renew, then
// it disappears on its own. The badge row itself is never deleted, so renewing
// later simply extends the same verification.
export const VERIFICATION_PERIOD_DAYS = 30;
export const VERIFICATION_GRACE_DAYS = 5;

const DAY_MS = 86_400_000;

export type VerificationBadgeState = 'none' | 'active' | 'grace' | 'expired';

export interface VerificationBadgeFields {
  hasVerificationBadge: boolean;
  verificationBadgeExpiresAt: Date | null;
}

export interface VerificationBadgeInfo {
  state: VerificationBadgeState;
  // True while the blue tick is shown publicly (paid period or grace).
  visible: boolean;
  expiresAt: Date | null;
  // The moment the tick disappears when the owner does not renew.
  graceEndsAt: Date | null;
  // Days left in the paid period, or in the grace window once it has ended.
  daysRemaining: number | null;
}

export function verificationGraceEndsAt(expiresAt: Date | null): Date | null {
  return expiresAt
    ? new Date(expiresAt.getTime() + VERIFICATION_GRACE_DAYS * DAY_MS)
    : null;
}

export function verificationBadgeInfo(
  badge: VerificationBadgeFields,
  now = new Date(),
): VerificationBadgeInfo {
  if (!badge.hasVerificationBadge)
    return {
      state: 'none',
      visible: false,
      expiresAt: null,
      graceEndsAt: null,
      daysRemaining: null,
    };
  const expiresAt = badge.verificationBadgeExpiresAt;
  // A badge without an expiry is a lifetime grant made by an older build or by
  // an administrator; it stays visible until it is revoked.
  if (!expiresAt)
    return {
      state: 'active',
      visible: true,
      expiresAt: null,
      graceEndsAt: null,
      daysRemaining: null,
    };
  const graceEndsAt = verificationGraceEndsAt(expiresAt)!;
  const remaining = expiresAt.getTime() - now.getTime();
  const state: VerificationBadgeState =
    remaining > 0 ? 'active' : graceEndsAt > now ? 'grace' : 'expired';
  const until =
    state === 'active' ? expiresAt : state === 'grace' ? graceEndsAt : null;
  return {
    state,
    visible: state === 'active' || state === 'grace',
    expiresAt,
    graceEndsAt,
    daysRemaining: until
      ? Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY_MS))
      : 0,
  };
}

export function verificationBadgeVisible(
  badge: VerificationBadgeFields,
  now = new Date(),
): boolean {
  return verificationBadgeInfo(badge, now).visible;
}

// Renewals continue from the current paid end when it is still ahead, and
// start a fresh month today when the badge already expired.
export function nextVerificationExpiry(
  currentExpiry: Date | null,
  now = new Date(),
): Date {
  const base =
    currentExpiry && currentExpiry.getTime() > now.getTime()
      ? currentExpiry
      : now;
  return new Date(base.getTime() + VERIFICATION_PERIOD_DAYS * DAY_MS);
}

export interface VerificationPricing {
  included: boolean;
  priceCents: number;
  available: boolean;
}

// Plans decide whether a badge is bundled (maxVerificationBadges) or sold as a
// monthly add-on (verificationBadgePriceCents). Renewing a badge that already
// belongs to this shop never competes with a sibling shop for the same slot.
export function verificationPricing(
  limits: Pick<
    SubscriptionLimits,
    'maxVerificationBadges' | 'verificationBadgePriceCents'
  >,
  input: { hasBadge: boolean; activeBadges: number },
): VerificationPricing {
  const maxBadges =
    limits.maxVerificationBadges === undefined
      ? 0
      : limits.maxVerificationBadges;
  const included =
    maxBadges === null ||
    (maxBadges > 0 && (input.hasBadge || input.activeBadges < maxBadges));
  const priceCents = included
    ? 0
    : Math.max(0, limits.verificationBadgePriceCents ?? 0);
  return { included, priceCents, available: included || priceCents > 0 };
}
