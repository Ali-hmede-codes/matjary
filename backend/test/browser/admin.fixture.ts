import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { APP_FILTER } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { validateEnvironment } from '../../libs/config/src/environment';
import { setupApp } from '../../apps/api/src/setup-app';
import { AdminPageController } from '../../apps/api/src/modules/admin/admin-page.controller';
import { AdminCatalogController } from '../../apps/api/src/modules/admin/admin-catalog.controller';
import { AdminCatalogService } from '../../apps/api/src/modules/admin/admin-catalog.service';
import { AdminQueriesService } from '../../apps/api/src/modules/admin/admin-queries.service';
import { AuthService } from '../../apps/api/src/modules/auth/auth.service';
import { AuthCookies } from '../../apps/api/src/modules/auth/auth.cookies';
import {
  SessionGuard,
  AdminGuard,
  MutationGuard,
  AuthOriginGuard,
  AuthRateLimitGuard,
} from '../../apps/api/src/modules/auth/guards/auth.guards';
import { MediaService } from '../../apps/api/src/modules/showcases/media.service';
import { UpdateBoostSettingsDto } from '../../apps/api/src/modules/boost/dto/boost-coin.dto';
import { SeoSettingsDto } from '../../apps/api/src/modules/seo/seo.dto';
import { UpdateWebsiteSettingsDto } from '../../apps/api/src/modules/admin/website-settings.dto';
import { WebsiteSettings } from '../../libs/database/src/website-settings.entity';
import {
  MonitoringController,
  MetricsController,
} from '../../apps/api/src/modules/monitoring/monitoring.controller';
import { MonitoringService } from '../../apps/api/src/modules/monitoring/monitoring.service';
import { PrometheusService } from '../../apps/api/src/modules/monitoring/prometheus.service';
import { MonitoringExceptionFilter } from '../../apps/api/src/modules/monitoring/monitoring.filter';

// Explicit test entry point only: no AppModule, Google, database, Redis, disk
// media, or production providers. This server cannot access application data.
if (process.env.NODE_ENV !== 'test')
  throw new Error('Use the isolated unit-test preload');
const origin = 'http://127.0.0.1:3105';
const ownerId = '22222222-2222-4222-8222-222222222222';
const storeId = '33333333-3333-4333-8333-333333333333';
const adminId = '11111111-1111-4111-8111-111111111111';
const now = new Date().toISOString();
type Row = Record<string, any>;
const rows: Record<string, Row[]> = {
  users: [
    {
      id: ownerId,
      email: 'owner@example.test',
      displayName: 'Sample Owner',
      suspendedAt: null,
      createdAt: now,
    },
  ],
  stores: [
    {
      id: storeId,
      ownerId,
      name: 'Cedar Studio',
      slug: 'cedar-studio',
      description: 'Independent design and everyday essentials.',
      storeType: 'ecommerce',
      brandColor: '#254e40',
      adminArchivedAt: null,
      hasVerificationBadge: false,
      enableCart: true,
      enableWhatsAppCheckout: false,
      createdAt: now,
    },
  ],
  products: [
    {
      id: randomUUID(),
      storeId,
      slug: 'ceramic-cup',
      name: 'Ceramic cup',
      priceCents: '2400',
      currency: 'USD',
      status: 'active',
      adminArchivedAt: null,
      createdAt: now,
    },
  ],
  posts: [
    {
      id: randomUUID(),
      ownerId,
      storeId,
      slug: 'studio-story',
      title: 'Inside the studio',
      status: 'published',
      mediaCount: 0,
      adminArchivedAt: null,
      createdAt: now,
    },
  ],
  media: [],
  plans: [
    {
      id: randomUUID(),
      name: 'Free',
      slug: 'free',
      priceCents: '0',
      currency: 'USD',
      billingCycle: 'monthly',
      isActive: true,
      limits: {},
      createdAt: now,
    },
  ],
  subscriptions: [],
  campaigns: [],
  wallets: [{ userId: ownerId, balance: '1200', updatedAt: now }],
  transactions: [],
  carts: [],
  redirects: [],
  errors: [
    {
      id: randomUUID(),
      service: 'worker',
      operation: 'MediaProcessor',
      code: 'BACKGROUND_FAILURE',
      occurrences: '3',
      state: 'open',
      lastSeenAt: now,
    },
  ],
  audit: [],
  'boost-settings': [
    {
      id: 'global',
      coinPriceCents: 1,
      minPurchaseCoins: 100,
      maxPurchaseCoins: 100000,
      defaultDailyBudgetCoins: 1000,
      minCampaignBudgetCoins: 100,
      maxCampaignDurationDays: 90,
      campaignReviewRequired: true,
      autoApproveThresholdCoins: 1000,
      cpcMinBidCoins: 1,
      cpmMinBidCoins: 10,
      platformFeePercent: 0,
    },
  ],
  'seo-settings': [
    {
      id: 'global',
      siteName: 'Matjary preview',
      defaultTitle: 'Discover independent stores',
      defaultDescription:
        'Isolated preview settings — no live site is changed.',
      sitemapEnabled: true,
      sitemapChangefreq: 'weekly',
      sitemapPriority: 0.5,
      aiCrawlersAllowed: true,
      aiTrainingAllowed: false,
      llmsTxtEnabled: false,
      indexNowEnabled: false,
      indexNowKey: null,
      speakableEnabled: false,
      faqEnabled: false,
      howtoEnabled: false,
      freshnessThresholdDays: 30,
      organizationSameAs: [],
      aiCrawlerUserAgents: [],
      speakableCssSelectors: [],
    },
  ],
};
let sessionValid = true;
let collector = 'unavailable';
const user = {
  id: adminId,
  email: 'admin@example.test',
  displayName: 'Demo Administrator',
};
const auth = {
  currentUser: async (token?: string) => {
    if (
      !sessionValid ||
      !['fixture-admin', 'fixture-owner'].includes(token ?? '')
    )
      throw new UnauthorizedException();
    return token === 'fixture-admin'
      ? user
      : { ...user, id: ownerId, email: 'owner@example.test' };
  },
  isAdmin: (value: { email: string }) => value.email === user.email,
  rateLimit: async () => {},
};
const find = (resource: string, id: string): Row => {
  const row = rows[resource]?.find((item) => (item.id ?? item.userId) === id);
  if (!row) throw new NotFoundException();
  return row;
};
const audit = (resource: string, id: string, action: string, reason?: string) =>
  rows.audit!.unshift({
    id: randomUUID(),
    actorId: adminId,
    resource,
    resourceId: id,
    action,
    reason,
    createdAt: new Date().toISOString(),
  });
const update = (resource: string, id: string, data: Row) => {
  Object.assign(
    find(resource, id),
    Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    ),
  );
  audit(resource, id, 'update');
  return { id };
};
const create = (resource: string, data: Row) => {
  const row = {
    ...data,
    id: randomUUID(),
    adminArchivedAt: null,
    createdAt: now,
  };
  rows[resource]!.push(row);
  audit(resource, row.id, 'create');
  return { id: row.id };
};
const catalog = {
  updateUser: (id: string, data: Row) => update('users', id, data),
  accountAction: (id: string, action: string, reason: string) => {
    audit('users', id, action, reason);
    if (action !== 'revoke-sessions')
      find('users', id).suspendedAt =
        action === 'suspend' ? new Date().toISOString() : null;
    return { id };
  },
  createStore: (data: Row) => create('stores', data),
  updateStore: (id: string, data: Row) => update('stores', id, data),
  createProduct: (data: Row) => create('products', data),
  updateProduct: (id: string, data: Row) => update('products', id, data),
  createPost: (data: Row) => create('posts', data),
  updatePost: (id: string, data: Row) => update('posts', id, data),
  archive: (
    resource: string,
    id: string,
    archived: boolean,
    reason: string,
  ) => {
    find(resource, id).adminArchivedAt = archived
      ? new Date().toISOString()
      : null;
    audit(resource, id, archived ? 'archive' : 'restore', reason);
    return { id };
  },
  badge: (id: string, enabled: boolean, reason: string) => {
    find('stores', id).hasVerificationBadge = enabled;
    audit('stores', id, 'badge', reason);
    return { id };
  },
  errorState: (id: string, data: Row) => update('errors', id, data),
};
const queries = {
  overview: async () =>
    Object.fromEntries(
      ['users', 'stores', 'products', 'posts', 'media', 'errors'].map((key) => [
        key,
        rows[key]!.length,
      ]),
    ),
  detail: async (resource: string, id: string) => find(resource, id),
  list: async (resource: string, options: Row) => {
    if (!Object.hasOwn(rows, resource)) throw new NotFoundException();
    const items = rows[resource]!.filter(
      (item) =>
        (!options.search ||
          JSON.stringify(item)
            .toLowerCase()
            .includes(String(options.search).toLowerCase())) &&
        (!options.status || (item.status ?? item.state) === options.status) &&
        (!options.ownerId ||
          [item.ownerId, item.userId, item.actorId].includes(
            options.ownerId,
          )) &&
        (!options.parentId ||
          [item.storeId, item.showcaseId, item.planId].includes(
            options.parentId,
          )) &&
        (options.archive === 'all' ||
          options.archive === undefined ||
          (options.archive === 'archived') ===
            Boolean(item.adminArchivedAt ?? item.suspendedAt)),
    );
    return {
      items: items.slice(options.offset, options.offset + options.limit),
      total: items.length,
      limit: options.limit,
      offset: options.offset,
    };
  },
};
@Controller()
class FixtureController {
  @Get('fixture/:mode')
  fixture(@Param('mode') mode: string, @Res() response: Response) {
    if (mode === 'expire') {
      sessionValid = false;
      return response
        .type('text')
        .send('Fixture sessions expired. Return to the dashboard and refresh.');
    }
    if (['up', 'unavailable'].includes(mode)) {
      collector = mode;
      return response
        .type('text')
        .send('Fixture collector changed. Return to monitoring and refresh.');
    }
    sessionValid = true;
    response.cookie(
      'matjary_session',
      mode === 'owner' ? 'fixture-owner' : 'fixture-admin',
      { httpOnly: true, sameSite: 'lax', path: '/' },
    );
    return response.redirect('/api/v1/admin');
  }
  @Get('auth/me')
  async me(@Req() request: Request) {
    const current = await auth.currentUser(
      request.headers.cookie?.includes('fixture-admin')
        ? 'fixture-admin'
        : 'fixture-owner',
    );
    return { user: current, isAdmin: auth.isAdmin(current) };
  }
  @Post('auth/logout')
  logout(@Res() response: Response) {
    response.clearCookie('matjary_session', { path: '/' });
    return response.json({ success: true });
  }
  @Get('auth/login')
  login(@Res() response: Response) {
    return response
      .type('html')
      .send(
        '<h1>Isolated fixture: signed out</h1><p>No Google login or application data is used by this test server.</p><a href="/api/v1/fixture/admin">Enter admin fixture</a>',
      );
  }
}
// Keep settings in memory while using the application's guards and DTOs.
@Controller('admin')
@UseGuards(SessionGuard, AdminGuard, MutationGuard)
class FixtureSettingsController {
  private readonly website = new WebsiteSettings();

  @Get('website-settings')
  websiteSettings() {
    return this.website;
  }

  @Patch('website-settings')
  updateWebsiteSettings(@Body() dto: UpdateWebsiteSettingsDto) {
    Object.assign(
      this.website,
      Object.fromEntries(
        Object.entries(dto).filter(([, value]) => value !== undefined),
      ),
    );
    return this.website;
  }

  @Get('boost/settings')
  boostSettings() {
    return find('boost-settings', 'global');
  }

  @Patch('boost/settings')
  updateBoostSettings(@Body() dto: UpdateBoostSettingsDto) {
    update('boost-settings', 'global', dto);
    return { success: true };
  }

  @Get('seo/settings')
  seoSettings() {
    return { ...find('seo-settings', 'global'), indexNowKey: null };
  }

  @Put('seo/settings')
  updateSeoSettings(@Body() dto: SeoSettingsDto) {
    update('seo-settings', 'global', dto);
    return this.seoSettings();
  }
}

@Module({
  controllers: [
    FixtureController,
    FixtureSettingsController,
    AdminPageController,
    AdminCatalogController,
    MonitoringController,
    MetricsController,
  ],
  providers: [
    {
      provide: ConfigService,
      useValue: new ConfigService(
        validateEnvironment({
          MYSQL_PASSWORD: 'test',
          REDIS_PASSWORD: 'test',
          APP_ORIGIN: origin,
          ADMIN_EMAILS: user.email,
        }),
      ),
    },
    { provide: AuthService, useValue: auth },
    { provide: AdminCatalogService, useValue: catalog },
    { provide: AdminQueriesService, useValue: queries },
    { provide: MediaService, useValue: {} },
    {
      provide: MonitoringService,
      useValue: {
        health: async () => ({
          timestamp: Date.now(),
          checks: { mysql: 'up', redis: 'up', worker: 'down' },
          api: { rssBytes: 48000000 },
          worker: null,
          media: { failed: 3, outboxAgeSeconds: 12, cleanupCandidates: 0 },
          queues: { media: { waiting: 2 } },
        }),
        assertScrape: () => {
          throw new NotFoundException();
        },
      },
    },
    {
      provide: PrometheusService,
      useValue: {
        vps: async (window: string) => ({
          status: collector,
          window,
          scope: 'Synthetic fixture data — not real VPS readings',
          metrics:
            collector === 'up'
              ? [
                  {
                    key: 'cpu',
                    label: 'Synthetic host CPU',
                    unit: '%',
                    current: 34,
                    points: Array.from({ length: 24 }, (_, i) => [
                      Math.floor(Date.now() / 1000) - (23 - i) * 15,
                      25 + (i % 10),
                    ]),
                  },
                ]
              : [],
        }),
        alerts: async () => ({
          status: collector,
          items:
            collector === 'up'
              ? [{ name: 'WorkerUnavailable', state: 'firing' }]
              : [],
        }),
      },
    },
    { provide: APP_FILTER, useClass: MonitoringExceptionFilter },
    AuthCookies,
    SessionGuard,
    AdminGuard,
    MutationGuard,
    AuthOriginGuard,
    AuthRateLimitGuard,
  ],
})
class FixtureModule {}

async function main() {
  const app = await NestFactory.create<NestExpressApplication>(FixtureModule, {
    logger: false,
    bodyParser: false,
  });
  setupApp(app, false);
  await app.listen(3105, '127.0.0.1');
  console.log('Isolated admin fixture: ' + origin + '/api/v1/fixture/admin');
  console.log(
    'Only in-memory test data is used. This is not real Google authentication.',
  );
  // Keep the interactive preview available until explicitly stopped.
  app.enableShutdownHooks();
}
void main().catch(() => {
  console.error('Fixture startup failed');
  process.exitCode = 1;
});
