import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Module,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource, type EntityManager, type QueryRunner } from 'typeorm';
import type { AppEnvironment } from '@app/config';
import {
  AdminAuditLog,
  User,
  WebsiteSettings,
  WEBSITE_SETTINGS_FIELDS,
  createDatabaseOptions,
  type AdminActor,
} from '@app/database';
import { validateDatabaseEnvironment } from '../../libs/config/src/environment';
import { WebsiteSettings1793659200000 } from '../../libs/database/src/migrations/1793659200000-WebsiteSettings';
import { LbpPriceDisplay1794868800000 } from '../../libs/database/src/migrations/1794868800000-LbpPriceDisplay';
import { AdminAccessService } from '../../apps/api/src/modules/admin/admin-access.service';
import { WebsiteSettingsService } from '../../apps/api/src/modules/admin/website-settings.service';
import { SeoSettings } from '../../libs/database/src/seo.entities';
import { UpdateWebsiteSettingsDto } from '../../apps/api/src/modules/admin/website-settings.dto';
import {
  AdminWebsiteSettingsController,
  PublicWebsiteSettingsController,
} from '../../apps/api/src/modules/admin/website-settings.controller';
import { AuthService } from '../../apps/api/src/modules/auth/auth.service';
import { AuthCookies } from '../../apps/api/src/modules/auth/auth.cookies';
import {
  AdminGuard,
  AuthOriginGuard,
  AuthRateLimitGuard,
  MutationGuard,
  SessionGuard,
} from '../../apps/api/src/modules/auth/guards/auth.guards';
import { MonitoringExceptionFilter } from '../../apps/api/src/modules/monitoring/monitoring.filter';
import { setupApp } from '../../apps/api/src/setup-app';

const actor: AdminActor = {
  id: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
};
const config = new ConfigService({
  APP_ORIGIN: 'http://localhost:3000',
  ADMIN_EMAILS: ' ADMIN@example.test ',
}) as ConfigService<AppEnvironment, true>;

function fixture() {
  const state = {
    row: new WebsiteSettings() as WebsiteSettings | null,
    seo: null as SeoSettings | null,
    audits: [] as Record<string, unknown>[],
    failure: '',
    user: {
      id: actor.id,
      email: 'admin@example.test',
      suspendedAt: null as Date | null,
    },
    saves: 0,
  };
  const fail = (step: string) => {
    if (state.failure === step) throw new Error('secret-driver-password');
  };
  const manager = (data: typeof state) => ({
    findOneBy: async (target: unknown, where: { id: string | number }) => {
      if (target === User) {
        fail('auth');
        return where.id === state.user.id ? state.user : null;
      }
      assert.equal(target, WebsiteSettings);
      assert.equal(where.id, 1);
      fail('read');
      return data.row;
    },
    update: async (
      target: unknown,
      _where: unknown,
      patch: Partial<SeoSettings>,
    ) => {
      assert.equal(target, SeoSettings);
      if (data.seo) Object.assign(data.seo, patch);
    },
    findOne: async (target: unknown, options: unknown) => {
      if (target === SeoSettings) return data.seo;
      assert.equal(target, WebsiteSettings);
      assert.deepEqual(options, {
        where: { id: 1 },
        lock: { mode: 'pessimistic_write' },
      });
      fail('read');
      return data.row;
    },
    save: async (target: unknown, row: WebsiteSettings) => {
      assert.equal(target, WebsiteSettings);
      fail('save');
      data.row = row;
      data.saves++;
      return row;
    },
    insert: async (target: unknown, row: Record<string, unknown>) => {
      assert.equal(target, AdminAuditLog);
      fail('audit');
      data.audits.push(row);
    },
  });
  let tail = Promise.resolve();
  const database = {
    manager: manager(state),
    transaction: async (
      action: (manager: EntityManager) => Promise<unknown>,
    ) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        fail('transaction');
        const draft = structuredClone(state);
        const result = await action(manager(draft) as unknown as EntityManager);
        state.row = draft.row;
        state.seo = draft.seo;
        state.audits = draft.audits;
        state.saves = draft.saves;
        return result;
      } finally {
        release();
      }
    },
  } as unknown as DataSource;
  const service = new WebsiteSettingsService(
    new AdminAccessService(database, config),
  );
  return { state, service };
}

test('branding edits release legacy inherited SEO copies but preserve custom overrides atomically', async () => {
  const { service, state } = fixture();
  Object.assign(state.row!, {
    siteName: 'Old brand',
    tagline: 'Old tagline',
    description: 'Old copy',
    logoUrl: '/old.png',
    bannerUrl: '/old.jpg',
  });
  state.seo = Object.assign(new SeoSettings(), {
    id: 'seo',
    defaultTitle: 'Old brand — Old tagline',
    defaultDescription: 'Old copy',
    defaultOgImageUrl: '/old.jpg',
    organizationName: 'Old brand',
    organizationLogoUrl: '/old.png',
  });
  const changes = {
    siteName: 'New brand',
    tagline: 'New tagline',
    description: 'New copy',
    logoUrl: '/new.png',
    bannerUrl: '/new.jpg',
  };
  state.failure = 'audit';
  await assert.rejects(service.update(changes, actor));
  assert.equal(state.row!.siteName, 'Old brand');
  assert.equal(state.seo.defaultTitle, 'Old brand — Old tagline');
  state.failure = '';
  await service.update(changes, actor);
  for (const key of [
    'defaultTitle',
    'defaultDescription',
    'defaultOgImageUrl',
    'organizationName',
    'organizationLogoUrl',
  ] as const)
    assert.equal(state.seo[key], null);
  state.seo.defaultTitle = 'Independent SEO title';
  state.seo.defaultDescription = 'Independent SEO description';
  state.seo.defaultOgImageUrl = '/custom.jpg';
  await service.update(
    {
      siteName: 'Next brand',
      description: 'Next copy',
      bannerUrl: '/next.jpg',
    },
    actor,
  );
  assert.equal(state.seo.defaultTitle, 'Independent SEO title');
  assert.equal(state.seo.defaultDescription, 'Independent SEO description');
  assert.equal(state.seo.defaultOgImageUrl, '/custom.jpg');
});

const validate = (input: object) =>
  validateSync(plainToInstance(UpdateWebsiteSettingsDto, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
const colors = [
  'primaryColor',
  'secondaryColor',
  'backgroundColor',
  'textColor',
] as const;
const images = ['logoUrl', 'faviconUrl', 'bannerUrl'] as const;
const nullable = [
  'tagline',
  'description',
  ...images,
  'contactEmail',
  'footerText',
] as const;

for (const field of colors) {
  test(`${field}: accepts and normalizes six-digit hex colors`, () => {
    for (const value of ['#ffffff', '#000000', ' #AbC123 ']) {
      assert.equal(validate({ [field]: value }).length, 0);
      assert.equal(
        plainToInstance(UpdateWebsiteSettingsDto, { [field]: value })[field],
        value.trim().toLowerCase(),
      );
    }
  });
  test(`${field}: rejects null, malformed values, and CSS injection`, () => {
    for (const value of [
      null,
      '',
      '#fff',
      'red',
      '#12345678',
      '#gggggg',
      'url(https://evil.test)',
      '#000000;display:none',
      123,
      {},
      [],
    ]) {
      assert.ok(validate({ [field]: value }).length, JSON.stringify(value));
    }
  });
}
for (const field of images) {
  test(`${field}: accepts public HTTPS URLs and local image paths`, () => {
    for (const value of [
      'https://cdn.example.test/logo.webp',
      '/api/v1/uploads/variants%2Flogo.webp',
      '/assets/logo.png?v=2',
      'https://cdn.example.test/logo.png?v=2',
    ]) {
      assert.equal(validate({ [field]: value }).length, 0, value);
    }
  });
  test(`${field}: rejects unsafe protocols, credentials, malformed URLs and long inputs`, () => {
    for (const value of [
      'javascript:alert(1)',
      'data:image/svg+xml;base64,xxx',
      'http://cdn.test/a.png',
      '//evil.test/a.png',
      '/\\evil.test/a.png',
      'https://user:password@cdn.test/a.png',
      'https://',
      'https://[invalid',
      '/a.png#fragment',
      'https://cdn.test/a b.png',
      'assets/logo.png',
      'https://cdn.test/' + 'a'.repeat(2048),
      '<img src=x>',
      false,
      {},
    ]) {
      assert.ok(validate({ [field]: value }).length, JSON.stringify(value));
    }
  });
}
for (const [field, max] of [
  ['siteName', 100],
  ['tagline', 200],
  ['description', 1000],
  ['footerText', 500],
] as const) {
  test(`${field}: enforces exact text bounds, rejects markup and preserves Unicode`, () => {
    assert.equal(validate({ [field]: 'a'.repeat(max) }).length, 0);
    assert.ok(validate({ [field]: 'a'.repeat(max + 1) }).length);
    assert.equal(validate({ [field]: 'متجري · Café' }).length, 0);
    for (const value of [
      '<script>alert(1)</script>',
      'bad\u0000text',
      17,
      {},
      [],
    ]) {
      assert.ok(validate({ [field]: value }).length);
    }
  });
}
for (const field of nullable) {
  test(`${field}: null clears optional content and blank text normalizes to null`, () => {
    assert.equal(validate({ [field]: null }).length, 0);
    assert.equal(validate({ [field]: '   ' }).length, 0);
    assert.equal(
      plainToInstance(UpdateWebsiteSettingsDto, { [field]: '   ' })[field],
      null,
    );
  });
}
test('name is non-null and nonblank; contact email must be valid', () => {
  for (const value of [null, '', '   '])
    assert.ok(validate({ siteName: value }).length);
  assert.equal(validate({ contactEmail: ' hello@example.test ' }).length, 0);
  for (const value of ['not-email', 'a@', 'a'.repeat(255), 2])
    assert.ok(validate({ contactEmail: value }).length);
});
test('empty patches are valid but unknown/internal fields are rejected', () => {
  assert.equal(validate({}).length, 0);
  for (const field of [
    'id',
    'updatedAt',
    'updatedBy',
    'isAdmin',
    'customCss',
    'scripts',
    'ADMIN_EMAILS',
  ]) {
    assert.ok(validate({ [field]: 'injected' }).length);
  }
});
test('the LBP rate accepts whole pounds in range and rejects everything else', () => {
  for (const value of [0, 1507, 89_500, 10_000_000]) {
    assert.equal(validate({ lbpExchangeRate: value }).length, 0, String(value));
  }
  for (const value of [-1, 1.5, 10_000_001, '89500', '', null, true, {}]) {
    assert.ok(
      validate({ lbpExchangeRate: value }).length,
      JSON.stringify(value),
    );
  }
});

test('public defaults expose exactly the branding allowlist without writes', async () => {
  const f = fixture();
  Object.assign(f.state.row!, { password: 'secret', updatedAt: new Date() });
  const result = await f.service.get();
  assert.deepEqual(Object.keys(result), [...WEBSITE_SETTINGS_FIELDS]);
  assert.equal(result.siteName, 'Matjary');
  assert.equal(result.primaryColor, '#254e40');
  for (const field of nullable) assert.equal(result[field], null);
  assert.equal(f.state.saves, 0);
  assert.equal(f.state.audits.length, 0);
});
test('partial updates normalize input, preserve other fields, and audit only changed names', async () => {
  const f = fixture();
  const result = await f.service.update(
    { siteName: ' Café ', primaryColor: '#AABBCC' },
    actor,
  );
  assert.equal(result.siteName, 'Café');
  assert.equal(result.primaryColor, '#aabbcc');
  assert.equal(result.secondaryColor, '#d9a441');
  assert.deepEqual(await f.service.get(), result);
  assert.equal(f.state.saves, 1);
  const audit = f.state.audits[0];
  assert.equal(audit?.actorId, actor.id);
  assert.equal(audit?.requestId, actor.requestId);
  assert.equal(audit?.resource, 'website-settings');
  assert.equal(audit?.resourceId, '1');
  assert.deepEqual(audit?.changedFields, ['siteName', 'primaryColor']);
  assert.doesNotMatch(JSON.stringify(audit), /Café|aabbcc/);
});
test('every setting can be saved and optional settings can be cleared', async () => {
  const f = fixture();
  const values = {
    siteName: 'New website',
    tagline: 'Welcome',
    description: 'Our website',
    primaryColor: '#111111',
    secondaryColor: '#222222',
    backgroundColor: '#333333',
    textColor: '#444444',
    logoUrl: '/logo.webp',
    faviconUrl: '/favicon.png',
    bannerUrl: 'https://cdn.test/banner.jpg',
    contactEmail: 'contact@example.test',
    footerText: '© Café',
    lbpExchangeRate: 89_500,
  };
  assert.deepEqual(await f.service.update(values, actor), values);
  const cleared = await f.service.update(
    Object.fromEntries(nullable.map((key) => [key, null])),
    actor,
  );
  for (const key of nullable) assert.equal(cleared[key], null);
  assert.equal(cleared.siteName, values.siteName);
});
test('empty and identical patches do not write or add misleading audit entries', async () => {
  const f = fixture();
  const before = await f.service.get();
  assert.deepEqual(await f.service.update({}, actor), before);
  assert.deepEqual(
    await f.service.update(
      { siteName: 'Matjary', primaryColor: ' #254E40 ' },
      actor,
    ),
    before,
  );
  assert.equal(f.state.saves, 0);
  assert.equal(f.state.audits.length, 0);
});
test('simultaneous partial updates keep unrelated fields using a row lock', async () => {
  const f = fixture();
  await Promise.all([
    f.service.update({ siteName: 'Concurrent' }, actor),
    f.service.update({ primaryColor: '#abcdef' }, actor),
  ]);
  const result = await f.service.get();
  assert.equal(result.siteName, 'Concurrent');
  assert.equal(result.primaryColor, '#abcdef');
  assert.equal(f.state.audits.length, 2);
});
for (const privilege of ['missing', 'revoked', 'suspended'] as const) {
  test(`service rechecks ${privilege} administrator privilege for reads and writes`, async () => {
    const f = fixture();
    if (privilege === 'missing') f.state.user.id = 'different';
    if (privilege === 'revoked') f.state.user.email = 'owner@example.test';
    if (privilege === 'suspended') f.state.user.suspendedAt = new Date();
    await assert.rejects(f.service.getAdmin(actor), ForbiddenException);
    await assert.rejects(
      f.service.update({ siteName: 'Changed' }, actor),
      ForbiddenException,
    );
    assert.equal(f.state.saves, 0);
    assert.equal((await f.service.get()).siteName, 'Matjary');
  });
}
test('direct service calls cannot bypass validation or modify internal fields', async () => {
  const f = fixture();
  for (const input of [
    null,
    [],
    'text',
    { id: 2 },
    { siteName: null },
    { logoUrl: 'javascript:evil()' },
    { textColor: 'red' },
  ]) {
    await assert.rejects(
      f.service.update(input as UpdateWebsiteSettingsDto, actor),
      BadRequestException,
    );
  }
  assert.equal(f.state.saves, 0);
});
for (const step of ['auth', 'read', 'save', 'audit', 'transaction']) {
  test(`${step} failures are sanitized and leave settings/audit unchanged`, async () => {
    const f = fixture();
    f.state.failure = step;
    await assert.rejects(
      f.service.update({ siteName: 'Must roll back' }, actor),
      (error: Error) => {
        assert.ok(error instanceof ServiceUnavailableException);
        assert.doesNotMatch(error.message, /secret-driver-password/);
        return true;
      },
    );
    assert.equal(f.state.row?.siteName, 'Matjary');
    assert.equal(f.state.audits.length, 0);
    assert.equal(f.state.saves, 0);
  });
}
test('public storage failures and missing seed fail closed without driver leakage', async () => {
  const f = fixture();
  f.state.failure = 'read';
  await assert.rejects(f.service.get(), ServiceUnavailableException);
  f.state.failure = '';
  f.state.row = null;
  await assert.rejects(f.service.get(), ServiceUnavailableException);
  await assert.rejects(
    f.service.update({ siteName: 'Changed' }, actor),
    ServiceUnavailableException,
  );
});

test('migration registration, singleton seed, reversibility, defaults and metadata match', async () => {
  class MetadataSource extends DataSource {
    inspect() {
      return this.buildMetadatas();
    }
  }
  const source = new MetadataSource(
    createDatabaseOptions(
      validateDatabaseEnvironment({ MYSQL_PASSWORD: 'test' }),
    ),
  );
  await source.inspect();
  assert.ok(
    source.migrations.some(
      (migration) => migration instanceof WebsiteSettings1793659200000,
    ),
  );
  const metadata = source.getMetadata(WebsiteSettings);
  assert.equal(metadata.tableName, 'website_settings');
  assert.deepEqual(
    metadata.primaryColumns.map((column) => column.propertyName),
    ['id'],
  );
  const queries: string[] = [];
  const runner = {
    query: async (sql: string) => {
      queries.push(sql);
    },
  } as unknown as QueryRunner;
  const migration = new WebsiteSettings1793659200000();
  await migration.up(runner);
  assert.equal(queries.length, 2);
  const ddl = queries[0]!;
  assert.match(ddl, /CHECK \(`id` = 1\)/);
  assert.equal(queries[1], 'INSERT INTO `website_settings` (`id`) VALUES (1)');
  // Later migrations extend the table; the published schema must still match
  // every entity column the API reads and writes.
  const lbpMigration = new LbpPriceDisplay1794868800000();
  await lbpMigration.up(runner);
  const schemaDdl = queries.join('\n');
  for (const column of metadata.columns) {
    assert.ok(
      schemaDdl.includes('`' + column.databaseName + '`'),
      column.propertyName,
    );
    if (typeof column.default === 'string')
      assert.ok(schemaDdl.includes("DEFAULT '" + column.default + "'"));
  }
  await lbpMigration.down(runner);
  await migration.down(runner);
  assert.equal(queries.at(-1), 'DROP TABLE `website_settings`');
});
test('website settings HTTP API uses real guards, validation, service, and audit boundary', async (t) => {
  const f = fixture();
  let limited = false;
  const auth = {
    currentUser: async (token?: string) => {
      if (!['admin', 'owner'].includes(token ?? ''))
        throw new UnauthorizedException();
      return {
        id: token === 'admin' ? actor.id : 'owner',
        email: `${token}@example.test`,
        displayName: token,
      };
    },
    rateLimit: async () => {
      if (limited) throw new HttpException('Too many requests', 429);
    },
  };
  @Module({
    controllers: [
      AdminWebsiteSettingsController,
      PublicWebsiteSettingsController,
    ],
    providers: [
      { provide: WebsiteSettingsService, useValue: f.service },
      { provide: ConfigService, useValue: config },
      { provide: AuthService, useValue: auth },
      { provide: APP_FILTER, useClass: MonitoringExceptionFilter },
      AuthCookies,
      SessionGuard,
      AdminGuard,
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
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const publicPath = '/api/v1/settings/website';
  const adminPath = '/api/v1/admin/website-settings';
  const patch = (body: unknown, overrides: Record<string, string> = {}) =>
    fetch(base + adminPath, {
      method: 'PATCH',
      headers: {
        Cookie: 'matjary_session=admin',
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
        ...overrides,
      },
      body: JSON.stringify(body),
    });
  try {
    await t.test(
      'anonymous public GET returns defaults and no-store',
      async () => {
        const response = await fetch(base + publicPath);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), await f.service.get());
      },
    );
    for (const [token, status] of [
      ['', 401],
      ['expired', 401],
      ['owner', 403],
      ['admin', 200],
    ] as const) {
      await t.test(
        `admin GET session ${token || 'missing'} returns ${status}`,
        async () => {
          const response = await fetch(base + adminPath, {
            headers: { Cookie: 'matjary_session=' + token },
          });
          assert.equal(response.status, status);
          assert.equal(
            response.headers.get('x-robots-tag'),
            'noindex, nofollow',
          );
        },
      );
    }
    for (const [name, headers, status] of [
      ['missing session', { Cookie: '' }, 401],
      ['non-admin', { Cookie: 'matjary_session=owner' }, 403],
      ['wrong origin', { Origin: 'https://evil.test' }, 403],
      ['missing origin', { Origin: '' }, 403],
      ['non-JSON', { 'Content-Type': 'text/plain' }, 415],
    ] as const) {
      await t.test(`PATCH rejects ${name}`, async () => {
        assert.equal(
          (await patch({ siteName: 'Changed' }, headers)).status,
          status,
        );
      });
    }
    await t.test('public endpoint cannot mutate settings', async () => {
      const response = await fetch(base + publicPath, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(response.status, 404);
    });
    await t.test(
      'invalid values, unknown fields and malformed JSON return sanitized 400',
      async () => {
        for (const input of [
          { siteName: null },
          { primaryColor: 'red' },
          { id: 2 },
          { logoUrl: 'javascript:secret-value' },
          [],
        ]) {
          const response = await patch(input);
          assert.equal(response.status, 400);
          assert.doesNotMatch(await response.text(), /secret-value/);
        }
        const malformed = await fetch(base + adminPath, {
          method: 'PATCH',
          headers: {
            Cookie: 'matjary_session=admin',
            Origin: 'http://localhost:3000',
            'Content-Type': 'application/json',
          },
          body: '{invalid',
        });
        assert.equal(malformed.status, 400);
      },
    );
    await t.test('ordinary JSON retains the 16 KB limit', async () => {
      assert.equal(
        (await patch({ description: 'x'.repeat(20000) })).status,
        413,
      );
    });
    await t.test('rate limiting blocks writes', async () => {
      limited = true;
      assert.equal((await patch({ siteName: 'Changed' })).status, 429);
      limited = false;
      assert.equal(f.state.saves, 0);
    });
    await t.test(
      'authorized PATCH persists, is audited and immediately visible publicly',
      async () => {
        const response = await patch({
          siteName: ' New brand ',
          logoUrl: '/logo.png',
          primaryColor: '#ABCDEF',
        });
        assert.equal(response.status, 200);
        const result = (await response.json()) as Record<string, unknown>;
        assert.equal(result.siteName, 'New brand');
        assert.equal(result.primaryColor, '#abcdef');
        assert.deepEqual(await (await fetch(base + publicPath)).json(), result);
        assert.equal(
          f.state.audits[0]?.requestId,
          response.headers.get('x-request-id'),
        );
        assert.equal((await patch({ logoUrl: null })).status, 200);
        assert.equal((await f.service.get()).logoUrl, null);
      },
    );
    await t.test(
      'database outages produce sanitized 503 responses',
      async () => {
        f.state.failure = 'read';
        for (const response of [
          await fetch(base + publicPath),
          await patch({ siteName: 'Unavailable' }),
        ]) {
          assert.equal(response.status, 503);
          assert.doesNotMatch(await response.text(), /secret-driver-password/);
        }
      },
    );
  } finally {
    await app.close();
  }
});
