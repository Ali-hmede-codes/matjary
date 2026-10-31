import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RENEWAL_PERIOD_DAYS,
  RENEWAL_WINDOW_MS,
  nextSubscriptionRenewalExpiry,
  renewalDaysLeft,
  renewalDue,
  renewalNeedsAttention,
  renewalNoticeIsLive,
  renewalNoticeKey,
} from '../../libs/database/src/renewal-policy';
import { RenewalKind } from '../../libs/database/src/entities';
import {
  SUBSCRIPTION_GRACE_DAYS,
  subscriptionGraceEndsAt,
} from '../../libs/database/src/subscription-policy';
import { VERIFICATION_GRACE_DAYS } from '../../libs/database/src/verification-policy';
import { nextMidnightDelay } from '../../apps/api/src/modules/renewals/renewal-scheduler.service';
import { RenewalReminders1796078400000 } from '../../libs/database/src/migrations/1796078400000-RenewalReminders';
import type { QueryRunner } from 'typeorm';

const now = new Date('2026-10-31T12:00:00Z');
const day = 86_400_000;
const at = (ms: number) => new Date(now.getTime() + ms);

test('the reminder window covers today and tomorrow only', () => {
  assert.equal(RENEWAL_WINDOW_MS, 2 * day);
  assert.equal(renewalDue(at(47 * 3_600_000), now), true);
  assert.equal(renewalDue(at(23 * 3_600_000), now), true);
  // Exactly 48 hours later is the start of the day after tomorrow.
  assert.equal(renewalDue(at(48 * 3_600_000), now), false);
  assert.equal(renewalDue(at(49 * 3_600_000), now), false);
  assert.equal(renewalDue(at(-60_000), now), false);
  assert.equal(renewalDue(null, now), false);
});

test('the administrator queue also keeps lapsed renewals', () => {
  assert.equal(renewalNeedsAttention(at(-day), now), true);
  assert.equal(renewalNeedsAttention(at(47 * 3_600_000), now), true);
  assert.equal(renewalNeedsAttention(at(49 * 3_600_000), now), false);
  assert.equal(renewalNeedsAttention(null, now), false);
});

test('day labels read as less than a day, one day, or ended', () => {
  assert.equal(renewalDaysLeft(at(47 * 3_600_000), now), 1);
  assert.equal(renewalDaysLeft(at(23 * 3_600_000), now), 0);
  assert.equal(renewalDaysLeft(at(-60_000), now), -1);
  assert.equal(renewalDaysLeft(at(-2 * day), now), -2);
});

test('renewing continues a running period and restarts a lapsed one', () => {
  const running = at(12 * day);
  assert.equal(
    nextSubscriptionRenewalExpiry(running, now).toISOString(),
    new Date(running.getTime() + RENEWAL_PERIOD_DAYS * day).toISOString(),
  );
  assert.equal(
    nextSubscriptionRenewalExpiry(at(-3 * day), now).toISOString(),
    new Date(now.getTime() + RENEWAL_PERIOD_DAYS * day).toISOString(),
  );
  assert.equal(
    nextSubscriptionRenewalExpiry(null, now).toISOString(),
    new Date(now.getTime() + RENEWAL_PERIOD_DAYS * day).toISOString(),
  );
  assert.equal(RENEWAL_PERIOD_DAYS, 30);
});

test('one notice key per target and due instant', () => {
  const dueAt = at(3 * 3_600_000);
  const key = renewalNoticeKey(RenewalKind.SUBSCRIPTION, 'target-1', dueAt);
  assert.equal(key, `subscription:target-1:${dueAt.getTime()}`);
  assert.equal(
    renewalNoticeKey(RenewalKind.VERIFICATION, 'target-1', dueAt),
    `verification:target-1:${dueAt.getTime()}`,
  );
  // A renewed target has a new expiry, so it gets a new key later.
  assert.notEqual(
    renewalNoticeKey(RenewalKind.SUBSCRIPTION, 'target-1', at(day)),
    key,
  );
});

test('a stored reminder is live only while its target still matches', () => {
  const dueAt = at(3 * 3_600_000);
  assert.equal(renewalNoticeIsLive(dueAt, dueAt, true), true);
  // Renewing moves the expiry, which hides the old reminder.
  assert.equal(renewalNoticeIsLive(dueAt, at(30 * day), true), false);
  // A revoked badge or cancelled plan hides it too.
  assert.equal(renewalNoticeIsLive(dueAt, dueAt, false), false);
  assert.equal(renewalNoticeIsLive(dueAt, null, true), false);
});

test('the renewal migration keeps small, reversible DDL steps', async () => {
  const queries: string[] = [];
  const runner = {
    async query(sql: string) {
      const statement = sql.trim().replace(/;$/, '').replace(/\s+/g, ' ');
      assert.doesNotMatch(statement, /;\s*\S/, 'One SQL statement per query');
      queries.push(statement);
    },
  } as unknown as QueryRunner;
  const migration = new RenewalReminders1796078400000();

  await migration.up(runner);
  assert.equal(queries.length, 4);
  assert.match(queries[0] ?? '', /^ALTER TABLE `user_subscriptions`/);
  assert.match(queries[1] ?? '', /^ALTER TABLE `stores`/);
  assert.match(
    queries[2] ?? '',
    /^CREATE INDEX `idx_stores_verification_expiry`/,
  );
  assert.match(queries[3] ?? '', /^CREATE TABLE `renewal_notices`/);
  assert.match(queries[3] ?? '', /uq_renewal_notices_dedupe/);

  queries.length = 0;
  await migration.down(runner);
  assert.equal(queries.length, 4);
  assert.equal(queries[0], 'DROP TABLE `renewal_notices`');
  assert.match(
    queries[1] ?? '',
    /^DROP INDEX `idx_stores_verification_expiry`/,
  );
  assert.match(queries[2] ?? '', /DROP COLUMN `renewal_declined_at`/);
  assert.match(queries[3] ?? '', /DROP COLUMN `renewal_declined_at`/);
});

test('the plan and badge grace windows stay aligned at seven days', () => {
  assert.equal(SUBSCRIPTION_GRACE_DAYS, 7);
  assert.equal(VERIFICATION_GRACE_DAYS, SUBSCRIPTION_GRACE_DAYS);
  assert.equal(
    subscriptionGraceEndsAt(now)?.getTime(),
    now.getTime() + 7 * day,
  );
});

test('the midnight timer follows the business time zone, not the server one', () => {
  // 21:30 UTC is 23:30 in Beirut in January (UTC+2), so midnight is 30 minutes
  // away regardless of where the API process runs.
  assert.equal(
    nextMidnightDelay(new Date('2026-01-15T21:30:00.000Z'), 'Asia/Beirut'),
    30 * 60_000,
  );
  // The same instant in UTC still means local midnight in Beirut, not UTC.
  assert.equal(
    nextMidnightDelay(new Date('2026-01-15T22:00:00.000Z'), 'Asia/Beirut'),
    24 * 60 * 60_000,
  );
});
