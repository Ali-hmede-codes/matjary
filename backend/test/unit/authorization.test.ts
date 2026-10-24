import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Module,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
  type ExecutionContext,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { FindOperator, type DataSource, type EntityManager } from 'typeorm';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  validateEnvironment,
  type AppEnvironment,
} from '../../libs/config/src/environment';
import { AuthService } from '../../apps/api/src/modules/auth/auth.service';
import { AuthCookies } from '../../apps/api/src/modules/auth/auth.cookies';
import {
  AdminGuard,
  SessionGuard,
  OptionalSessionGuard,
  MutationGuard,
  AuthOriginGuard,
  AuthRateLimitGuard,
} from '../../apps/api/src/modules/auth/guards/auth.guards';
import { CartIdentityGuard } from '../../apps/api/src/modules/carts/cart-identity.guard';
import { SeoController } from '../../apps/api/src/modules/seo/seo.controller';
import { SeoService } from '../../apps/api/src/modules/seo/seo.service';
import {
  StoreSeoDto,
  CreateRedirectDto,
} from '../../apps/api/src/modules/seo/seo.dto';
import {
  PublicSubscriptionPlansController,
  SubscriptionPlansController,
} from '../../apps/api/src/modules/subscriptions/subscription-plans.controller';
import { SubscriptionPlansService } from '../../apps/api/src/modules/subscriptions/subscription-plans.service';
import { setupApp } from '../../apps/api/src/setup-app';
import {
  effectiveLimits,
  effectiveSubscription,
  boundedLimit,
  assertQuota,
  FREE_LIMITS,
} from '../../libs/database/src/subscription-policy';
import {
  User,
  Store,
  Product,
  Showcase,
  ProductStatus,
  ShowcaseStatus,
  UserSubscription,
  SubscriptionStatus,
} from '../../libs/database/src/entities';
import { StorageService } from '../../libs/storage/src/storage.service';
import { toStoreResponseDto } from '../../apps/api/src/modules/stores/dto/store-response.dto';
import { StoresService } from '../../apps/api/src/modules/stores/stores.service';

test('public shop badges disappear after expiration or revocation', (t) => {
  const now = new Date('2026-10-24T12:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  const store = Object.assign(new Store(), { hasVerificationBadge: true });
  for (const expires of [null, new Date(now.getTime() + 1000)]) {
    store.verificationBadgeExpiresAt = expires;
    assert.equal(toStoreResponseDto(store).hasVerificationBadge, true);
  }
  for (const expires of [now, new Date(now.getTime() - 1000)]) {
    store.verificationBadgeExpiresAt = expires;
    assert.equal(toStoreResponseDto(store).hasVerificationBadge, false);
  }
  store.hasVerificationBadge = false;
  store.verificationBadgeExpiresAt = null;
  assert.equal(toStoreResponseDto(store).hasVerificationBadge, false);
});

test('shop verification requires administrators even with an eligible subscription', async () => {
  const store = Object.assign(new Store(), {
    id: 'shop',
    ownerId: 'owner',
    hasVerificationBadge: false,
    verificationBadgeExpiresAt: null,
  });
  const limits = { maxVerificationBadges: 1, verificationBadgePriceCents: 0 };
  const subscription = {
    startsAt: new Date(0),
    expiresAt: new Date(Date.now() + 86_400_000),
    plan: { limits },
  };
  let saves = 0;
  const audits: unknown[] = [];
  const manager = {
    findOneBy: async (_target: unknown, where: { id: string }) => ({
      id: where.id,
      email: `${where.id}@example.test`,
      suspendedAt: null,
    }),
    findOneOrFail: async (
      target: unknown,
      options: { lock: { mode: string } },
    ) => {
      assert.equal(options.lock.mode, 'pessimistic_write');
      return target === Store ? store : { id: 'owner' };
    },
    getRepository: (target: unknown) => {
      const query = {
        where: (sql: string) => {
          assert.match(sql, /verificationBadgeExpiresAt > :now/);
          return query;
        },
        getCount: async () =>
          Number(toStoreResponseDto(store).hasVerificationBadge),
      };
      return {
        find: async () => (target === UserSubscription ? [subscription] : []),
        findOneBy: async () => null,
        createQueryBuilder: () => query,
      };
    },
    save: async () => {
      saves++;
      return store;
    },
    insert: async (_target: unknown, row: unknown) => {
      audits.push(row);
    },
    transaction: async (work: (value: unknown) => Promise<unknown>) =>
      work(manager),
  };
  const service = new StoresService(
    { manager, findOneBy: async () => store } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    new AdminGuard(config()),
  );
  await assert.rejects(
    service.checkBadgeEligibility('shop', 'other'),
    ForbiddenException,
  );
  await assert.rejects(
    service.grantVerificationBadge('shop', 'other'),
    ForbiddenException,
  );
  assert.equal(saves, 0);
  assert.equal(
    (await service.checkBadgeEligibility('shop', 'owner')).eligible,
    true,
  );
  await assert.rejects(
    service.grantVerificationBadge('shop', 'owner'),
    ForbiddenException,
  );
  assert.equal(saves, 0);
  await service.grantVerificationBadge('shop', 'admin');
  assert.equal(toStoreResponseDto(store).hasVerificationBadge, true);
  await service.grantVerificationBadge('shop', 'admin');
  assert.equal(saves, 1, 'active grants are idempotent');
  await assert.rejects(
    service.revokeVerificationBadge('shop', 'owner'),
    ForbiddenException,
  );
  await service.revokeVerificationBadge('shop', 'admin');
  assert.equal(toStoreResponseDto(store).hasVerificationBadge, false);
  assert.equal(store.verificationBadgeGrantedBy, null);
  assert.equal(store.verificationBadgeGrantedAt, null);
  assert.equal(store.verificationBadgeExpiresAt, null);

  limits.maxVerificationBadges = 0;
  await assert.rejects(
    service.grantVerificationBadge('shop', 'owner'),
    ForbiddenException,
  );
  await service.grantVerificationBadge('shop', 'admin');
  assert.equal(toStoreResponseDto(store).hasVerificationBadge, true);
  assert.equal(store.verificationBadgeExpiresAt, null);
  assert.equal(store.verificationBadgeGrantedBy, 'admin');
  assert.equal(audits.length, 3);
});

test('storefront contact details do not require map coordinates', () => {
  const store = Object.assign(new Store(), {
    latitude: null,
    longitude: null,
    address: null,
    city: null,
    country: null,
    postalCode: null,
    locationName: null,
    phone: '+961 1 234567',
    website: 'https://example.test',
    openingHours: { monday: '09:00–17:00' },
  });
  const location = toStoreResponseDto(store).location;
  assert.equal(location?.phone, store.phone);
  assert.equal(location?.website, store.website);
  assert.deepEqual(location?.openingHours, store.openingHours);
  assert.equal(location?.hasCoordinates, false);
  assert.equal(location?.mapUrl, null);

  Object.assign(store, { phone: null, website: null, openingHours: null });
  assert.equal(toStoreResponseDto(store).location, null);
  Object.assign(store, { latitude: 0, longitude: 0 });
  assert.equal(toStoreResponseDto(store).location?.hasCoordinates, true);
  assert.match(
    toStoreResponseDto(store).location?.mapUrl ?? '',
    /mlat=0&mlon=0/u,
  );
});

function config(origin = 'http://localhost:3000') {
  return new ConfigService<AppEnvironment, true>(
    validateEnvironment({
      MYSQL_PASSWORD: 'test',
      REDIS_PASSWORD: 'test',
      APP_ORIGIN: origin,
      ADMIN_EMAILS: ' admin@example.test ',
    }),
  );
}
const auth = {
  currentUser: async (token?: string) => {
    if (!['admin', 'owner'].includes(token ?? ''))
      throw new UnauthorizedException();
    return { id: token!, email: `${token}@example.test`, displayName: token! };
  },
  rateLimit: async () => {},
};

test('HTTP SEO wildcard registration, admin boundaries, DTOs and sitemap categories', async () => {
  const cfg = config();
  const calls: unknown[][] = [];
  const seo = {
    getRedirect: async (value: string) => {
      calls.push(['redirect', value]);
      return null;
    },
    generateSitemapXml: async (kind?: string) =>
      `<kind>${kind ?? 'all'}</kind>`,
    getAdminSettings: async (id: string) => ({ actor: id }),
    updateSettings: async (data: unknown, id: string) => ({ data, actor: id }),
    upsertStoreSeo: async (id: string, data: unknown, actor: string) => ({
      id,
      data,
      actor,
    }),
    createRedirect: async (data: unknown) => data,
    submitAdminIndexNow: async () => ({ success: true }),
  };
  const plans = {
    findPublic: async (...args: unknown[]) => {
      assert.deepEqual(args, []);
      return [{ slug: 'free', priceCents: '0' }];
    },
    assignSubscription: async (...args: unknown[]) => {
      calls.push(['assign', ...args]);
      return { assigned: true };
    },
  };
  @Module({
    controllers: [
      SeoController,
      PublicSubscriptionPlansController,
      SubscriptionPlansController,
    ],
    providers: [
      { provide: ConfigService, useValue: cfg },
      { provide: AuthService, useValue: auth },
      { provide: SeoService, useValue: seo },
      { provide: SubscriptionPlansService, useValue: plans },
      AuthCookies,
      AdminGuard,
      SessionGuard,
      MutationGuard,
      AuthOriginGuard,
      AuthRateLimitGuard,
    ],
  })
  class TestModule {}
  const app = await NestFactory.create<NestExpressApplication>(TestModule, {
    logger: false,
    bodyParser: false,
  });
  setupApp(app, false);
  try {
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api/v1`;
    const request = (
      route: string,
      method = 'GET',
      actor = '',
      body?: unknown,
      origin = 'http://localhost:3000',
    ) =>
      fetch(base + route, {
        method,
        headers: {
          Cookie: `matjary_session=${actor}`,
          Origin: origin,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    assert.equal((await request('/seo/redirect/one/two')).status, 200);
    assert.deepEqual(calls[0], ['redirect', '/one/two']);
    assert.equal((await request('/seo/redirect/')).status, 200);
    assert.deepEqual(calls[1], ['redirect', '/']);
    for (const [route, kind] of [
      ['stores', 'store'],
      ['products', 'product'],
      ['posts', 'showcase'],
    ]) {
      assert.equal(
        await (await request(`/seo/sitemap-${route}.xml`)).text(),
        `<kind>${kind}</kind>`,
      );
    }
    assert.equal((await request('/seo/settings')).status, 401);
    assert.equal((await request('/seo/settings', 'GET', 'owner')).status, 403);
    assert.equal((await request('/seo/settings', 'GET', 'admin')).status, 200);
    assert.equal(
      (await request('/seo/settings', 'PUT', 'owner', { siteName: 'hacked' }))
        .status,
      403,
    );
    assert.equal(
      (
        await request(
          '/seo/settings',
          'PUT',
          'admin',
          { siteName: 'ok' },
          'https://evil.test',
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request('/seo/stores/id', 'PUT', 'owner', {
          ownerId: 'other',
          metaTitle: 'title',
        })
      ).status,
      400,
    );
    assert.equal(
      (await request('/seo/stores/id', 'PUT', 'owner', { metaTitle: 'title' }))
        .status,
      200,
    );
    assert.equal(
      (
        await request('/seo/redirects', 'POST', 'owner', {
          fromPath: '/old',
          toPath: '/new',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request('/seo/indexnow', 'POST', 'owner', {
          urls: ['http://localhost:3000'],
        })
      ).status,
      403,
    );
    const publicPlans = await request(
      '/subscriptions/plans?includeInactive=true',
    );
    assert.equal(publicPlans.status, 200);
    assert.deepEqual(await publicPlans.json(), [
      { slug: 'free', priceCents: '0' },
    ]);
    assert.equal((await request('/admin/subscriptions/plans')).status, 401);
    assert.equal(
      (await request('/admin/subscriptions/plans', 'GET', 'owner')).status,
      403,
    );
    assert.equal(
      (await request('/subscriptions/plans', 'POST', '', {})).status,
      404,
    );
    const assignment = {
      userId: '00000000-0000-4000-8000-000000000001',
      planId: '00000000-0000-4000-8000-000000000002',
    };
    assert.equal(
      (
        await request(
          '/admin/subscriptions/plans/assign',
          'POST',
          'owner',
          assignment,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          '/admin/subscriptions/plans/assign',
          'POST',
          'admin',
          assignment,
        )
      ).status,
      201,
    );
    assert.deepEqual(calls.at(-1)?.slice(0, 4), [
      'assign',
      assignment.userId,
      assignment.planId,
      'admin',
    ]);
    assert.equal(
      (
        await request('/seo/stores/id', 'PUT', 'owner', {
          metaTitle: 'x'.repeat(17000),
        })
      ).status,
      413,
    );
  } finally {
    await app.close();
  }
});

test('public pricing uses active sorted plans, effective defaults and safe fields', async () => {
  let activeOnly = false;
  const plan = {
    id: 'internal-id',
    name: 'Basic',
    slug: 'basic',
    description: 'For shops',
    priceCents: '999',
    currency: 'USD',
    billingCycle: 'monthly',
    limits: { maxProducts: null, enableCart: false },
    isActive: true,
    sortOrder: 1,
    legacyTier: 'basic',
  };
  const query = {
    orderBy: (field: string, direction: string) => {
      assert.equal(field, 'plan.sortOrder');
      assert.equal(direction, 'ASC');
      return query;
    },
    where: (condition: string, params: unknown) => {
      assert.equal(condition, 'plan.isActive = :active');
      assert.deepEqual(params, { active: true });
      activeOnly = true;
      return query;
    },
    getMany: async () => {
      assert.equal(activeOnly, true);
      return [plan];
    },
  };
  const repository = { createQueryBuilder: () => query };
  const service = new SubscriptionPlansService(
    repository as any,
    {} as any,
    config(),
  );
  const result = await service.findPublic();
  assert.deepEqual(result, [
    {
      name: 'Basic',
      slug: 'basic',
      description: 'For shops',
      priceCents: '999',
      currency: 'USD',
      billingCycle: 'monthly',
      limits: { ...FREE_LIMITS, maxProducts: null, enableCart: false },
    },
  ]);
  query.getMany = async () => {
    throw new Error('private database details');
  };
  await assert.rejects(service.findPublic(), (error: unknown) => {
    assert.ok(error instanceof ServiceUnavailableException);
    assert.doesNotMatch(
      JSON.stringify(error.getResponse()),
      /private database details/u,
    );
    return true;
  });
});

test('SEO service independently enforces ownership, publication and field allowlists', async () => {
  const cfg = config();
  const queries: unknown[] = [];
  const repository = {
    findOneBy: async () => null,
    find: async () => [{ id: 'settings' }],
    create: (data: unknown) => data,
    save: async (data: unknown) => data,
  } as any;
  const manager = {
    findOneBy: async (target: unknown, where: any) => {
      if (target === User)
        return { id: where.id, email: `${where.id}@example.test` };
      if (target === Store)
        return where.ownerId === 'owner'
          ? { id: where.id, ownerId: 'owner' }
          : null;
      return null;
    },
    findOne: async (target: unknown, options: any) => {
      // ownerWrite locks the actor and store before the SEO row is saved.
      if (target === User) return { id: options.where.id, suspendedAt: null };
      if (target === Store)
        return { id: options.where.id, ownerId: options.where.ownerId };
      queries.push(options.where);
      return null;
    },
    find: async (target: unknown, options: any) => {
      assert.equal(target, Product);
      queries.push(options.where);
      return [];
    },
    save: async (value: unknown) => value,
  };
  const dataSource = {
    manager,
    transaction: async (work: (m: typeof manager) => Promise<unknown>) =>
      work(manager),
  };
  const seoConfig = new ConfigService({
    APP_ORIGIN: cfg.get('APP_ORIGIN', { infer: true }),
  });
  const service = new SeoService(
    repository,
    repository,
    repository,
    repository,
    repository,
    seoConfig,
    dataSource as unknown as DataSource,
    new AdminGuard(cfg),
    {} as StorageService,
  );
  await assert.rejects(
    service.upsertStoreSeo('store', {}, 'other'),
    /Store not found/,
  );
  await assert.rejects(service.updateSettings({}, 'owner'), ForbiddenException);
  await assert.rejects(
    service.upsertStoreSeo('store', { ownerId: 'other' } as any, 'owner'),
    /Invalid SEO fields/,
  );
  await assert.rejects(
    service.upsertStoreSeo(
      'store',
      { canonicalUrl: 'https://evil.test' },
      'owner',
    ),
    /application origin/,
  );
  const savedSeo = await service.upsertStoreSeo(
    'store',
    { metaTitle: 'Owned title' },
    'owner',
  );
  // DTO instances include unset optional fields; compare all defined values.
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(savedSeo).filter(([, value]) => value !== undefined),
    ),
    { storeId: 'store', metaTitle: 'Owned title' },
  );
  await assert.rejects(
    service.getMetaBySlug('product', 'draft'),
    /Product not found/,
  );
  await assert.rejects(
    service.getMetaBySlug('showcase', 'draft'),
    /Post not found/,
  );
  for (const query of queries) {
    const where = query as { adminArchivedAt: FindOperator<unknown> };
    assert.ok(where.adminArchivedAt instanceof FindOperator);
    assert.match(
      where.adminArchivedAt.getSql!('item.adminArchivedAt'),
      /suspended_at IS NULL/,
    );
  }
  assert.deepEqual(
    queries.map((query) => {
      const { adminArchivedAt: _moderation, ...where } = query as Record<
        string,
        unknown
      >;
      return where;
    }),
    [
      { slug: 'draft', status: ProductStatus.ACTIVE },
      { slug: 'draft', status: ShowcaseStatus.PUBLISHED },
    ],
  );
  assert.equal((await service.getAdminSettings('admin')).id, 'settings');
});

test('SEO DTOs reject arbitrary JSON, IDs, unsafe redirects and overlong indexed paths', async () => {
  for (const data of [
    { structuredData: { arbitrary: true } },
    { id: 'forged' },
    { metaTitle: 'x'.repeat(121) },
  ]) {
    assert.ok(
      (
        await validate(plainToInstance(StoreSeoDto, data), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length,
    );
  }
  for (const fromPath of ['//evil.test', '/a\\b', '/' + 'a'.repeat(700)]) {
    assert.ok(
      (
        await validate(
          plainToInstance(CreateRedirectDto, { fromPath, toPath: '/safe' }),
        )
      ).length,
    );
  }
});

test('cart identities use opaque HTTP/HTTPS cookies, ignore query credentials and never merge', async () => {
  for (const secure of [false, true]) {
    const cfg = config(secure ? 'https://example.test' : undefined);
    const sessions = new OptionalSessionGuard(
      auth as unknown as AuthService,
      new AuthCookies(cfg),
    );
    const guard = new CartIdentityGuard(sessions, cfg);
    const cookies: string[] = [];
    const request: any = { headers: {}, query: { visitorId: 'victim' } };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({
          append: (_name: string, value: string) => cookies.push(value),
        }),
      }),
    } as ExecutionContext;
    await guard.canActivate(context);
    assert.match(
      cookies[0]!,
      secure
        ? /^__Host-matjary_cart=[a-f0-9]{64}/
        : /^matjary_cart=[a-f0-9]{64}/,
    );
    assert.match(cookies[0]!, /HttpOnly/);
    if (secure) assert.match(cookies[0]!, /Secure/);
    assert.notEqual(request.cartVisitorId, 'victim');
    const identity = request.cartVisitorId;
    request.headers.cookie = cookies[0]!.split(';')[0];
    await guard.canActivate(context);
    assert.equal(request.cartVisitorId, identity);
    const signedIn: any = {
      headers: { cookie: `${secure ? '__Host-' : ''}matjary_session=owner` },
    };
    const signedContext = {
      switchToHttp: () => ({ getRequest: () => signedIn }),
    } as ExecutionContext;
    await guard.canActivate(signedContext);
    assert.equal(signedIn.user.id, 'owner');
    assert.equal(signedIn.cartVisitorId, undefined);
  }
});

test('optional sessions propagate outages instead of becoming anonymous', async () => {
  const cfg = config();
  const guard = new OptionalSessionGuard(
    {
      currentUser: async () => {
        throw new ServiceUnavailableException();
      },
    } as unknown as AuthService,
    new AuthCookies(cfg),
  );
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { cookie: 'matjary_session=owner' } }),
    }),
  } as ExecutionContext;
  await assert.rejects(guard.canActivate(context), ServiceUnavailableException);
});

test('effective subscriptions honor dates, free fallback, null limits and hard media bounds', async () => {
  const now = new Date('2026-06-15T00:00:00Z');
  let rows: any[] = [
    {
      startsAt: new Date('2027-01-01'),
      expiresAt: null,
      plan: { limits: { maxProducts: 100 } },
    },
    {
      startsAt: new Date(0),
      expiresAt: new Date('2026-01-01'),
      plan: { limits: { maxProducts: 200 } },
    },
  ];
  const manager = {
    getRepository: (target: unknown) =>
      target === UserSubscription
        ? {
            find: async (options: any) => {
              assert.equal(options.where.status, SubscriptionStatus.ACTIVE);
              return rows;
            },
          }
        : { findOneBy: async () => null },
  } as unknown as EntityManager;
  assert.equal(await effectiveSubscription(manager, 'owner', now), null);
  rows = [];
  assert.deepEqual(await effectiveLimits(manager, 'owner'), FREE_LIMITS);
  rows = [
    {
      startsAt: new Date(0),
      expiresAt: null,
      plan: { limits: { maxProducts: null, maxImageCount: 0 } },
    },
  ];
  const limits = await effectiveLimits(manager, 'owner');
  assert.equal(limits.maxProducts, null);
  assert.equal(limits.maxImageCount, 0);
  assert.equal(boundedLimit(90, null), 90);
  assert.equal(boundedLimit(90, 200), 90);
  assert.throws(() => assertQuota(0, 0, 'Image'));
});
