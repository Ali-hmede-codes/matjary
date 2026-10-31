import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  billingLabel,
  planBadge,
  planCompareAtPriceCents,
  planFeatures,
  planPrice,
  planVerification,
  type SubscriptionPlan,
} from './pricing.ts';

const plan: SubscriptionPlan = {
  name: 'Basic',
  slug: 'basic',
  description: null,
  priceCents: '999',
  currency: 'USD',
  billingCycle: 'monthly',
  limits: {},
};

test('pricing labels the free plan as a configured trial', () => {
  assert.equal(
    planBadge({ ...plan, slug: 'free', priceCents: '0', trialDays: 7 }),
    '7-day free trial',
  );
  assert.equal(
    planBadge({ ...plan, slug: 'free', priceCents: '0', trialDays: null }),
    'Free plan',
  );
  assert.equal(planBadge(plan), 'Paid plan');
});

test('pricing preserves currency, exact cents and each supported billing period', () => {
  assert.equal(planPrice(plan), '$9.99');
  assert.equal(planPrice({ ...plan, priceCents: '0' }), '$0.00');
  assert.equal(
    planPrice({ ...plan, priceCents: '2500', currency: 'EUR' }),
    '€25.00',
  );
  assert.equal(
    planPrice({ ...plan, priceCents: '9007199254740999' }),
    '$90,071,992,547,409.99',
  );
  assert.equal(billingLabel('monthly'), '/ month');
  assert.equal(billingLabel('yearly'), '/ year');
  assert.equal(billingLabel('lifetime'), 'one-time');
});

test('pricing distinguishes zero, unlimited, missing quotas and disabled features', () => {
  const features = planFeatures({
    ...plan,
    limits: {
      maxTotalPosts: 200,
      maxShops: 5,
      maxCategories: 40,
      maxProducts: null,
      maxStorageBytes: 1073741824,
      enableCart: true,
      enableWhatsAppCheckout: false,
    },
  });
  const value = (label: string) =>
    features.find((feature) => feature.label === label)?.value;
  assert.equal(value('Max posts'), '200');
  assert.equal(value('Max shops'), '5');
  assert.equal(value('Max categories'), '40');
  assert.equal(value('Max products'), 'Unlimited');
  assert.equal(value('Media storage'), '1 GiB');
  assert.equal(value('Shopping cart'), true);
  assert.equal(value('WhatsApp checkout'), false);
  assert.equal(value('Analytics'), false);
  const verification = (limits: SubscriptionPlan['limits']) =>
    planFeatures({ ...plan, limits }).find(
      (feature) => feature.label === 'Verification badge',
    )?.value;
  assert.equal(verification({ maxVerificationBadges: 0 }), false);
  assert.equal(verification({ maxVerificationBadges: 1 }), '1 included');
  assert.equal(
    verification({
      maxVerificationBadges: 1,
      verificationBadgePriceCents: 500,
    }),
    '1 included · +$5.00/mo',
  );
  assert.equal(
    verification({
      maxVerificationBadges: 0,
      verificationBadgePriceCents: 500,
    }),
    '+$5.00/mo',
  );
  assert.equal(verification({ maxVerificationBadges: null }), 'Unlimited');
  for (const [bytes, expected] of [
    [null, 'Unlimited'],
    [0, '0 B'],
    [52428800, '50 MiB'],
  ] as const) {
    assert.equal(
      planFeatures({ ...plan, limits: { maxStorageBytes: bytes } }).find(
        (feature) => feature.label === 'Media storage',
      )?.value,
      expected,
    );
  }
});

test('pricing marks the third plan on sale from the fixed anchor', () => {
  const sale = (priceCents: string, index = 2, slug = 'premium') =>
    planCompareAtPriceCents({ ...plan, slug, priceCents }, index);
  assert.equal(sale('1999'), '2999');
  // A plan at or above the anchor must never advertise a fake discount.
  assert.equal(sale('2999'), null);
  assert.equal(sale('7900'), null);
  // Only the third tier (or Premium, if the order changes) is promoted.
  assert.equal(sale('1999', 0, 'basic'), null);
  // A malformed price is ignored exactly like a product's old price.
  assert.equal(sale('not-a-price'), null);
  // The slug keeps the sale on Premium when plans are reordered.
  assert.equal(sale('1999', 0, 'premium'), '2999');
});

test('pricing exposes the verification offer behind the badge block', () => {
  const verification = (limits: SubscriptionPlan['limits']) =>
    planVerification({ ...plan, limits });
  assert.equal(verification({}), null);
  assert.equal(verification({ maxVerificationBadges: 0 }), null);
  assert.deepEqual(verification({ maxVerificationBadges: null }), {
    unlimited: true,
    included: 0,
    addOnPriceCents: null,
  });
  assert.deepEqual(verification({ maxVerificationBadges: 2 }), {
    unlimited: false,
    included: 2,
    addOnPriceCents: null,
  });
  assert.deepEqual(
    verification({
      maxVerificationBadges: 0,
      verificationBadgePriceCents: 500,
    }),
    { unlimited: false, included: 0, addOnPriceCents: 500 },
  );
  assert.deepEqual(
    verification({ maxVerificationBadges: 1, verificationBadgePriceCents: 0 }),
    { unlimited: false, included: 1, addOnPriceCents: null },
  );
});
