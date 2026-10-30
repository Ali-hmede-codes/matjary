import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Script } from 'node:vm';
import {
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Module,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { NestFactory, APP_FILTER } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DataSource, FindOperator, type QueryRunner } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  validateEnvironment,
  type AppEnvironment,
} from '../../libs/config/src/environment';
import { createDatabaseOptions } from '../../libs/database/src/database.options';
import {
  User,
  UserRole,
  AdminScope,
  AdminStoreAssignment,
  Store,
  Product,
  Showcase,
  MediaAsset,
  MediaStatus,
  Cart,
  CartStatus,
  SubscriptionPlan,
  UserSubscription,
  SubscriptionStatus,
  ShowcaseStatus,
  ProductStatus,
  StoreStatus,
  BoostCoin,
  BoostTransaction,
  BoostCampaign,
  BoostCampaignPerformance,
  BoostCampaignStatus,
  BoostBidStrategy,
  BoostTargetType,
} from '../../libs/database/src/entities';
import {
  AdminAuditLog,
  SystemErrorRecord,
  SystemErrorState,
} from '../../libs/database/src/admin.entities';
import {
  moderationWhere,
  visibilitySql,
} from '../../libs/database/src/visibility-policy';
import { STORE_SLUG_TAKEN_CODE } from '../../libs/database/src/content-input';
import { AdminOperations1793572800000 } from '../../libs/database/src/migrations/1793572800000-AdminOperations';
import { AddUserRoles1793745600000 } from '../../libs/database/src/migrations/1793745600000-AddUserRoles';
import { publicUser } from '../../apps/api/src/modules/users/users.service';
import { AdminAccessService } from '../../apps/api/src/modules/admin/admin-access.service';
import { AdminCatalogService } from '../../apps/api/src/modules/admin/admin-catalog.service';
import {
  ADMIN_RESOURCES,
  AdminQueriesService,
} from '../../apps/api/src/modules/admin/admin-queries.service';
import { AdminCatalogController } from '../../apps/api/src/modules/admin/admin-catalog.controller';
import { AdminPageController } from '../../apps/api/src/modules/admin/admin-page.controller';
import { UserDashboardPageController } from '../../apps/api/src/modules/user-dashboard/user-dashboard-page.controller';
import { UserDashboardController } from '../../apps/api/src/modules/user-dashboard/user-dashboard.controller';
import { UserDashboardService } from '../../apps/api/src/modules/user-dashboard/user-dashboard.service';
import {
  AdminCreateProductDto,
  AdminListDto,
  AdminUpdateStoreDto,
} from '../../apps/api/src/modules/admin/admin.dto';
import { AuthService } from '../../apps/api/src/modules/auth/auth.service';
import { AuthCookies } from '../../apps/api/src/modules/auth/auth.cookies';
import {
  AdminGuard,
  SessionGuard,
  MutationGuard,
  AuthOriginGuard,
  AuthRateLimitGuard,
} from '../../apps/api/src/modules/auth/guards/auth.guards';
import { MediaService } from '../../apps/api/src/modules/showcases/media.service';
import { StoresService } from '../../apps/api/src/modules/stores/stores.service';
import { setupApp } from '../../apps/api/src/setup-app';
import { MonitoringExceptionFilter } from '../../apps/api/src/modules/monitoring/monitoring.filter';
import {
  MonitoringController,
  MetricsController,
} from '../../apps/api/src/modules/monitoring/monitoring.controller';
import { MonitoringService } from '../../apps/api/src/modules/monitoring/monitoring.service';
import { PrometheusService } from '../../apps/api/src/modules/monitoring/prometheus.service';

import { CreateBoostCampaignDto } from '../../apps/api/src/modules/boost/dto/boost-coin.dto';
import { SubscriptionPlansService } from '../../apps/api/src/modules/subscriptions/subscription-plans.service';
import { BoostService } from '../../apps/api/src/modules/boost/boost.service';

const adminId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const resourceId = '33333333-3333-4333-8333-333333333333';
const actor = {
  id: adminId,
  requestId: '44444444-4444-4444-8444-444444444444',
};
const config = new ConfigService<AppEnvironment, true>(
  validateEnvironment({
    MYSQL_PASSWORD: 'test',
    REDIS_PASSWORD: 'test',
    ADMIN_EMAILS: 'admin@example.test',
  }),
);

type Row = Record<string, unknown>;
function fixture() {
  let rows = new Map<string, Row[]>();
  let auditFailure = false;
  const clone = (source: Map<string, Row[]>) =>
    new Map(
      [...source].map(([key, values]) => [
        key,
        values.map(
          (value) =>
            Object.assign(
              Object.create(Object.getPrototypeOf(value)),
              structuredClone(value),
            ) as Row,
        ),
      ]),
    );
  const statements: { sql: string; parameters: unknown[] }[] = [];
  const name = (target: unknown) => (target as { name: string }).name;
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => {
      if (value instanceof FindOperator) {
        const expected = value.value as unknown;
        return value.type === 'in' && Array.isArray(expected)
          ? expected.includes(row[key])
          : true;
      }
      return row[key] === value;
    });
  const managerFor = (data: Map<string, Row[]>) => {
    const find = async (target: unknown, where: Row) =>
      (data.get(name(target)) ?? []).find((row) => matches(row, where)) ?? null;
    const manager = {
      query: async (sql: string, parameters: unknown[] = []) => {
        statements.push({ sql, parameters });
        if (sql.startsWith('DELETE FROM ')) return [];
        if (sql.startsWith('SELECT original_key AS storageKey'))
          return [{ storageKey: 'originals/store/asset/source' }];
        if (sql.startsWith('SELECT variant.storage_key AS storageKey'))
          return [{ storageKey: 'media/store/asset/webp-480.webp' }];
        if (sql.startsWith('UPDATE `users` SET `role`')) {
          assert.match(sql, /session_version = session_version \+ 1/);
          const row = await find(User, { id: parameters[2] });
          assert.ok(row);
          row.role = parameters[0];
          row.adminScope = parameters[1];
          row.sessionVersion = Number(row.sessionVersion) + 1;
          return;
        }
        if (sql.startsWith('UPDATE `users` SET `admin_scope`')) {
          const row = await find(User, { id: parameters[1] });
          assert.ok(row);
          row.adminScope = parameters[0];
          return;
        }
        assert.match(
          sql,
          /^UPDATE `(stores|products|showcases|media_assets)` SET admin_archived_at = \?/,
        );
        assert.equal(parameters.length, 2);
      },
      find: async (target: unknown, options?: { where?: Row }) => {
        const rows = data.get(name(target)) ?? [];
        return options?.where
          ? rows.filter((row) => matches(row, options.where!))
          : rows;
      },
      findOneBy: find,
      findOneOrFail: async (target: unknown, options: { where: Row }) => {
        const row = await find(target, options.where);
        if (!row) throw new NotFoundException();
        return row;
      },
      count: async (target: unknown, options?: { where?: Row }) => {
        const rows = data.get(name(target)) ?? [];
        return options?.where
          ? rows.filter((row) => matches(row, options.where!)).length
          : rows.length;
      },
      delete: async (target: unknown, where: Row) => {
        const rows = data.get(name(target)) ?? [];
        data.set(
          name(target),
          rows.filter((row) => !matches(row, where)),
        );
      },
      update: async (target: unknown, where: Row, values: Row) => {
        for (const row of data.get(name(target)) ?? [])
          if (matches(row, where)) Object.assign(row, values);
      },
      findOne: (target: unknown, options: { where: Row }) =>
        find(target, options.where),
      getRepository: (target: unknown) => {
        let selectedId: string | undefined;
        let scopedIds: string[] | undefined;
        const rows = () => data.get(name(target)) ?? [];
        const filtered = () => {
          let list = rows();
          if (selectedId) list = list.filter((row) => row.id === selectedId);
          if (scopedIds)
            list = list.filter(
              (row) =>
                scopedIds!.includes(row.id as string) ||
                scopedIds!.includes(row.storeId as string),
            );
          return list;
        };
        const query = {
          select: () => query,
          where: (
            _sql: string,
            parameters?: { visibilityId?: string; id?: string },
          ) => {
            selectedId = parameters?.id ?? parameters?.visibilityId;
            return query;
          },
          andWhere: (
            _sql: string,
            parameters?: { adminStoreIds?: string[] },
          ) => {
            if (parameters?.adminStoreIds) scopedIds = parameters.adminStoreIds;
            return query;
          },
          orderBy: () => query,
          addOrderBy: () => query,
          setLock: () => query,
          take: () => query,
          skip: () => query,
          // Plan-bundled badges are the only stores the subscription syncs.
          getMany: async () =>
            rows().filter(
              (row) =>
                row.hasVerificationBadge === true &&
                row.verificationIncludedInPlan === true,
            ),
          getManyAndCount: async () => [filtered(), filtered().length],
          getOne: async () => filtered()[0] ?? null,
          getExists: async () => {
            const row = rows().find((item) => item.id === selectedId);
            return Boolean(row && !row.adminArchivedAt);
          },
          getCount: async () => filtered().length,
        };
        return {
          findOne: (options: { where: Row }) => find(target, options.where),
          findOneBy: (where: Row) => find(target, where),
          find: async () => data.get(name(target)) ?? [],
          createQueryBuilder: () => query,
        };
      },
      countBy: async (target: unknown) => (data.get(name(target)) ?? []).length,
      create: (target: unknown, values: Row) =>
        Object.assign(new (target as new () => object)(), values),
      save: async (targetOrRow: unknown, input?: Row) => {
        const row = (input ?? targetOrRow) as Row;
        const table = row.constructor.name;
        row.id ??= randomUUID();
        const list = data.get(table) ?? [];
        if (!list.includes(row)) list.push(row);
        data.set(table, list);
        return row;
      },
      insert: async (target: unknown, input: Row | Row[]) => {
        if (target === AdminAuditLog && auditFailure)
          throw new Error('secret-driver-credentials');
        const list = data.get(name(target)) ?? [];
        for (const row of Array.isArray(input) ? input : [input])
          list.push({ id: randomUUID(), ...row });
        data.set(name(target), list);
      },
    };
    return manager;
  };
  const database = {
    get manager() {
      return managerFor(rows);
    },
    getRepository: (target: unknown) => managerFor(rows).getRepository(target),
    transaction: async (work: (manager: unknown) => Promise<unknown>) => {
      const copy = clone(rows);
      const result = await work(managerFor(copy));
      rows = copy;
      return result;
    },
  } as unknown as DataSource;
  const access = new AdminAccessService(database, config);
  let jobState = 'failed';
  let removals = 0;
  const deleted: string[] = [];
  const storage = {
    statObject: async () => ({ size: 10 }),
    deleteObject: async (key: string) => {
      deleted.push(key);
    },
  };
  const queue = {
    getQueue: () => ({
      getJob: async () => ({
        getState: async () => jobState,
        remove: async () => {
          removals++;
        },
      }),
    }),
  };
  const created: { dto: Row; ownerId: string; options: Row }[] = [];
  const stores = {
    create: async (dto: Row, ownerId: string, options: Row) => {
      created.push({ dto, ownerId, options });
      return { id: randomUUID(), name: dto.name, slug: 'created-shop' };
    },
  };
  const catalog = new AdminCatalogService(
    access,
    storage as never,
    {
      autoGenerateAdminSeo: async () => {},
      autoGenerateOwnedSeo: async () => {},
      notifyIndexNowOnChange: async () => {},
    } as never,
    queue as never,
    stores as never,
  );
  const add = (target: new () => object, values: Row) => {
    const list = rows.get(target.name) ?? [];
    list.push(Object.assign(new target(), values) as Row);
    rows.set(target.name, list);
  };
  add(User, {
    id: adminId,
    email: 'admin@example.test',
    sessionVersion: 0,
    suspendedAt: null,
  });
  add(User, {
    id: ownerId,
    email: 'owner@example.test',
    displayName: 'Owner',
    sessionVersion: 0,
    suspendedAt: null,
  });
  return {
    catalog,
    access,
    queries: new AdminQueriesService(access),
    stores,
    created: () => created,
    add,
    rows: (target: { name: string }) => rows.get(target.name) ?? [],
    statements: () => statements,
    deleted: () => deleted,
    failAudit: () => {
      auditFailure = true;
    },
    activeJob: () => {
      jobState = 'active';
    },
    removals: () => removals,
  };
}

test('user roles grant and revoke admin access, protect bootstrap admins and invalidate sessions', async () => {
  const f = fixture();
  const helper = { ...actor, id: ownerId };
  const change = (role: UserRole) => ({ role, reason: 'Manage website team' });
  const account = () =>
    f.rows(User).find((row) => row.id === ownerId) as unknown as User;
  const guard = new AdminGuard(config);
  const auth = new AuthService({} as never, {} as never, {} as never, config, {
    startIfNew: async () => {},
  } as never);
  assert.equal(guard.isAdmin(publicUser(account())), false);
  await assert.rejects(
    f.catalog.updateUserRole(ownerId, change(UserRole.ADMIN), helper),
    ForbiddenException,
  );
  await f.catalog.updateUserRole(ownerId, change(UserRole.ADMIN), actor);
  assert.equal(account().role, UserRole.ADMIN);
  assert.equal(account().sessionVersion, 1);
  assert.equal(guard.isAdmin(publicUser(account())), true);
  assert.equal(auth.isAdmin(publicUser(account())), true);
  await f.access.check(helper);
  await assert.rejects(
    f.catalog.updateUserRole(ownerId, change(UserRole.USER), helper),
    ConflictException,
  );
  await assert.rejects(
    f.catalog.updateUserRole(adminId, change(UserRole.USER), helper),
    ConflictException,
  );
  await f.catalog.updateUserRole(ownerId, change(UserRole.ADMIN), actor);
  assert.equal(account().sessionVersion, 1);
  await f.catalog.updateUserRole(ownerId, change(UserRole.USER), actor);
  assert.equal(account().sessionVersion, 2);
  assert.equal(guard.isAdmin(publicUser(account())), false);
  await assert.rejects(f.access.check(helper), ForbiddenException);
  assert.deepEqual(
    f.rows(AdminAuditLog).map((row) => row.action),
    ['role.update', 'role.update'],
  );
  assert.equal(f.rows(AdminAuditLog)[0]?.reason, 'Manage website team');
  await f.catalog.accountAction(ownerId, 'suspend', 'Account paused', actor);
  await assert.rejects(
    f.catalog.updateUserRole(ownerId, change(UserRole.ADMIN), actor),
    ConflictException,
  );
});

test('user role changes roll back when their audit cannot be written', async () => {
  const f = fixture();
  f.failAudit();
  await assert.rejects(
    f.catalog.updateUserRole(
      ownerId,
      { role: UserRole.ADMIN, reason: 'Add helper' },
      actor,
    ),
    ServiceUnavailableException,
  );
  const user = f.rows(User).find((row) => row.id === ownerId)!;
  assert.equal(user.role, UserRole.USER);
  assert.equal(user.sessionVersion, 0);
});

test('administrator store scope is granted, narrowed and cleared with the role', async () => {
  const f = fixture();
  const storeA = randomUUID();
  const storeB = randomUUID();
  f.add(Store, { id: storeA, ownerId, status: StoreStatus.ACTIVE });
  f.add(Store, { id: storeB, ownerId, status: StoreStatus.ACTIVE });

  // Granting admin access chooses the shops in the same audited operation.
  const granted = await f.catalog.updateUserRole(
    ownerId,
    {
      role: UserRole.ADMIN,
      scope: AdminScope.STORES,
      storeIds: [storeA, storeB],
      reason: 'Shop helper',
    },
    actor,
  );
  assert.deepEqual(granted, {
    id: ownerId,
    role: UserRole.ADMIN,
    scope: AdminScope.STORES,
  });
  assert.equal(
    f.rows(User).find((row) => row.id === ownerId)?.adminScope,
    AdminScope.STORES,
  );
  assert.deepEqual(
    f
      .rows(AdminStoreAssignment)
      .map((row) => row.storeId)
      .sort(),
    [storeA, storeB].sort(),
  );

  const narrowed = await f.catalog.updateUserScope(
    ownerId,
    { scope: AdminScope.STORES, storeIds: [storeB], reason: 'One shop' },
    actor,
  );
  assert.deepEqual(narrowed, {
    id: ownerId,
    scope: AdminScope.STORES,
    storeIds: [storeB],
  });
  assert.deepEqual(
    f.rows(AdminStoreAssignment).map((row) => row.storeId),
    [storeB],
  );

  // A store scope without shops is refused, never interpreted as global access.
  await assert.rejects(
    f.catalog.updateUserScope(
      ownerId,
      { scope: AdminScope.STORES, storeIds: [], reason: 'No shops' },
      actor,
    ),
    BadRequestException,
  );
  // A trashed shop cannot be assigned to an administrator.
  f.add(Store, {
    id: randomUUID(),
    ownerId,
    status: StoreStatus.TRASHED,
  });
  const trashedId = f
    .rows(Store)
    .find((row) => row.status === StoreStatus.TRASHED)!.id as string;
  await assert.rejects(
    f.catalog.updateUserScope(
      ownerId,
      { scope: AdminScope.STORES, storeIds: [trashedId], reason: 'Trash' },
      actor,
    ),
    BadRequestException,
  );

  // Revoking the role removes every assignment and resets the scope.
  await f.catalog.updateUserRole(
    ownerId,
    { role: UserRole.USER, reason: 'Done' },
    actor,
  );
  assert.equal(f.rows(AdminStoreAssignment).length, 0);
  assert.equal(
    f.rows(User).find((row) => row.id === ownerId)?.adminScope,
    AdminScope.ALL,
  );
});

test('store-scoped administrators reach only their assigned shops', async () => {
  const f = fixture();
  const scopedId = randomUUID();
  const storeA = randomUUID();
  const storeB = randomUUID();
  const scopedActor = { id: scopedId, requestId: randomUUID() };
  f.add(User, {
    id: scopedId,
    email: 'scoped@example.test',
    role: UserRole.ADMIN,
    adminScope: AdminScope.STORES,
    sessionVersion: 0,
    suspendedAt: null,
  });
  f.add(Store, {
    id: storeA,
    ownerId,
    name: 'Mine',
    slug: 'mine',
    status: StoreStatus.ACTIVE,
  });
  f.add(Store, {
    id: storeB,
    ownerId,
    name: 'Other',
    slug: 'other',
    status: StoreStatus.ACTIVE,
  });
  f.add(AdminStoreAssignment, { userId: scopedId, storeId: storeA });

  const ownShop = (await f.queries.detail(
    'stores',
    storeA,
    scopedActor,
  )) as unknown as Row;
  assert.equal(ownShop.id, storeA);
  // Any shop outside the assignment answers exactly like a missing one.
  await assert.rejects(
    f.queries.detail('stores', storeB, scopedActor),
    NotFoundException,
  );
  // Platform-wide records stay closed to a store-scoped administrator.
  await assert.rejects(
    f.queries.list('users', new AdminListDto(), scopedActor),
    ForbiddenException,
  );
  // The overview counts only the assigned shops and hides platform totals.
  const counts = await f.queries.overview(scopedActor);
  assert.equal(counts.users, 0);
  assert.equal(counts.stores, 1);
  // Hiding content follows the same shop boundary.
  await f.catalog.archive('stores', storeA, true, 'Review', scopedActor);
  assert.ok(
    f.rows(Store).find((row) => row.id === storeA)?.adminArchivedAt instanceof
      Date,
  );
  await assert.rejects(
    f.catalog.archive('stores', storeB, true, 'Review', scopedActor),
    NotFoundException,
  );
  const mediaId = randomUUID();
  f.add(MediaAsset, { id: mediaId, storeId: storeA, adminArchivedAt: null });
  await assert.rejects(
    f.catalog.archive('media', mediaId, true, 'Review', scopedActor),
    ForbiddenException,
  );
  // Verification decisions and shop creation remain platform-only.
  await assert.rejects(
    f.catalog.badge(storeA, true, 'Review', scopedActor),
    ForbiddenException,
  );
  await assert.rejects(
    f.catalog.createStore({ name: 'Seeded shop', ownerId }, scopedActor),
    ForbiddenException,
  );
});

test('platform administrators create shops without plan quotas', async () => {
  const f = fixture();
  const repository = {
    manager: f.access.database,
    findOneBy: async () => null,
    create: (values: Row) => Object.assign(new Store(), values),
  };
  const seo = { autoGenerateOwnedSeo: async () => {} };
  const service = new StoresService(
    repository as never,
    {} as never,
    {} as never,
    {} as never,
    seo as never,
    new AdminGuard(config),
    {} as never,
  );
  const allowlist = config.get('ADMIN_EMAILS', { infer: true });
  // Without an administrator, the owner has no subscription and is refused.
  await assert.rejects(
    service.create({ name: 'Owner shop' } as never, ownerId),
    ForbiddenException,
  );
  const created = await service.create(
    { name: 'Seeded shop' } as never,
    ownerId,
    { administrator: { actor, allowlist } },
  );
  assert.equal(created.name, 'Seeded shop');
  assert.equal(created.ownerId, ownerId);
  assert.equal(f.rows(Store).length, 1);
  assert.equal(f.rows(AdminAuditLog).at(-1)?.action, 'store.create');
  // A non-administrator cannot use the administrator path.
  await assert.rejects(
    service.create({ name: 'Sneaky shop' } as never, ownerId, {
      administrator: { actor: { ...actor, id: ownerId }, allowlist },
    }),
    ForbiddenException,
  );
});

test('user roles migration is registered, defaults to user and has a rollback', async () => {
  const migration = new AddUserRoles1793745600000();
  const statements: string[] = [];
  const runner = {
    query: async (sql: string) => statements.push(sql),
  } as unknown as QueryRunner;
  await migration.up(runner);
  await migration.down(runner);
  assert.match(
    statements[0]!,
    /enum\('user','admin'\) NOT NULL DEFAULT 'user'/,
  );
  assert.equal(statements[1], 'ALTER TABLE `users` DROP COLUMN `role`');
  const options = createDatabaseOptions(
    validateEnvironment({ MYSQL_PASSWORD: 'test', REDIS_PASSWORD: 'test' }),
  );
  assert.ok(
    (options.migrations as unknown[]).includes(AddUserRoles1793745600000),
  );
});

test('administrator catalog stays read-only except audited oversight, shop creation, and shop identity edits', async () => {
  const f = fixture();
  for (const method of [
    'createProduct',
    'updateProduct',
    'createPost',
    'updatePost',
    'updateMedia',
  ]) {
    assert.equal(method in f.catalog, false);
    assert.equal(method in AdminCatalogController.prototype, false);
  }
  // A platform administrator can open a shop for an owner and correct its
  // public identity; nothing else about the catalog becomes owner-editable.
  assert.equal(typeof f.catalog.createStore, 'function');
  assert.equal(typeof AdminCatalogController.prototype.createStore, 'function');
  await f.catalog.createStore({ name: 'Seeded shop', ownerId }, actor);
  assert.equal(typeof f.catalog.updateStore, 'function');
  assert.equal(typeof AdminCatalogController.prototype.updateStore, 'function');
  assert.equal(f.created().length, 1);
  assert.equal(f.created()[0]?.ownerId, ownerId);
  assert.deepEqual(
    (f.created()[0]?.options as { administrator: { actor: { id: string } } })
      .administrator.actor.id,
    adminId,
  );
  f.add(Store, { id: resourceId, ownerId, hasVerificationBadge: false });
  await f.catalog.badge(resourceId, true, 'Identity reviewed', actor);
  assert.equal(f.rows(Store)[0]?.hasVerificationBadge, true);
  await f.catalog.badge(resourceId, false, 'Verification withdrawn', actor);
  assert.equal(f.rows(Store)[0]?.hasVerificationBadge, false);
  assert.equal(f.rows(AdminAuditLog).length, 2);
});

test('administrators edit a shop address and identity while slugs stay unique', async () => {
  const f = fixture();
  const otherId = '77777777-7777-4777-8777-777777777777';
  f.add(Store, {
    id: resourceId,
    ownerId,
    name: 'Cedar',
    slug: 'cedar',
    status: StoreStatus.ACTIVE,
    description: null,
    brandColor: null,
    storeType: 'ecommerce',
    businessCategory: 'other',
  });
  f.add(Store, {
    id: otherId,
    ownerId,
    name: 'Olive',
    slug: 'olive',
    status: StoreStatus.ACTIVE,
  });
  // Another shop already holds the requested address.
  await assert.rejects(
    f.catalog.updateStore(
      resourceId,
      { slug: 'olive', reason: 'Correct the public address' },
      actor,
    ),
    (error: unknown) =>
      error instanceof ConflictException &&
      (error.getResponse() as { code?: string }).code === STORE_SLUG_TAKEN_CODE,
  );
  // Shop identity stays a platform-wide operation, like shop creation.
  await assert.rejects(
    f.catalog.updateStore(
      resourceId,
      { slug: 'cedar-2', reason: 'Correct the public address' },
      { ...actor, id: ownerId },
    ),
    ForbiddenException,
  );
  const saved = await f.catalog.updateStore(
    resourceId,
    {
      name: 'Cedar House',
      slug: 'cedar-house',
      businessCategory: 'other',
      reason: 'Correct the public address',
    },
    actor,
  );
  assert.deepEqual(saved, {
    id: resourceId,
    name: 'Cedar House',
    slug: 'cedar-house',
    status: StoreStatus.ACTIVE,
  });
  assert.equal(
    f.rows(Store).find((row) => row.id === resourceId)?.slug,
    'cedar-house',
  );
  assert.equal(f.rows(Store).find((row) => row.id === otherId)?.slug, 'olive');
  assert.equal(f.rows(AdminAuditLog).at(-1)?.action, 'store.update');
  assert.equal(
    f.rows(AdminAuditLog).at(-1)?.reason,
    'Correct the public address',
  );
});

test('permanent store purge requires Trash, removes child records, and is audited', async () => {
  const f = fixture();
  const trashedId = '55555555-5555-4555-8555-555555555555';
  f.add(Store, { id: trashedId, ownerId, status: StoreStatus.TRASHED });
  await assert.rejects(
    f.catalog.purgeStore(resourceId, 'Owner requested removal', actor),
    NotFoundException,
  );
  f.add(Store, { id: resourceId, ownerId, status: StoreStatus.ACTIVE });
  await assert.rejects(
    f.catalog.purgeStore(resourceId, 'Owner requested removal', actor),
    ConflictException,
  );
  assert.ok(!f.statements().some(({ sql }) => sql.startsWith('DELETE')));

  await f.catalog.purgeStore(trashedId, 'Owner requested removal', actor);
  const statements = f.statements().map(({ sql }) => sql);
  assert.ok(statements.some((sql) => sql.startsWith('DELETE FROM products ')));
  assert.ok(statements.some((sql) => sql.startsWith('DELETE FROM showcases ')));
  assert.equal(statements.at(-1), 'DELETE FROM stores WHERE id = ?');
  assert.deepEqual(f.deleted().sort(), [
    'media/store/asset/webp-480.webp',
    'originals/store/asset/source',
  ]);
  assert.equal(f.rows(AdminAuditLog).at(-1)?.action, 'purge');
  assert.equal(f.rows(AdminAuditLog).at(-1)?.reason, 'Owner requested removal');
});

test('permanent store purge rolls back and removes no bytes when its audit fails', async () => {
  const f = fixture();
  const id = '66666666-6666-4666-8666-666666666666';
  f.add(Store, { id, ownerId, status: StoreStatus.TRASHED });
  f.failAudit();
  await assert.rejects(
    f.catalog.purgeStore(id, 'Owner requested removal', actor),
    ServiceUnavailableException,
  );
  assert.deepEqual(f.deleted(), []);
});

test('subscription management preserves free fallback and historical assignments', async () => {
  const f = fixture();
  const repository = {
    manager: {
      transaction: f.access.database.transaction.bind(f.access.database),
    },
    findOneBy: (where: object) =>
      f.access.database.manager.findOneBy(SubscriptionPlan, where),
    create: (values: object) => Object.assign(new SubscriptionPlan(), values),
  };
  const plans = new SubscriptionPlansService(
    repository as never,
    repository as never,
    config,
  );
  const free = await plans.create(
    { slug: 'free', name: 'Free', limits: {}, priceCents: 0 },
    adminId,
  );
  assert.match(
    f.rows(AdminAuditLog)[0]?.resourceId as string,
    /^[0-9a-f-]{36}$/,
  );
  await assert.rejects(
    plans.update(free.id, { isActive: false }, adminId),
    BadRequestException,
  );
  await assert.rejects(
    plans.update(free.id, { priceCents: 1 }, adminId),
    BadRequestException,
  );
  const paid = await plans.create(
    {
      slug: 'paid',
      name: 'Paid',
      limits: { maxVerificationBadges: 1 },
      priceCents: 100,
    },
    adminId,
  );
  await plans.update(paid.id, { name: 'Premium' }, adminId);
  // Zero is an entitlement, not a missing quota: the admin panel saves 0 to
  // turn stories off or bundle no badges, so it must not fail validation.
  const zeroed = await plans.create(
    {
      slug: 'zeroed',
      name: 'Zeroed',
      limits: { maxStories: 0, maxVerificationBadges: 0 },
      priceCents: 100,
    },
    adminId,
  );
  await plans.update(
    zeroed.id,
    { limits: { maxStories: 0, maxVerificationBadges: 0 } },
    adminId,
  );
  assert.equal(
    (
      f.rows(SubscriptionPlan).find((row) => row.id === zeroed.id)?.limits as
        { maxStories?: number } | undefined
    )?.maxStories,
    0,
  );
  await plans.delete(paid.id, adminId);
  assert.equal(
    f.rows(SubscriptionPlan).find((row) => row.id === paid.id)?.isActive,
    false,
  );
  await plans.update(paid.id, { isActive: true }, adminId);
  f.add(Store, {
    id: '77777777-7777-4777-8777-777777777777',
    ownerId,
    hasVerificationBadge: true,
    verificationIncludedInPlan: true,
    verificationBadgeExpiresAt: new Date(Date.now() + 86_400_000),
  });
  const paidExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const first = await plans.assignSubscription({
    userId: ownerId,
    planId: paid.id,
    assignedBy: adminId,
    phone: '03 123 456',
    expiresAt: paidExpiry,
  });
  // The assignment records a callable number for the recipient.
  assert.equal(
    f.rows(User).find((row) => row.id === ownerId)?.phone,
    '+9613123456',
  );
  assert.ok(f.rows(AdminAuditLog).some((row) => row.action === 'phone.update'));
  // A bundled badge follows the subscription that pays for it.
  assert.equal(
    new Date(f.rows(Store)[0]?.verificationBadgeExpiresAt as Date).getTime(),
    paidExpiry.getTime(),
  );
  await plans.assignSubscription({
    userId: ownerId,
    planId: free.id,
    assignedBy: adminId,
    // No Lebanese line: the country code is supplied by the form.
    phone: '050 123 4567',
    phoneCountryCode: '+971',
  });
  assert.equal(
    f.rows(User).find((row) => row.id === ownerId)?.phone,
    '+971501234567',
  );
  // A plan without badge slots ends the bundled badge (grace still applies)
  // instead of letting it run on a subscription that no longer bundles it.
  assert.equal(f.rows(Store)[0]?.verificationIncludedInPlan, false);
  assert.ok(
    (f.rows(Store)[0]?.verificationBadgeExpiresAt as Date).getTime() <=
      Date.now(),
  );
  assert.equal(
    f.rows(UserSubscription).find((row) => row.id === first.id)?.status,
    SubscriptionStatus.CANCELLED,
  );
  assert.equal(f.rows(UserSubscription).length, 2);
  const freeAssignment = f
    .rows(UserSubscription)
    .find((row) => row.status === SubscriptionStatus.ACTIVE)!;
  const trialMs =
    new Date(freeAssignment.expiresAt as Date).getTime() -
    new Date(freeAssignment.startsAt as Date).getTime();
  assert.equal(trialMs, 3 * 24 * 60 * 60 * 1000);
  await assert.rejects(
    plans.assignSubscription({
      userId: ownerId,
      planId: free.id,
      assignedBy: adminId,
      phone: '03 123 456',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }),
    (error: any) =>
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code === 'FREE_TRIAL_CAP',
  );
  await assert.rejects(
    plans.assignSubscription({
      userId: ownerId,
      planId: free.id,
      assignedBy: adminId,
      phone: 'not a number',
    }),
    (error: any) =>
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code ===
        'SUBSCRIPTION_PHONE_INVALID',
  );
  await plans.cancelAssignment(freeAssignment.id as string, adminId);
  assert.ok(
    f
      .rows(UserSubscription)
      .every((row) => row.status === SubscriptionStatus.CANCELLED),
  );
  await assert.rejects(
    plans.create({ slug: 'unauthorized', name: 'No', limits: {} }, ownerId),
    ForbiddenException,
  );
});

test('wallet adjustments are idempotent, preserve reservations and roll back with failed audits', async () => {
  const f = fixture();
  f.add(BoostCoin, { userId: ownerId, balance: '9007199254740000' });
  const users = {
    findOne: (options: { where: object }) =>
      f.access.database.manager.findOne(User, options),
  };
  const boosts = new BoostService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    users as never,
    {} as never,
    {} as never,
    f.access.database,
    config,
    { setIfNotExistsWithTtl: async () => true } as never,
  );
  const operation = randomUUID();
  const result = await boosts.adminAdjustBalance(
    adminId,
    ownerId,
    1,
    'Verified grant',
    operation,
  );
  assert.equal(result.newBalance, '9007199254740001');
  const retry = await boosts.adminAdjustBalance(
    adminId,
    ownerId,
    1,
    'Verified grant',
    operation,
  );
  assert.equal(retry.transaction.id, result.transaction.id);
  assert.equal(f.rows(BoostTransaction).length, 1);
  assert.equal(f.rows(AdminAuditLog).length, 1);
  await assert.rejects(
    boosts.adminAdjustBalance(adminId, ownerId, 2, 'Changed grant', operation),
    BadRequestException,
  );
  f.add(BoostCampaign, {
    userId: ownerId,
    status: BoostCampaignStatus.ACTIVE,
    budgetCoins: '9007199254740001',
    spentCoins: '0',
  });
  await assert.rejects(
    boosts.adminAdjustBalance(
      adminId,
      ownerId,
      -1,
      'Reserved deduction',
      randomUUID(),
    ),
    BadRequestException,
  );
  f.failAudit();
  await assert.rejects(
    boosts.adminAdjustBalance(
      adminId,
      ownerId,
      1,
      'Audit outage',
      randomUUID(),
    ),
  );
  assert.equal(f.rows(BoostCoin)[0]?.balance, '9007199254740001');
  assert.equal(f.rows(BoostTransaction).length, 1);
});

test('campaign review, pause, resume and cancel preserve spending and enforce target visibility', async () => {
  const f = fixture();
  f.add(BoostCoin, { userId: ownerId, balance: '1000' });
  f.add(Store, { id: resourceId, ownerId, adminArchivedAt: null });
  f.add(UserSubscription, {
    userId: ownerId,
    status: SubscriptionStatus.ACTIVE,
    startsAt: new Date(0),
    expiresAt: new Date('2999-01-01T00:00:00Z'),
    plan: { slug: 'free', limits: {} },
  });
  const campaignId = randomUUID();
  f.add(BoostCampaign, {
    id: campaignId,
    userId: ownerId,
    status: BoostCampaignStatus.PENDING_REVIEW,
    targetType: BoostTargetType.STORE,
    targetStoreId: resourceId,
    budgetCoins: '500',
    spentCoins: '100',
  });
  const repository = {
    findOne: (options: { where: object }) =>
      f.access.database.manager.findOne(BoostCampaign, options),
  };
  const boosts = new BoostService(
    {} as never,
    {} as never,
    repository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    f.access.database,
    config,
    { setIfNotExistsWithTtl: async () => true } as never,
  );
  await assert.rejects(
    boosts.adminReviewCampaign(campaignId, ownerId, 'approve'),
    ForbiddenException,
  );
  await boosts.asAdministrator(actor, () =>
    boosts.adminReviewCampaign(campaignId, adminId, 'approve'),
  );
  assert.equal(f.rows(BoostCampaign)[0]?.status, BoostCampaignStatus.ACTIVE);
  await boosts.asAdministrator(actor, () =>
    boosts.pauseCampaign(campaignId, ownerId),
  );
  await f.catalog.archive(
    'stores',
    resourceId,
    true,
    'Target unavailable',
    actor,
  );
  await assert.rejects(
    boosts.asAdministrator(actor, () =>
      boosts.resumeCampaign(campaignId, ownerId),
    ),
    NotFoundException,
  );
  await f.catalog.archive(
    'stores',
    resourceId,
    false,
    'Target restored',
    actor,
  );
  await boosts.asAdministrator(actor, () =>
    boosts.resumeCampaign(campaignId, ownerId),
  );
  await boosts.asAdministrator(actor, () =>
    boosts.cancelCampaign(campaignId, ownerId),
  );
  assert.equal(f.rows(BoostCampaign)[0]?.status, BoostCampaignStatus.CANCELLED);
  assert.equal(f.rows(BoostCampaign)[0]?.spentCoins, '100');
  assert.equal(f.rows(BoostCoin)[0]?.balance, '1000');
  assert.equal(f.rows(BoostTransaction).length, 0);
});

test('ad delivery debits reserved coins once and completes an exhausted campaign', async () => {
  const f = fixture();
  f.add(BoostCoin, { userId: ownerId, balance: '1000' });
  f.add(Store, { id: resourceId, ownerId, adminArchivedAt: null });
  const campaignId = randomUUID();
  f.add(BoostCampaign, {
    id: campaignId,
    userId: ownerId,
    status: BoostCampaignStatus.ACTIVE,
    targetType: BoostTargetType.STORE,
    targetStoreId: resourceId,
    budgetCoins: '5',
    spentCoins: '0',
    bidStrategy: BoostBidStrategy.CPC,
    bidAmountCoins: '5',
    startAt: new Date(0),
    endAt: null,
  });
  const repository = {
    findOne: (options: { where: object }) =>
      f.access.database.manager.findOne(BoostCampaign, options),
  };
  const boosts = new BoostService(
    {} as never,
    {} as never,
    repository as never,
    {} as never,
    { find: async () => [] } as never,
    {} as never,
    {} as never,
    {} as never,
    f.access.database,
    config,
    { setIfNotExistsWithTtl: async () => true } as never,
  );
  await boosts.recordClick(campaignId);
  assert.equal(f.rows(BoostCoin)[0]?.balance, '995');
  assert.equal(f.rows(BoostCampaign)[0]?.spentCoins, '5');
  assert.equal(f.rows(BoostCampaign)[0]?.status, BoostCampaignStatus.COMPLETED);
  assert.equal(f.rows(BoostCampaignPerformance)[0]?.clicks, '1');
  assert.equal(f.rows(BoostCampaignPerformance)[0]?.spendCoins, '5');
  assert.equal(f.rows(BoostTransaction)[0]?.amount, '-5');
  await assert.rejects(boosts.recordClick(campaignId), BadRequestException);
});

test('admin mutations recheck privilege, protect administrators and revoke old session versions', async () => {
  const f = fixture();
  await assert.rejects(
    f.catalog.accountAction(ownerId, 'suspend', 'Moderation action', {
      ...actor,
      id: ownerId,
    }),
    ForbiddenException,
  );
  await assert.rejects(
    f.catalog.accountAction(adminId, 'suspend', 'Moderation action', actor),
    ConflictException,
  );
  await f.catalog.accountAction(ownerId, 'suspend', 'Moderation action', actor);
  const suspended = f.rows(User).find((row) => row.id === ownerId)!;
  assert.ok(suspended.suspendedAt instanceof Date);
  assert.equal(suspended.sessionVersion, 1);
  await f.catalog.accountAction(ownerId, 'restore', 'Appeal accepted', actor);
  assert.equal(
    f.rows(User).find((row) => row.id === ownerId)?.suspendedAt,
    null,
  );
  assert.equal(
    f.rows(User).find((row) => row.id === ownerId)?.sessionVersion,
    2,
  );
  assert.equal(f.rows(AdminAuditLog).length, 2);
});

test('audit failures roll back administrative changes and never expose raw errors', async () => {
  const f = fixture();
  f.failAudit();
  await assert.rejects(
    f.catalog.updateUser(ownerId, { displayName: 'Changed' }, actor),
    (error: Error) => {
      assert.doesNotMatch(error.message, /secret-driver/);
      return error instanceof ServiceUnavailableException;
    },
  );
  assert.equal(
    f.rows(User).find((row) => row.id === ownerId)?.displayName,
    'Owner',
  );
  assert.equal(f.rows(AdminAuditLog).length, 0);
});

test('archive and restore preserve publication state and media bytes', async () => {
  const f = fixture();
  for (const [resource, target] of [
    ['stores', Store],
    ['products', Product],
    ['posts', Showcase],
    ['media', MediaAsset],
  ] as const) {
    f.add(target, {
      id: resourceId,
      status: 'published',
      originalKey: 'retained/original',
      adminArchivedAt: null,
    });
    await f.catalog.archive(
      resource,
      resourceId,
      true,
      'Moderation archive',
      actor,
    );
    assert.ok(f.rows(target)[0]?.adminArchivedAt instanceof Date);
    assert.equal(f.rows(target)[0]?.status, 'published');
    assert.equal(f.rows(target)[0]?.originalKey, 'retained/original');
    await f.catalog.archive(
      resource,
      resourceId,
      false,
      'Appeal accepted',
      actor,
    );
    assert.equal(f.rows(target)[0]?.adminArchivedAt, null);
  }
  assert.equal(f.rows(AdminAuditLog).length, 8);
});

test('media retries reject active jobs and atomically retain dispatch intent', async () => {
  const f = fixture();
  f.add(MediaAsset, {
    id: resourceId,
    status: MediaStatus.FAILED,
    originalKey: 'retained/original',
    sizeBytes: '10',
    processingLimits: { maxBytes: 20 },
    adminArchivedAt: null,
  });
  await f.catalog.retryMedia(resourceId, 'Retry transient failure', actor);
  assert.equal(f.rows(MediaAsset)[0]?.status, MediaStatus.PROCESSING);
  assert.equal(f.removals(), 1);
  await assert.rejects(
    f.catalog.retryMedia(resourceId, 'Retry again', actor),
    ConflictException,
  );
  const active = fixture();
  active.activeJob();
  active.add(MediaAsset, {
    id: resourceId,
    status: MediaStatus.FAILED,
    originalKey: 'retained/original',
    sizeBytes: '10',
    processingLimits: { maxBytes: 20 },
    adminArchivedAt: null,
  });
  await assert.rejects(
    active.catalog.retryMedia(resourceId, 'Retry transient failure', actor),
    ConflictException,
  );
  assert.equal(active.rows(MediaAsset)[0]?.status, MediaStatus.FAILED);
  assert.equal(active.removals(), 0);
});

test('cart history is not rewritten and error state changes are audited', async () => {
  const f = fixture();
  f.add(Cart, { id: resourceId, status: CartStatus.CHECKED_OUT });
  await assert.rejects(
    f.catalog.expireCart(resourceId, 'Close inactive cart', actor),
    ConflictException,
  );
  f.add(SystemErrorRecord, { id: resourceId, state: SystemErrorState.OPEN });
  await f.catalog.errorState(
    resourceId,
    { state: SystemErrorState.RESOLVED, reason: 'Fix verified' },
    actor,
  );
  assert.equal(f.rows(SystemErrorRecord)[0]?.state, SystemErrorState.RESOLVED);
  assert.equal(f.rows(AdminAuditLog)[0]?.resource, 'errors');
});

test('all administrative read fields exist and moderation SQL covers parent and owner restrictions', async () => {
  class MetadataSource extends DataSource {
    async inspect() {
      await this.buildMetadatas();
    }
  }
  const source = new MetadataSource(
    createDatabaseOptions(
      validateEnvironment({ MYSQL_PASSWORD: 'test', REDIS_PASSWORD: 'test' }),
    ),
  );
  await source.inspect();
  for (const resource of Object.values(ADMIN_RESOURCES)) {
    const metadata = source.getMetadata(resource.target);
    for (const field of resource.fields)
      assert.ok(
        metadata.findColumnWithPropertyName(field),
        `${metadata.name}.${field}`,
      );
    assert.ok(
      !resource.fields.includes('passwordHash') &&
        !resource.fields.includes('googleSubject') &&
        !resource.fields.includes('visitorId'),
    );
  }
  for (const [kind, target] of [
    ['store', Store],
    ['product', Product],
    ['post', Showcase],
    ['media', MediaAsset],
  ] as const) {
    const metadata = source.getMetadata(target);
    assert.equal(
      metadata.findColumnWithPropertyName('adminArchivedAt')?.isUpdate,
      false,
    );
    assert.ok(
      metadata.indices.some(
        (index) => index.name === `idx_${metadata.tableName}_admin_archive`,
      ),
    );
    const updateSql = source
      .getRepository(target)
      .createQueryBuilder()
      .update()
      .set({ adminArchivedAt: null, updatedAt: new Date() })
      .where('id = :id', { id: resourceId })
      .getSql();
    assert.doesNotMatch(updateSql, /admin_archived_at/);
    const sql = source
      .getRepository(target)
      .createQueryBuilder('item')
      .setFindOptions({ where: moderationWhere(kind) })
      .getSql();
    assert.match(sql, /admin_archived_at/);
    assert.match(sql, /suspended_at/);
    if (kind !== 'store') assert.match(sql, /stores/);
  }
  assert.throws(() => visibilitySql('store', 'item; DROP TABLE users'));
});

test('administrative migration registers reversible small DDL statements', async () => {
  const statements: string[] = [];
  const runner = {
    query: async (query: string) => {
      assert.doesNotMatch(query, /;\s*\S/);
      statements.push(query);
    },
  } as unknown as QueryRunner;
  const migration = new AdminOperations1793572800000();
  await migration.up(runner);
  assert.ok(
    statements.some((sql) => sql.includes('CREATE TABLE `admin_audit_log`')),
  );
  assert.ok(statements.some((sql) => sql.includes('session_version')));
  statements.length = 0;
  await migration.down(runner);
  assert.equal(
    statements.filter((sql) => sql.startsWith('DROP TABLE')).length,
    2,
  );
});

test('admin DTOs reject unbounded pagination, unsafe money and arbitrary theme properties', async () => {
  for (const [type, input] of [
    [AdminListDto, { limit: 101 }],
    [AdminListDto, { offset: -1 }],
    [
      AdminCreateProductDto,
      { storeId: resourceId, slug: 'item', name: 'Item', priceCents: 1.5 },
    ],
    [
      AdminUpdateStoreDto,
      { designSettings: { customCss: 'body { display:none }' } },
    ],
  ] as const)
    assert.ok(
      (
        await validate(plainToInstance(type as new () => object, input), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length,
    );
  const campaign = plainToInstance(CreateBoostCampaignDto, {
    name: 'Campaign',
    targetType: 'store',
    targetId: resourceId,
    budgetCoins: '1000',
    targeting: {},
  });
  assert.equal((await validate(campaign)).length, 0);
});

test('HTTP admin pages and mutations enforce Google sessions, roles, origin and strict DTOs', async () => {
  const calls: string[] = [];
  const auth = {
    currentUser: async (token?: string) => {
      if (!['admin', 'owner'].includes(token ?? ''))
        throw new UnauthorizedException();
      return {
        id: token === 'admin' ? adminId : ownerId,
        email: `${token}@example.test`,
        displayName: token,
      };
    },
    isAdmin: (user: { email: string }) => user.email === 'admin@example.test',
    rateLimit: async () => {},
  };
  @Module({
    controllers: [
      AdminPageController,
      UserDashboardPageController,
      UserDashboardController,
      AdminCatalogController,
      MonitoringController,
      MetricsController,
    ],
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: ConfigService, useValue: config },
      { provide: APP_FILTER, useClass: MonitoringExceptionFilter },
      {
        provide: MonitoringService,
        useValue: {
          health: async () => ({ checks: { worker: 'down' } }),
          assertScrape: () => {
            throw new NotFoundException();
          },
        },
      },
      {
        provide: PrometheusService,
        useValue: { vps: async () => ({ status: 'not_configured' }) },
      },
      {
        provide: AdminCatalogService,
        useValue: {
          updateUserRole: async (_id: string, dto: { role: UserRole }) => ({
            id: ownerId,
            role: dto.role,
          }),
          updateUser: async (_id: string, dto: { displayName: string }) => {
            if (dto.displayName === 'explode')
              throw new Error('synthetic-cookie-secret database-password');
            calls.push('update');
            return { id: ownerId };
          },
        },
      },
      {
        provide: AdminQueriesService,
        useValue: { list: async () => ({ items: [], total: 0 }) },
      },
      { provide: MediaService, useValue: {} },
      {
        provide: UserDashboardService,
        useValue: {
          getDashboard: async (userId: string) => ({ scope: userId }),
        },
      },
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
  const patch = (
    body: unknown,
    token = 'admin',
    origin = 'http://localhost:3000',
  ) =>
    fetch(base + '/api/v1/admin/users/' + ownerId, {
      method: 'PATCH',
      headers: {
        Cookie: 'matjary_session=' + token,
        Origin: origin,
        'Content-Type': 'application/json',
        'X-Request-ID': 'attacker-supplied-secret',
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (await fetch(base + '/api/v1/admin', { redirect: 'manual' })).status,
      302,
    );
    assert.equal((await fetch(base + '/api/v1/admin/data/users')).status, 401);
    const ownerHeaders = { Cookie: 'matjary_session=owner' };
    for (const [oldPath, nextPath] of [
      ['admin', '/admin'],
      ['dashboard/home', '/dashboard'],
    ]) {
      const page = await fetch(base + '/api/v1/' + oldPath, {
        redirect: 'manual',
      });
      assert.equal(page.status, 302);
      assert.equal(page.headers.get('location'), nextPath);
    }
    assert.equal((await fetch(base + '/api/v1/dashboard')).status, 401);
    assert.deepEqual(
      await (
        await fetch(base + '/api/v1/dashboard?ownerId=' + adminId, {
          headers: ownerHeaders,
        })
      ).json(),
      { scope: ownerId },
    );
    for (const path of [
      'admin/client.js',
      'admin/schema.js',
      'dashboard/client.js',
      'dashboard/style.css',
    ])
      assert.equal(
        (await fetch(base + '/api/v1/' + path, { headers: ownerHeaders }))
          .status,
        404,
      );
    for (const resource of ['products', 'posts']) {
      const denied = await fetch(base + '/api/v1/admin/' + resource, {
        method: 'POST',
        headers: {
          Cookie: 'matjary_session=admin',
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      assert.equal(denied.status, 404);
    }
    // Store creation exists for administrators but still validates its body.
    assert.equal(
      (
        await fetch(base + '/api/v1/admin/stores', {
          method: 'POST',
          headers: {
            Cookie: 'matjary_session=admin',
            Origin: 'http://localhost:3000',
            'Content-Type': 'application/json',
          },
          body: '{}',
        })
      ).status,
      400,
    );
    assert.equal(
      (await patch({ displayName: 'Changed' }, 'owner')).status,
      403,
    );
    assert.equal(
      (await patch({ displayName: 'Changed' }, 'admin', 'https://evil.test'))
        .status,
      403,
    );
    assert.equal(
      (await patch({ displayName: 'Changed', isAdmin: true })).status,
      400,
    );
    assert.equal((await patch({ displayName: 'x'.repeat(20000) })).status, 413);
    assert.equal((await patch({ displayName: 'Changed' })).status, 200);
    assert.deepEqual(calls, ['update']);
    const changeRole = (body: unknown, token = 'admin') =>
      fetch(base + '/api/v1/admin/users/' + ownerId + '/role', {
        method: 'PATCH',
        headers: {
          Cookie: 'matjary_session=' + token,
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await changeRole({ role: 'admin', reason: 'Add helper' }, 'owner'))
        .status,
      403,
    );
    assert.equal(
      (await changeRole({ role: 'superadmin', reason: 'Add helper' })).status,
      400,
    );
    assert.equal(
      (await changeRole({ role: null, reason: 'Add helper' })).status,
      400,
    );
    assert.equal((await changeRole({ role: 'admin' })).status, 400);
    const promoted = await changeRole({ role: 'admin', reason: 'Add helper' });
    assert.equal(promoted.status, 200);
    assert.deepEqual(await promoted.json(), { id: ownerId, role: 'admin' });
    const failed = await patch({ displayName: 'explode' });
    assert.equal(failed.status, 500);
    const failureText = await failed.text();
    assert.doesNotMatch(
      failureText,
      /synthetic-cookie-secret|database-password|attacker-supplied-secret/,
    );
    assert.match(failed.headers.get('x-request-id')!, /^[0-9a-f-]{36}$/);
    assert.equal(
      JSON.parse(failureText).requestId,
      failed.headers.get('x-request-id'),
    );
    for (const [cookie, expected] of [
      ['', 401],
      ['matjary_session=owner', 403],
      ['matjary_session=admin', 200],
    ] as const) {
      assert.equal(
        (
          await fetch(base + '/api/v1/admin/monitoring/health', {
            headers: { Cookie: cookie },
          })
        ).status,
        expected,
      );
    }
    assert.equal((await fetch(base + '/api/v1/internal/metrics')).status, 404);
    assert.equal(
      (
        await fetch(base + '/api/v1/admin/monitoring/vps?query=arbitrary', {
          headers: { Cookie: 'matjary_session=admin' },
        })
      ).status,
      400,
    );
  } finally {
    await app.close();
  }
});
