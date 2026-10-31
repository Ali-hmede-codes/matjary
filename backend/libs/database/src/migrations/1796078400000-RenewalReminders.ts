import type { MigrationInterface, QueryRunner } from 'typeorm';

// Renewal reminders for the only two monthly events owners manage: a paid plan
// and an add-on verification badge. The decline columns record intent without
// shortening a paid period, and the notice table stores one reminder per target
// and due instant so the midnight sweep is idempotent.
export class RenewalReminders1796078400000 implements MigrationInterface {
  name = 'RenewalReminders1796078400000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE \`user_subscriptions\`
        ADD COLUMN \`renewal_declined_at\` DATETIME(6) NULL AFTER \`expires_at\`
    `);
    await runner.query(`
      ALTER TABLE \`stores\`
        ADD COLUMN \`renewal_declined_at\` DATETIME(6) NULL AFTER \`verification_badge_expires_at\`
    `);
    await runner.query(
      'CREATE INDEX `idx_stores_verification_expiry` ON `stores` (`has_verification_badge`, `verification_badge_expires_at`)',
    );
    await runner.query(`
      CREATE TABLE \`renewal_notices\` (
        \`id\` VARCHAR(36) NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`user_id\` VARCHAR(36) NOT NULL,
        \`kind\` ENUM('subscription', 'verification') NOT NULL,
        \`subscription_id\` VARCHAR(36) NULL,
        \`store_id\` VARCHAR(36) NULL,
        \`due_at\` DATETIME(6) NOT NULL,
        \`seen_at\` DATETIME(6) NULL,
        \`dedupe_key\` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_renewal_notices_dedupe\` (\`dedupe_key\`),
        INDEX \`idx_renewal_notices_user\` (\`user_id\`, \`seen_at\`, \`created_at\`),
        INDEX \`idx_renewal_notices_subscription\` (\`subscription_id\`),
        INDEX \`idx_renewal_notices_store\` (\`store_id\`),
        INDEX \`idx_renewal_notices_due\` (\`due_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE `renewal_notices`');
    await runner.query(
      'DROP INDEX `idx_stores_verification_expiry` ON `stores`',
    );
    await runner.query(
      'ALTER TABLE `stores` DROP COLUMN `renewal_declined_at`',
    );
    await runner.query(
      'ALTER TABLE `user_subscriptions` DROP COLUMN `renewal_declined_at`',
    );
  }
}
