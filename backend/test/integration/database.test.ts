import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import source from '../../libs/database/src/data-source';
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
// Example in PowerShell: $env:MYSQL_DATABASE='matjary_test'; npm run test:integration
// This suite tests migration rollback; never point it at application data.
test('MySQL migrations and relational persistence', async (t) => {
  assert.match(
    String(source.options.database),
    /^[a-zA-Z0-9_]+_test$/,
    'Set MYSQL_DATABASE to a dedicated empty database ending in _test',
  );
  await source.initialize();
  try {
    await source.runMigrations();
    for (const target of [User, Showcase, MediaAsset, MediaVariant]) {
      assert.equal(
        await source.getRepository(target).count(),
        0,
        'Integration database must be empty',
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
        for (const target of [User, Showcase, MediaAsset, MediaVariant]) {
          assert.equal(await source.getRepository(target).count(), 0);
        }
        await source.undoLastMigration();
        await source.undoLastMigration();
        const runner = source.createQueryRunner();
        try {
          for (const table of [
            'users',
            'showcases',
            'media_assets',
            'media_variants',
          ]) {
            assert.equal(await runner.hasTable(table), false);
          }
        } finally {
          await runner.release();
        }
        assert.equal((await source.runMigrations()).length, 2);
        assert.equal(await source.showMigrations(), false);
      },
    );
  } finally {
    await source.destroy();
  }
});
