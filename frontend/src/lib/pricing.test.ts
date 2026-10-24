import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  billingLabel,
  planBadge,
  planFeatures,
  planPrice,
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
      maxPostsPerMonth: 0,
      maxProducts: null,
      maxStorageBytes: 1073741824,
      enableCart: true,
      enableWhatsAppCheckout: false,
    },
  });
  const value = (label: string) =>
    features.find((feature) => feature.label === label)?.value;
  assert.equal(value('Posts per month'), '0');
  assert.equal(value('Total posts'), 'Not specified');
  assert.equal(value('Products'), 'Unlimited');
  assert.equal(value('Media storage'), '1 GiB');
  assert.equal(value('Shopping cart'), true);
  assert.equal(value('WhatsApp checkout'), false);
  assert.equal(value('Analytics'), false);
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
