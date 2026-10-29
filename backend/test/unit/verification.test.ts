import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  VERIFICATION_GRACE_DAYS,
  VERIFICATION_PERIOD_DAYS,
  includedBadgeExpiry,
  nextVerificationExpiry,
  verificationBadgeInfo,
  verificationBadgeVisible,
  verificationGraceEndsAt,
  verificationPricing,
} from '../../libs/database/src/verification-policy';
import { normalizeLebanesePhone } from '../../apps/api/src/modules/verification/verification-phone';

const now = new Date('2026-10-29T12:00:00Z');
const day = 86_400_000;

test('Lebanese phone numbers normalize to one callable form', () => {
  assert.equal(normalizeLebanesePhone('03 123 456'), '+9613123456');
  assert.equal(normalizeLebanesePhone('03123456'), '+9613123456');
  assert.equal(normalizeLebanesePhone('+961 3 123 456'), '+9613123456');
  assert.equal(normalizeLebanesePhone('00961 03 123 456'), '+9613123456');
  assert.equal(normalizeLebanesePhone('81 234 567'), '+96181234567');
  assert.equal(normalizeLebanesePhone('(01) 234-567'), '+9611234567');
  for (const invalid of [
    '',
    'letters',
    '+1 555 123 4567',
    '123',
    '03 12',
    '00000000',
  ])
    assert.equal(normalizeLebanesePhone(invalid), null, invalid);
});

test('a badge stays visible through the paid month and the grace window', () => {
  assert.equal(
    verificationBadgeInfo(
      { hasVerificationBadge: false, verificationBadgeExpiresAt: null },
      now,
    ).state,
    'none',
  );
  const lifetime = verificationBadgeInfo(
    { hasVerificationBadge: true, verificationBadgeExpiresAt: null },
    now,
  );
  assert.equal(lifetime.state, 'active');
  assert.equal(lifetime.visible, true);
  assert.equal(lifetime.daysRemaining, null);

  const paid = verificationBadgeInfo(
    {
      hasVerificationBadge: true,
      verificationBadgeExpiresAt: new Date(now.getTime() + 12 * day),
    },
    now,
  );
  assert.equal(paid.state, 'active');
  assert.equal(paid.visible, true);
  assert.equal(paid.daysRemaining, 12);

  const grace = verificationBadgeInfo(
    {
      hasVerificationBadge: true,
      verificationBadgeExpiresAt: new Date(now.getTime() - 3 * day),
    },
    now,
  );
  assert.equal(grace.state, 'grace');
  assert.equal(grace.visible, true);
  assert.equal(grace.daysRemaining, 2);
  assert.equal(
    grace.graceEndsAt?.toISOString(),
    new Date(now.getTime() - 3 * day + 5 * day).toISOString(),
  );

  const expired = verificationBadgeInfo(
    {
      hasVerificationBadge: true,
      verificationBadgeExpiresAt: new Date(now.getTime() - 6 * day),
    },
    now,
  );
  assert.equal(expired.state, 'expired');
  assert.equal(expired.visible, false);
  assert.equal(expired.daysRemaining, 0);
  assert.equal(
    verificationBadgeVisible(
      {
        hasVerificationBadge: true,
        verificationBadgeExpiresAt: new Date(now.getTime() - 6 * day),
      },
      now,
    ),
    false,
  );
  assert.equal(
    verificationGraceEndsAt(new Date(now.getTime() + day))?.toISOString(),
    new Date(now.getTime() + (1 + VERIFICATION_GRACE_DAYS) * day).toISOString(),
  );
});

test('renewing continues a running month and restarts a lapsed one', () => {
  const running = new Date(now.getTime() + 12 * day);
  assert.equal(
    nextVerificationExpiry(running, now).toISOString(),
    new Date(running.getTime() + VERIFICATION_PERIOD_DAYS * day).toISOString(),
  );
  assert.equal(
    nextVerificationExpiry(
      new Date(now.getTime() - 3 * day),
      now,
    ).toISOString(),
    new Date(now.getTime() + VERIFICATION_PERIOD_DAYS * day).toISOString(),
  );
  assert.equal(
    nextVerificationExpiry(null, now).toISOString(),
    new Date(now.getTime() + VERIFICATION_PERIOD_DAYS * day).toISOString(),
  );
});

test('pricing bundles a badge slot or sells the monthly add-on', () => {
  // One bundled badge on a store that does not have one yet.
  assert.deepEqual(
    verificationPricing(
      { maxVerificationBadges: 1, verificationBadgePriceCents: null },
      { includedBadge: false, activeIncludedBadges: 0 },
    ),
    { included: true, priceCents: 0, available: true },
  );
  // The bundled slot is taken by a sibling shop and no add-on price is set.
  assert.deepEqual(
    verificationPricing(
      { maxVerificationBadges: 1, verificationBadgePriceCents: null },
      { includedBadge: false, activeIncludedBadges: 1 },
    ),
    { included: false, priceCents: 0, available: false },
  );
  // The same shop renewing its own bundled slot never competes for it.
  assert.deepEqual(
    verificationPricing(
      { maxVerificationBadges: 1, verificationBadgePriceCents: null },
      { includedBadge: true, activeIncludedBadges: 1 },
    ),
    { included: true, priceCents: 0, available: true },
  );
  // A second shop renews the monthly add-on while the bundled slot is used;
  // the paid badge itself never frees or takes a bundled slot.
  assert.deepEqual(
    verificationPricing(
      { maxVerificationBadges: 1, verificationBadgePriceCents: 500 },
      { includedBadge: false, activeIncludedBadges: 1 },
    ),
    { included: false, priceCents: 500, available: true },
  );
  // A paid add-on is available even when the plan includes no badge.
  assert.deepEqual(
    verificationPricing(
      { maxVerificationBadges: 0, verificationBadgePriceCents: 500 },
      { includedBadge: false, activeIncludedBadges: 0 },
    ),
    { included: false, priceCents: 500, available: true },
  );
  // Unlimited bundles are always included.
  assert.deepEqual(
    verificationPricing(
      { maxVerificationBadges: null, verificationBadgePriceCents: 900 },
      { includedBadge: false, activeIncludedBadges: 4 },
    ),
    { included: true, priceCents: 0, available: true },
  );
  // Missing limits fail closed, like an expired plan.
  assert.deepEqual(
    verificationPricing({}, { includedBadge: false, activeIncludedBadges: 0 }),
    { included: false, priceCents: 0, available: false },
  );
});

test('a bundled badge ends with the subscription that pays for it', () => {
  const subscriptionEnd = new Date(now.getTime() + 10 * day);
  // A bundled renewal follows the subscription instead of a rolling month.
  assert.equal(
    includedBadgeExpiry(
      {
        subscriptionExpiresAt: subscriptionEnd,
        currentExpiry: new Date(now.getTime() + 3 * day),
        currentIncluded: true,
      },
      now,
    )?.toISOString(),
    subscriptionEnd.toISOString(),
  );
  // A shorter subscription pulls an older bundled end back with the plan.
  assert.equal(
    includedBadgeExpiry(
      {
        subscriptionExpiresAt: subscriptionEnd,
        currentExpiry: new Date(now.getTime() + 40 * day),
        currentIncluded: true,
      },
      now,
    )?.toISOString(),
    subscriptionEnd.toISOString(),
  );
  // A paid month already running past the subscription is never cut short.
  const paidEnd = new Date(now.getTime() + 40 * day);
  assert.equal(
    includedBadgeExpiry(
      {
        subscriptionExpiresAt: subscriptionEnd,
        currentExpiry: paidEnd,
        currentIncluded: false,
      },
      now,
    )?.toISOString(),
    paidEnd.toISOString(),
  );
  // A plan without an end date carries the bundled badge with no end either.
  assert.equal(
    includedBadgeExpiry(
      {
        subscriptionExpiresAt: null,
        currentExpiry: null,
        currentIncluded: true,
      },
      now,
    ),
    null,
  );
});
