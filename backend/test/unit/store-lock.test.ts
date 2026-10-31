import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FindOperator, type EntityManager } from 'typeorm';
import {
  Store,
  StoreMediaArchiveState,
  StoreStatus,
  SubscriptionStatus,
  UserSubscription,
} from '../../libs/database/src/entities';
import {
  SUBSCRIPTION_GRACE_DAYS,
  subscriptionGraceEndsAt,
  subscriptionLifecycle,
  subscriptionLockAnchor,
  trialDeletionAt,
  trialDeletionDue,
} from '../../libs/database/src/subscription-policy';
import {
  isTrialOnlyOwner,
  trialShopsDueForDeletion,
} from '../../libs/database/src/trial-cleanup';
import {
  lockOwnerShops,
  lockedShopsForOwner,
  unlockOwnerShops,
} from '../../libs/database/src/store-lock';
import { SubscriptionLockLifecycle1796164800000 } from '../../libs/database/src/migrations/1796164800000-SubscriptionLockLifecycle';
import type { QueryRunner } from 'typeorm';

const DAY = 86_400_000;
const now = new Date('2026-10-31T12:00:00Z');
const at = (ms: number) => new Date(now.getTime() + ms);

function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => {
    if (value instanceof FindOperator) {
      const expected = value.value as unknown;
      if (value.type === 'isNull') return row[key] == null;
      if (value.type === 'not') {
        if (expected instanceof FindOperator && expected.type === 'isNull')
          return row[key] != null;
        if (Array.isArray(expected)) return !expected.includes(row[key]);
        return row[key] !== expected;
      }
      return value.type === 'in' && Array.isArray(expected)
        ? expected.includes(row[key])
        : true;
    }
    return row[key] === value;
  });
}

// The status column is update:false, so lock/unlock use guarded raw SQL; this
// fake mirrors those guards and nothing else.
function fakeManager(rows: Store[], raw: unknown[] = []) {
  const manager = {
    find: async (
      target: unknown,
      options: { where: Record<string, unknown> },
    ) =>
      target === Store
        ? rows.filter((row) => matches(row as never, options.where))
        : [],
    query: async (sql: string, parameters: unknown[] = []) => {
      if (sql.startsWith('UPDATE stores SET status = ?')) {
        const unlocking = /subscription_locked_at = NULL/.test(sql);
        const id = parameters[unlocking ? 2 : 3] as string;
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) return { affectedRows: 0 };
        const alreadyMoved = unlocking
          ? row.subscriptionLockedAt == null
          : row.subscriptionLockedAt != null;
        if (alreadyMoved) return { affectedRows: 0 };
        row.status = parameters[0] as StoreStatus;
        row.subscriptionLockedAt = unlocking ? null : (parameters[1] as Date);
        row.mediaArchiveState = parameters[
          unlocking ? 1 : 2
        ] as StoreMediaArchiveState;
        return { affectedRows: 1 };
      }
      if (sql.includes('AS lockedAt')) return raw;
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  return manager as unknown as EntityManager;
}

const shop = (overrides: Partial<Store>) =>
  Object.assign(new Store(), {
    id: 'shop',
    ownerId: 'owner',
    status: StoreStatus.ACTIVE,
    mediaArchiveState: StoreMediaArchiveState.NONE,
    subscriptionLockedAt: null,
    adminArchivedAt: null,
    ...overrides,
  });

test('the plan grace window is seven days and never cuts a running period', () => {
  assert.equal(SUBSCRIPTION_GRACE_DAYS, 7);
  const endsAt = at(3 * DAY);
  assert.equal(
    subscriptionGraceEndsAt(endsAt)?.toISOString(),
    new Date(endsAt.getTime() + 7 * DAY).toISOString(),
  );
  assert.equal(subscriptionGraceEndsAt(null), null);

  const running = subscriptionLifecycle(endsAt, now);
  assert.equal(running.phase, 'active');
  assert.equal(running.daysRemaining, 3);

  const exactlyEnded = subscriptionLifecycle(endsAt, endsAt);
  assert.equal(exactlyEnded.phase, 'grace');
  assert.equal(exactlyEnded.daysRemaining, 7);

  const lateGrace = subscriptionLifecycle(
    endsAt,
    new Date(endsAt.getTime() + 6 * DAY),
  );
  assert.equal(lateGrace.phase, 'grace');
  assert.equal(lateGrace.daysRemaining, 1);

  const boundary = subscriptionLifecycle(
    endsAt,
    new Date(endsAt.getTime() + 7 * DAY),
  );
  assert.equal(boundary.phase, 'locked');
  assert.equal(boundary.daysRemaining, 0);

  // A plan with no end date is the administrator's never-ending plan.
  assert.equal(subscriptionLifecycle(null, now).phase, 'active');
});

test('the lock anchor follows the real end of the newest assignment', () => {
  const expiresAt = at(5 * DAY);
  const row = (extra: Partial<UserSubscription>) =>
    ({
      expiresAt,
      status: SubscriptionStatus.ACTIVE,
      updatedAt: now,
      ...extra,
    }) as UserSubscription;
  assert.equal(
    subscriptionLockAnchor(row({}))?.toISOString(),
    expiresAt.toISOString(),
  );
  // A paid plan without an end date never starts the clock.
  assert.equal(subscriptionLockAnchor(row({ expiresAt: null })), null);
  // Cancelling ends the paid period early: the cancellation time wins.
  assert.equal(
    subscriptionLockAnchor(
      row({ status: SubscriptionStatus.CANCELLED, updatedAt: at(-DAY) }),
    )?.toISOString(),
    at(-DAY).toISOString(),
  );
  // A cancellation after the old end date keeps the real end date.
  assert.equal(
    subscriptionLockAnchor(
      row({ status: SubscriptionStatus.CANCELLED, updatedAt: at(10 * DAY) }),
    )?.toISOString(),
    expiresAt.toISOString(),
  );
  // Expired rows keep their recorded end date.
  assert.equal(
    subscriptionLockAnchor(
      row({ status: SubscriptionStatus.EXPIRED, updatedAt: at(10 * DAY) }),
    )?.toISOString(),
    expiresAt.toISOString(),
  );
});

test('locking freezes only public shops and keeps the owner choice elsewhere', async () => {
  const active = shop({ id: 'active' });
  const offline = shop({ id: 'offline', status: StoreStatus.OFFLINE });
  const archived = shop({ id: 'archived', status: StoreStatus.ARCHIVED });
  const trashed = shop({ id: 'trashed', status: StoreStatus.TRASHED });
  const moderated = shop({ id: 'moderated', adminArchivedAt: at(-DAY) });
  const already = shop({ id: 'already', subscriptionLockedAt: at(-DAY) });
  const otherOwner = shop({ id: 'other', ownerId: 'someone-else' });
  const manager = fakeManager([
    active,
    offline,
    archived,
    trashed,
    moderated,
    already,
    otherOwner,
  ]);

  assert.equal(await lockOwnerShops(manager, 'owner', now), 3);
  assert.equal(active.status, StoreStatus.LOCKED);
  assert.equal(offline.status, StoreStatus.OFFLINE);
  assert.equal(archived.status, StoreStatus.ARCHIVED);
  assert.equal(trashed.subscriptionLockedAt, null);
  assert.equal(moderated.subscriptionLockedAt, null);
  assert.equal(already.subscriptionLockedAt?.getTime(), at(-DAY).getTime());
  assert.equal(otherOwner.subscriptionLockedAt, null);
  for (const row of [active, offline, archived])
    assert.equal(row.subscriptionLockedAt?.getTime(), now.getTime());
  // A fresh lock queues the archive pass; the other shops keep their state.
  for (const row of [active, offline, archived])
    assert.equal(row.mediaArchiveState, StoreMediaArchiveState.PENDING);

  // Idempotent: every remaining shop already carries a lock date.
  assert.equal(await lockOwnerShops(manager, 'owner', now), 0);
});

test('a renewal reopens locked shops and queues the media restore', async () => {
  const locked = shop({
    id: 'locked',
    status: StoreStatus.LOCKED,
    mediaArchiveState: StoreMediaArchiveState.ARCHIVED,
    subscriptionLockedAt: at(-DAY),
  });
  const lockedPending = shop({
    id: 'pending',
    status: StoreStatus.LOCKED,
    mediaArchiveState: StoreMediaArchiveState.PENDING,
    subscriptionLockedAt: at(-DAY),
  });
  const lockedOffline = shop({
    id: 'offline',
    status: StoreStatus.OFFLINE,
    mediaArchiveState: StoreMediaArchiveState.NONE,
    subscriptionLockedAt: at(-DAY),
  });
  const unrestricted = shop({ id: 'free' });
  const manager = fakeManager([
    locked,
    lockedPending,
    lockedOffline,
    unrestricted,
  ]);

  assert.equal(await unlockOwnerShops(manager, 'owner'), 3);
  assert.equal(locked.status, StoreStatus.ACTIVE);
  assert.equal(locked.subscriptionLockedAt, null);
  assert.equal(locked.mediaArchiveState, StoreMediaArchiveState.RESTORING);
  // A queued or failed pass may have moved some bytes; the restorer normalizes.
  assert.equal(
    lockedPending.mediaArchiveState,
    StoreMediaArchiveState.RESTORING,
  );
  // The owner's own status is preserved, and nothing was archived.
  assert.equal(lockedOffline.status, StoreStatus.OFFLINE);
  assert.equal(lockedOffline.mediaArchiveState, StoreMediaArchiveState.NONE);
  // Shops that were never locked are untouched.
  assert.equal(unrestricted.status, StoreStatus.ACTIVE);
  assert.equal(unrestricted.mediaArchiveState, StoreMediaArchiveState.NONE);
});

test('the renewal page lists locked shops with their content counts', async () => {
  const manager = fakeManager(
    [],
    [
      {
        id: 'shop-1',
        name: 'Atelier',
        slug: 'atelier',
        lockedAt: now,
        mediaArchiveState: StoreMediaArchiveState.ARCHIVED,
        productsCount: '4',
        postsCount: 7,
      },
    ],
  );
  assert.deepEqual(await lockedShopsForOwner(manager, 'owner'), [
    {
      id: 'shop-1',
      name: 'Atelier',
      slug: 'atelier',
      lockedAt: now,
      mediaArchiveState: StoreMediaArchiveState.ARCHIVED,
      productsCount: 4,
      postsCount: 7,
    },
  ]);
});

test('trial shops are deleted only after the configured retention delay', () => {
  const lockedAt = at(-3 * DAY);
  assert.equal(trialDeletionAt(null, 24), null);
  assert.equal(trialDeletionAt(lockedAt, 0), null);
  assert.equal(
    trialDeletionAt(lockedAt, 24)?.toISOString(),
    new Date(lockedAt.getTime() + DAY).toISOString(),
  );
  assert.equal(trialDeletionDue(lockedAt, 24, now), true);
  assert.equal(
    trialDeletionDue(at(-30 * 60_000), 24, now),
    false,
    'the shop must stay for the full retention window',
  );
  assert.equal(trialDeletionDue(lockedAt, 0, now), false);
});

test('only trial-only accounts qualify for automatic shop deletion', async () => {
  const queries: { sql: string; parameters: unknown[] }[] = [];
  const managerFor = (trial: number, paid: number) =>
    ({
      query: async (sql: string, parameters: unknown[] = []) => {
        queries.push({ sql, parameters });
        if (sql.includes('AS trial')) return [{ trial, paid }];
        return [{ id: 'shop-1', ownerId: 'owner' }];
      },
    }) as unknown as EntityManager;

  assert.equal(await isTrialOnlyOwner(managerFor(1, 0), 'owner'), true);
  assert.equal(await isTrialOnlyOwner(managerFor(1, 1), 'owner'), false);
  assert.equal(await isTrialOnlyOwner(managerFor(0, 0), 'owner'), false);

  const cutoff = at(-DAY);
  assert.deepEqual(
    await trialShopsDueForDeletion(managerFor(1, 0), cutoff, 5),
    [{ id: 'shop-1', ownerId: 'owner' }],
  );
  const statement = queries.at(-1)!;
  assert.deepEqual(statement.parameters, [cutoff]);
  // Paid history is a permanent opt-out, and a shop still moving bytes waits.
  assert.match(statement.sql, /pp\.slug <> 'free'/);
  assert.match(
    statement.sql,
    /media_archive_state IN \('none', 'archived', 'failed'\)/,
  );
  assert.match(statement.sql, /subscription_locked_at <= \?/);
  assert.match(statement.sql, /LIMIT 5/);
});

test('the lock migration keeps small, reversible DDL steps', async () => {
  const queries: string[] = [];
  const runner = {
    async query(sql: string) {
      const statement = sql.trim().replace(/;$/, '').replace(/\s+/g, ' ');
      assert.doesNotMatch(statement, /;\s*\S/, 'One SQL statement per query');
      queries.push(statement);
    },
  } as unknown as QueryRunner;
  const migration = new SubscriptionLockLifecycle1796164800000();

  await migration.up(runner);
  assert.equal(queries.length, 6);
  assert.match(queries[0] ?? '', /^ALTER TABLE `stores` MODIFY `status` ENUM/);
  assert.match(queries[0] ?? '', /'locked'/);
  assert.match(
    queries[1] ?? '',
    /^ALTER TABLE `stores` ADD COLUMN `subscription_locked_at`/,
  );
  assert.match(
    queries[2] ?? '',
    /^CREATE INDEX `idx_stores_subscription_lock`/,
  );
  assert.match(
    queries[3] ?? '',
    /^ALTER TABLE `stores` ADD COLUMN `media_archive_state`/,
  );
  assert.match(queries[4] ?? '', /^CREATE INDEX `idx_stores_media_archive`/);
  assert.match(queries[5] ?? '', /^ALTER TABLE `user_subscriptions`/);

  queries.length = 0;
  await migration.down(runner);
  assert.equal(queries.length, 7);
  // Locked rows must leave the enum before it loses the value.
  assert.match(queries[2] ?? '', /UPDATE `stores` SET `status` = 'archived'/);
  assert.match(
    queries[6] ?? '',
    /MODIFY `status` ENUM\('active', 'offline', 'archived', 'trashed'\)/,
  );
});
