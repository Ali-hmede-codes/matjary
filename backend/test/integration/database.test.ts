import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { validateDatabaseEnvironment } from '../../libs/config/src/environment';
import { createDatabaseOptions } from '../../libs/database/src/database.options';
import { UsersService } from '../../apps/api/src/modules/users/users.service';
import { GoogleAuthentication1792454400000 } from '../../libs/database/src/migrations/1792454400000-GoogleAuthentication';
import {
  User,
  Showcase,
  ShowcaseStatus,
  MediaAsset,
  MediaKind,
  MediaStatus,
  MediaVariant,
} from '../../libs/database/src/entities';

// Run only against a dedicated, empty database granted to the configured user.
// Supply MYSQL_HOST/PORT/DATABASE/USER/PASSWORD explicitly; no .env is loaded.
// Set MYSQL_TEST_ALLOW_DDL=1 after provisioning an isolated empty *_test schema.
// This suite tests migration rollback; never point it at application data.
test('MySQL migrations and relational persistence', async (t) => {
  assert.equal(
    process.env.MYSQL_TEST_ALLOW_DDL,
    '1',
    'Explicit isolated DDL test opt-in required',
  );
  for (const key of [
    'MYSQL_HOST',
    'MYSQL_PORT',
    'MYSQL_DATABASE',
    'MYSQL_USER',
    'MYSQL_PASSWORD',
  ]) {
    assert.ok(
      process.env[key],
      `Supply ${key} explicitly for the isolated test database`,
    );
  }
  const source = new DataSource(
    createDatabaseOptions(validateDatabaseEnvironment(process.env)),
  );
  assert.match(
    String(source.options.database),
    /^[a-zA-Z0-9_]+_test$/,
    'Set MYSQL_DATABASE to a dedicated empty database ending in _test',
  );
  await source.initialize();
  try {
    // Check BEFORE the migration ledger or any application table is created.
    const tables = await source.query(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
    );
    assert.equal(
      tables.length,
      0,
      'Integration schema must contain no tables before any DDL',
    );
    assert.equal(
      (await source.runMigrations()).length,
      source.migrations.length,
    );
    const seeded = new Map<string, number>();
    for (const metadata of source.entityMetadatas) {
      seeded.set(
        metadata.tableName,
        await source.getRepository(metadata.target).count(),
      );
    }

    await t.test(
      'migrations are idempotent and match entity metadata',
      async () => {
        assert.deepEqual(await source.runMigrations(), []);
        assert.equal(await source.showMigrations(), false);
        const changes = await source.driver.createSchemaBuilder().log();
        assert.deepEqual(
          changes.upQueries.map((query) => query.query),
          [],
        );
      },
    );

    await t.test(
      'entities round-trip Unicode, BIGINT, defaults, and protected fields',
      async () => {
        const runner = source.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        try {
          const users = runner.manager.getRepository(User);
          const owner = await users.save(
            users.create({
              email: 'owner@example.test',
              displayName: 'متجري 🛍️',
              passwordHash: 'test-hash-not-a-login',
            }),
          );
          const loaded = await users.findOneByOrFail({ id: owner.id });
          assert.equal(loaded.displayName, owner.displayName);
          assert.equal(loaded.passwordHash, undefined);
          await assert.rejects(
            users.insert({
              email: 'OWNER@example.test',
              displayName: 'duplicate',
              passwordHash: 'test',
            }),
            /Duplicate entry/,
          );

          const showcases = runner.manager.getRepository(Showcase);
          const showcase = await showcases.save(
            showcases.create({
              ownerId: owner.id,
              slug: 'first-showcase',
              title: 'واجهة جميلة 🌟',
            }),
          );
          assert.equal(showcase.status, ShowcaseStatus.DRAFT);
          await assert.rejects(
            showcases.insert({
              ownerId: randomUUID(),
              slug: 'orphan',
              title: 'Invalid',
            }),
            /foreign key constraint fails/,
          );
          await assert.rejects(
            showcases.insert({
              ownerId: owner.id,
              slug: showcase.slug,
              title: 'Duplicate',
            }),
            /Duplicate entry/,
          );
          await assert.rejects(
            users.delete(owner.id),
            /foreign key constraint fails/,
          );

          const assets = runner.manager.getRepository(MediaAsset);
          const asset = await assets.save(
            assets.create({
              showcaseId: showcase.id,
              kind: MediaKind.IMAGE,
              originalKey: 'originals/Case.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: '9007199254740993',
            }),
          );
          assert.equal(asset.status, MediaStatus.PENDING);
          assert.equal(
            (await assets.findOneByOrFail({ id: asset.id })).sizeBytes,
            '9007199254740993',
          );
          // Object-storage keys are case-sensitive, unlike user emails.
          await assets.insert({
            showcaseId: showcase.id,
            kind: MediaKind.IMAGE,
            originalKey: 'originals/case.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: '1',
          });
          await assert.rejects(
            showcases.delete(showcase.id),
            /foreign key constraint fails/,
          );

          const variants = runner.manager.getRepository(MediaVariant);
          await variants.insert({
            assetId: asset.id,
            label: 'avif-480',
            storageKey: 'processed/480.avif',
            mimeType: 'image/avif',
            sizeBytes: '1024',
            width: 480,
            height: 320,
          });
          await assert.rejects(
            variants.insert({
              assetId: asset.id,
              label: 'avif-480',
              storageKey: 'processed/duplicate.avif',
              mimeType: 'image/avif',
              sizeBytes: '1024',
              width: 480,
              height: 320,
            }),
            /Duplicate entry/,
          );
          await assert.rejects(
            assets.delete(asset.id),
            /foreign key constraint fails/,
          );
        } finally {
          await runner.rollbackTransaction();
          await runner.release();
        }
      },
    );

    await t.test(
      'Google accounts persist without passwords and preserve identity',
      async () => {
        const runner = source.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        try {
          const repo = runner.manager.getRepository(User);
          const users = new UsersService(repo);
          const profile = {
            subject: 'google-integration-owner',
            email: 'google@example.test',
            name: 'متجري 🛍️',
          };
          const owner = await users.findOrCreateGoogleUser(profile);
          const again = await users.findOrCreateGoogleUser({
            ...profile,
            email: 'changed@example.test',
          });
          assert.equal(again.id, owner.id);
          assert.equal(await repo.count(), 1);
          const stored = await repo
            .createQueryBuilder('user')
            .addSelect(['user.passwordHash', 'user.googleSubject'])
            .where('user.id = :id', { id: owner.id })
            .getOneOrFail();
          assert.equal(stored.passwordHash, null);
          assert.equal(stored.googleSubject, profile.subject);
          assert.equal(stored.displayName, profile.name);
          assert.equal(
            (await repo.findOneByOrFail({ id: owner.id })).googleSubject,
            undefined,
          );
          await assert.rejects(
            users.findOrCreateGoogleUser({
              ...profile,
              subject: 'different-google-account',
            }),
            /Account linking is required/,
          );
          await assert.rejects(
            repo.insert({
              email: 'duplicate-subject@example.test',
              displayName: 'Duplicate',
              googleSubject: profile.subject,
            }),
            /Duplicate entry/,
          );
          await repo.save(
            repo.create({
              email: 'legacy@example.test',
              displayName: 'Legacy',
              passwordHash: 'preserved-hash',
            }),
          );
          await assert.rejects(
            users.findOrCreateGoogleUser({
              ...profile,
              subject: 'new-subject',
              email: 'legacy@example.test',
            }),
            /Account linking is required/,
          );
          await assert.rejects(
            new GoogleAuthentication1792454400000().down(runner),
            /Cannot revert/,
          );
        } finally {
          await runner.rollbackTransaction();
          await runner.release();
        }
      },
    );

    await t.test(
      'migrations can be reverted and reapplied on an empty schema',
      async () => {
        for (const metadata of source.entityMetadatas) {
          assert.equal(
            await source.getRepository(metadata.target).count(),
            seeded.get(metadata.tableName),
            `Unexpected test data in ${metadata.tableName}`,
          );
        }
        for (let index = 0; index < source.migrations.length; index++) {
          await source.undoLastMigration({ transaction: 'none' });
        }
        const runner = source.createQueryRunner();
        try {
          for (const metadata of source.entityMetadatas) {
            assert.equal(
              await runner.hasTable(metadata.tableName),
              false,
              metadata.tableName,
            );
          }
          assert.equal(
            (await runner.query('SELECT * FROM schema_migrations')).length,
            0,
          );
        } finally {
          await runner.release();
        }
        assert.equal(
          (await source.runMigrations()).length,
          source.migrations.length,
        );
        assert.equal(await source.showMigrations(), false);
        const drift = await source.driver.createSchemaBuilder().log();
        assert.deepEqual(
          drift.upQueries.map((query) => query.query),
          [],
        );
      },
    );
  } finally {
    await source.destroy();
  }
});
