import type { RenewalKind } from './entities';

// Renewal reminders cover exactly two events: a paid subscription and an add-on
// verification badge. The window is 48 hours because the sweep runs at 00:00:
// from midnight, "now + 48h" is exactly the end of tomorrow, so a target
// expiring today or tomorrow is included. With floor-day labels that reads as
// "less than a day" or "1 day", matching how owners describe the last day.
export const RENEWAL_WINDOW_MS = 2 * 86_400_000;
// Renewing adds one month, matching the verification period. It is a rolling
// 30 days from max(now, current end), never a calendar-month guess.
export const RENEWAL_PERIOD_DAYS = 30;

const DAY_MS = 86_400_000;

// A reminder is created only while the target is still running. Once it lapses
// the owner can no longer renew ahead of time, and the administrator's live
// queue shows it as lapsed instead.
export function renewalDue(expiresAt: Date | null, now = new Date()): boolean {
  if (!expiresAt) return false;
  const remaining = expiresAt.getTime() - now.getTime();
  return remaining > 0 && remaining < RENEWAL_WINDOW_MS;
}

// The administrator's queue also keeps lapsed rows until they are renewed, so
// the two sections never lose a person who still needs help.
export function renewalNeedsAttention(
  expiresAt: Date | null,
  now = new Date(),
): boolean {
  return Boolean(
    expiresAt && expiresAt.getTime() - now.getTime() < RENEWAL_WINDOW_MS,
  );
}

// Floor days so 47 hours reads as "1 day" and 23 hours as "less than a day".
// A lapsed target returns a negative number; callers label it as ended.
export function renewalDaysLeft(expiresAt: Date, now = new Date()): number {
  return Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS);
}

// Renewing continues from a running paid period and starts a fresh month when
// the old one already ended. The subscription extension and the badge extension
// share the same 30-day rule.
export function nextSubscriptionRenewalExpiry(
  currentExpiry: Date | null,
  now = new Date(),
): Date {
  const base =
    currentExpiry && currentExpiry.getTime() > now.getTime()
      ? currentExpiry
      : now;
  return new Date(base.getTime() + RENEWAL_PERIOD_DAYS * DAY_MS);
}

// One row per target per due instant. The database's unique index turns the
// daily sweep into an idempotent operation: a restart, a catch-up read, or a
// second API process can retry it without creating duplicates.
export function renewalNoticeKey(
  kind: RenewalKind,
  targetId: string,
  dueAt: Date,
): string {
  return `${kind}:${targetId}:${dueAt.getTime()}`;
}

// A notice is stale as soon as its target is renewed (the expiry moves), the
// badge is revoked, or the subscription stops being active. Stale rows are
// hidden instead of deleted so a concurrent sweep never races a read.
export function renewalNoticeIsLive(
  noticeDueAt: Date,
  targetExpiresAt: Date | null,
  stillRelevant: boolean,
): boolean {
  return Boolean(
    stillRelevant &&
    targetExpiresAt &&
    targetExpiresAt.getTime() === noticeDueAt.getTime(),
  );
}
