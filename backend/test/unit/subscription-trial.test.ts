import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import {
  validateEnvironment,
  type AppEnvironment,
} from '../../libs/config/src/environment';
import {
  SubscriptionPlan,
  SubscriptionStatus,
  User,
  UserSubscription,
} from '../../libs/database/src/entities';
import { FreeTrialService } from '../../apps/api/src/modules/users/free-trial.service';
import { SubscriptionPlansService } from '../../apps/api/src/modules/subscriptions/subscription-plans.service';

const DAY_MS = 86_400_000;
const config = new ConfigService<AppEnvironment, true>(
  validateEnvironment({
    MYSQL_PASSWORD: 'test',
    REDIS_PASSWORD: 'test',
  }),
);

function trialFixture(
  options: { history?: number; plan?: unknown; user?: unknown } = {},
) {
  const saved: any[] = [];
  const manager = {
    findOne: async (target: unknown) => {
      if (target === User)
        return 'user' in options
          ? options.user
          : { id: 'user-1', suspendedAt: null };
      if (target === SubscriptionPlan)
        return 'plan' in options
          ? options.plan
          : { id: 'plan-free', slug: 'free', isActive: true };
      return null;
    },
    count: async (target: unknown) => {
      assert.equal(target, UserSubscription);
      return options.history ?? 0;
    },
    create: (_target: unknown, value: unknown) => value,
    save: async (_target: unknown, value: unknown) => {
      saved.push(value);
      return value;
    },
  };
  const repository = {
    manager: {
      transaction: async (work: (manager: unknown) => Promise<unknown>) =>
        work(manager),
    },
  };
  return {
    service: new FreeTrialService(
      repository as unknown as Repository<User>,
      config,
    ),
    saved,
  };
}

test('a new account starts exactly one bounded free trial', async () => {
  const { service, saved } = trialFixture();
  await service.startIfNew('user-1');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].userId, 'user-1');
  assert.equal(saved[0].planId, 'plan-free');
  assert.equal(saved[0].status, SubscriptionStatus.ACTIVE);
  assert.equal(saved[0].assignedBy, null);
  assert.equal(saved[0].notes, 'Free trial');
  assert.equal(
    saved[0].expiresAt.getTime() - saved[0].startsAt.getTime(),
    7 * DAY_MS,
  );
});

test('existing subscription history never starts another automatic trial', async () => {
  const { service, saved } = trialFixture({ history: 1 });
  await service.startIfNew('user-1');
  assert.equal(saved.length, 0);
});

test('suspended accounts and a missing free plan never create a trial', async () => {
  const suspended = trialFixture({
    user: { id: 'user-1', suspendedAt: new Date() },
  });
  await suspended.service.startIfNew('user-1');
  assert.equal(suspended.saved.length, 0);

  const missingPlan = trialFixture({ plan: null });
  await assert.rejects(
    missingPlan.service.startIfNew('user-1'),
    (error: unknown) =>
      error instanceof ServiceUnavailableException &&
      error.message === 'Free plan is unavailable',
  );
  assert.equal(missingPlan.saved.length, 0);
});

test('storage failures are sanitized and never leak driver details', async () => {
  const repository = {
    manager: {
      transaction: async () => {
        throw new Error('private database host');
      },
    },
  };
  const service = new FreeTrialService(
    repository as unknown as Repository<User>,
    config,
  );
  await assert.rejects(
    service.startIfNew('user-1'),
    (error: unknown) =>
      error instanceof ServiceUnavailableException &&
      error.message === 'Subscription storage is temporarily unavailable',
  );
});

test('public plans expose the configured trial length only for the free plan', async () => {
  const query: any = {
    orderBy: () => query,
    where: () => query,
    getMany: async () => [
      {
        id: 'plan-free',
        name: 'Free',
        slug: 'free',
        description: '7-day free trial with basic features',
        priceCents: '0',
        currency: 'USD',
        billingCycle: 'monthly',
        limits: {},
        isActive: true,
        sortOrder: 0,
        legacyTier: 'free',
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
      {
        id: 'plan-basic',
        name: 'Basic',
        slug: 'basic',
        description: 'Basic',
        priceCents: '999',
        currency: 'USD',
        billingCycle: 'monthly',
        limits: {},
        isActive: true,
        sortOrder: 1,
        legacyTier: 'basic',
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
  };
  const service = new SubscriptionPlansService(
    { createQueryBuilder: () => query } as never,
    {} as never,
    config,
  );
  const plans = await service.findPublic();
  assert.equal(plans.find((plan) => plan.slug === 'free')?.trialDays, 7);
  assert.equal(plans.find((plan) => plan.slug === 'basic')?.trialDays, null);
});
