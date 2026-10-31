import type { MigrationInterface, QueryRunner } from 'typeorm';

// After the plan grace window ends the shop is locked (hidden from shoppers)
// and its media is moved into a byte-exact archive tier so the live volume is
// freed without losing anything. Renewal clears the lock and restores the
// files. The enum append is a metadata change; every other step is a single
// ALTER so a failed run leaves an inspectable, small delta.
export class SubscriptionLockLifecycle1796164800000 implements MigrationInterface {
  name = 'SubscriptionLockLifecycle1796164800000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE \`stores\`
        MODIFY \`status\` ENUM('active', 'offline', 'archived', 'trashed', 'locked')
          NOT NULL DEFAULT 'active'
    `);
    await runner.query(`
      ALTER TABLE \`stores\`
        ADD COLUMN \`subscription_locked_at\` DATETIME(6) NULL AFTER \`renewal_declined_at\`,
        ADD COLUMN \`renewal_requested_at\` DATETIME(6) NULL AFTER \`subscription_locked_at\`
    `);
    await runner.query(
      'CREATE INDEX `idx_stores_subscription_lock` ON `stores` (`subscription_locked_at`)',
    );
    await runner.query(`
      ALTER TABLE \`stores\`
        ADD COLUMN \`media_archive_state\`
          ENUM('none', 'pending', 'archived', 'restoring', 'failed')
          NOT NULL DEFAULT 'none' AFTER \`renewal_requested_at\`,
        ADD COLUMN \`media_archived_at\` DATETIME(6) NULL AFTER \`media_archive_state\`
    `);
    await runner.query(
      'CREATE INDEX `idx_stores_media_archive` ON `stores` (`media_archive_state`)',
    );
    await runner.query(`
      ALTER TABLE \`user_subscriptions\`
        ADD COLUMN \`renewal_requested_at\` DATETIME(6) NULL AFTER \`renewal_declined_at\`
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE `user_subscriptions` DROP COLUMN `renewal_requested_at`',
    );
    await runner.query('DROP INDEX `idx_stores_media_archive` ON `stores`');
    // The enum cannot lose a value that rows still hold.
    await runner.query(
      "UPDATE `stores` SET `status` = 'archived' WHERE `status` = 'locked'",
    );
    await runner.query(`
      ALTER TABLE \`stores\`
        DROP COLUMN \`media_archived_at\`,
        DROP COLUMN \`media_archive_state\`
    `);
    await runner.query('DROP INDEX `idx_stores_subscription_lock` ON `stores`');
    await runner.query(`
      ALTER TABLE \`stores\`
        DROP COLUMN \`renewal_requested_at\`,
        DROP COLUMN \`subscription_locked_at\`
    `);
    await runner.query(`
      ALTER TABLE \`stores\`
        MODIFY \`status\` ENUM('active', 'offline', 'archived', 'trashed')
          NOT NULL DEFAULT 'active'
    `);
  }
}
