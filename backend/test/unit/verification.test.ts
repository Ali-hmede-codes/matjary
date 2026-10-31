import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  VERIFICATION_GRACE_DAYS,
  VERIFICATION_PERIOD_DAYS,
  includedBadgeExpiry,
  nextVerificationExpiry,
  verificationAddOnPriceCents,
  verificationBadgeInfo,
  verificationBadgeVisible,
  verificationGraceEndsAt,
  verificationPricing,
} from '../../libs/database/src/verification-policy';
import { Store } from '../../libs/database/src/entities';
import { VerificationSettings } from '../../libs/database/src/verification-settings.entity';
import { normalizeLebanesePhone } from '../../apps/api/src/modules/verification/verification-phone';
import { VerificationService } from '../../apps/api/src/modules/verification/verification.service';
import { UpdateVerificationSettingsDto } from '../../apps/api/src/modules/verification/dto/verification.dto';

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
  // The platform-wide price fills in when the plan sets no add-on price, so an
  // owner whose bundled slots are used can still buy a badge for this shop.
  assert.deepEqual(
    verificationPricing(
      { maxVerificationBadges: 1, verificationBadgePriceCents: null },
      {
        includedBadge: false,
        activeIncludedBadges: 1,
        fallbackPriceCents: 500,
      },
    ),
    { included: false, priceCents: 500, available: true },
  );
  // A plan that sets its own price keeps it instead of the platform fallback.
  assert.deepEqual(
    verificationPricing(
      { maxVerificationBadges: 0, verificationBadgePriceCents: 700 },
      {
        includedBadge: false,
        activeIncludedBadges: 0,
        fallbackPriceCents: 500,
      },
    ),
    { included: false, priceCents: 700, available: true },
  );
  // A free bundled slot never becomes a paid add-on just because the platform
  // sells badges to plans without one.
  assert.deepEqual(
    verificationPricing(
      { maxVerificationBadges: 1, verificationBadgePriceCents: null },
      {
        includedBadge: false,
        activeIncludedBadges: 0,
        fallbackPriceCents: 500,
      },
    ),
    { included: true, priceCents: 0, available: true },
  );
});

test('the add-on price stays visible even when a bundled slot pays', () => {
  // The plan's own add-on price wins over the platform-wide fallback.
  assert.equal(
    verificationAddOnPriceCents({ verificationBadgePriceCents: 700 }, 500),
    700,
  );
  // Plans that set no add-on price use the platform-wide one.
  assert.equal(
    verificationAddOnPriceCents({ verificationBadgePriceCents: null }, 500),
    500,
  );
  assert.equal(verificationAddOnPriceCents({}, 500), 500);
  // No configured price at all stays zero, so the tab asks the team instead.
  assert.equal(verificationAddOnPriceCents({}, 0), 0);
  // Negative input can never turn into a price.
  assert.equal(
    verificationAddOnPriceCents({ verificationBadgePriceCents: -5 }, -2),
    0,
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

test('platform badge settings accept a price and a callable number only', () => {
  const validate = (input: object) =>
    validateSync(plainToInstance(UpdateVerificationSettingsDto, input), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  assert.equal(validate({ badgePriceCents: 500 }).length, 0);
  assert.equal(validate({ contactPhone: ' +961 3 123 456 ' }).length, 0);
  assert.equal(validate({ contactPhone: null }).length, 0);
  assert.equal(
    plainToInstance(UpdateVerificationSettingsDto, { contactPhone: '   ' })
      .contactPhone,
    null,
  );
  for (const value of [-1, 1.5, '500', null])
    assert.ok(validate({ badgePriceCents: value }).length, String(value));
  for (const value of ['call-me', '+961 3 123 456 ext 9', 11])
    assert.ok(validate({ contactPhone: value }).length, String(value));
});

test('an administrator controls the platform badge price and payment number', async () => {
  const row = Object.assign(new VerificationSettings(), {
    id: 1,
    badgePriceCents: 0,
    contactPhone: null,
  });
  const audits: { action?: string; changedFields?: string[] }[] = [];
  const manager = {
    findOneBy: async (target: unknown) =>
      target === Store
        ? null
        : { id: 'admin', email: 'admin@example.test', suspendedAt: null },
    findOne: async (target: unknown, options: unknown) => {
      assert.equal(target, VerificationSettings);
      assert.deepEqual(Reflect.get(options as object, 'where'), { id: 1 });
      return row;
    },
    getRepository: (target: unknown) => {
      assert.equal(target, VerificationSettings);
      return { findOneBy: async () => row };
    },
    save: async (value: unknown) => value,
    insert: async (
      _target: unknown,
      value: { action?: string; changedFields?: string[] },
    ) => {
      audits.push(value);
    },
  };
  const service = new VerificationService(
    {
      manager,
      transaction: async (work: (value: unknown) => Promise<unknown>) =>
        work(manager),
    } as never,
    { get: () => 'admin@example.test' } as never,
  );
  const actor = { id: 'admin', requestId: 'request' };
  assert.deepEqual(await service.adminGetSettings(actor), {
    badgePriceCents: '0',
    currency: 'USD',
    contactPhone: null,
  });
  assert.deepEqual(
    await service.adminUpdateSettings(actor, {
      badgePriceCents: 500,
      contactPhone: '+961 3 123 456',
    }),
    {
      badgePriceCents: '500',
      currency: 'USD',
      contactPhone: '+961 3 123 456',
    },
  );
  assert.equal(row.badgePriceCents, 500);
  assert.equal(row.contactPhone, '+961 3 123 456');
  assert.equal(audits.at(-1)?.action, 'update');
  assert.deepEqual(audits.at(-1)?.changedFields, [
    'badgePriceCents',
    'contactPhone',
  ]);
});

test('an administrator can give a special shop unlimited verification', async () => {
  const store = Object.assign(new Store(), {
    id: 'shop',
    ownerId: 'owner',
    hasVerificationBadge: false,
    verificationBadgeExpiresAt: new Date('2026-11-20T00:00:00Z'),
    verificationIncludedInPlan: true,
  });
  const audits: { action?: string }[] = [];
  const manager = {
    findOneBy: async () => ({
      id: 'admin',
      email: 'admin@example.test',
      suspendedAt: null,
    }),
    findOne: async () => store,
    find: async () => [],
    save: async () => undefined,
    insert: async (_target: unknown, row: { action?: string }) => {
      audits.push(row);
    },
  };
  const service = new VerificationService(
    {
      manager,
      transaction: async (work: (value: unknown) => Promise<unknown>) =>
        work(manager),
    } as never,
    { get: () => 'admin@example.test' } as never,
  );
  await service.adminGrantUnlimited(
    { id: 'admin', requestId: 'request' },
    'shop',
    'Lifetime partner shop',
  );
  assert.equal(store.hasVerificationBadge, true);
  assert.equal(store.verificationBadgeExpiresAt, null);
  assert.equal(store.verificationIncludedInPlan, false);
  assert.equal(store.verificationBadgeGrantedBy, 'admin');
  assert.equal(audits.at(-1)?.action, 'verification.unlimited');
  // A lifetime badge has no month to extend and nothing for the owner to renew.
  await assert.rejects(
    service.adminExtend(
      { id: 'admin', requestId: 'request' },
      'shop',
      'Administrator adjustment',
    ),
    (error: any) =>
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code ===
        'VERIFICATION_UNLIMITED',
  );
  await assert.rejects(
    service.submit('shop', 'owner', {
      applicantName: 'Owner',
      phone: '03 123 456',
    }),
    (error: any) =>
      error instanceof ConflictException &&
      (error.getResponse() as { code?: string }).code ===
        'VERIFICATION_UNLIMITED',
  );
});
