import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminOperations1793572800000 implements MigrationInterface {
  name = 'AdminOperations1793572800000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE `users` ADD `suspended_at` datetime(6) NULL',
    );
    await runner.query(
      'ALTER TABLE `users` ADD `session_version` int unsigned NOT NULL DEFAULT 0',
    );
    for (const table of ['stores', 'products', 'showcases', 'media_assets']) {
      await runner.query(
        `ALTER TABLE \`${table}\` ADD \`admin_archived_at\` datetime(6) NULL`,
      );
      await runner.query(
        `CREATE INDEX \`idx_${table}_admin_archive\` ON \`${table}\` (\`admin_archived_at\`)`,
      );
    }
    await runner.query(`CREATE TABLE \`admin_audit_log\` (
      \`id\` varchar(36) NOT NULL,
      \`actor_id\` varchar(36) NOT NULL,
      \`action\` varchar(80) NOT NULL,
      \`resource\` varchar(40) NOT NULL,
      \`resource_id\` varchar(100) NOT NULL,
      \`request_id\` varchar(36) NOT NULL,
      \`reason\` varchar(500) NULL,
      \`changed_fields\` json NOT NULL,
      \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_admin_audit_created\` (\`created_at\`, \`id\`),
      INDEX \`idx_admin_audit_resource\` (\`resource\`, \`resource_id\`, \`created_at\`)
    ) ENGINE=InnoDB`);
    await runner.query(`CREATE TABLE \`system_errors\` (
      \`id\` varchar(36) NOT NULL,
      \`fingerprint\` varchar(64) NOT NULL,
      \`service\` varchar(16) NOT NULL,
      \`operation\` varchar(100) NOT NULL,
      \`code\` varchar(40) NOT NULL,
      \`severity\` varchar(16) NOT NULL,
      \`state\` enum('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
      \`occurrences\` bigint unsigned NOT NULL DEFAULT 1,
      \`request_ids\` json NOT NULL,
      \`first_seen_at\` datetime(6) NOT NULL,
      \`last_seen_at\` datetime(6) NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`uq_system_errors_fingerprint\` (\`fingerprint\`),
      INDEX \`idx_system_errors_seen\` (\`last_seen_at\`, \`id\`)
    ) ENGINE=InnoDB`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE `system_errors`');
    await runner.query('DROP TABLE `admin_audit_log`');
    for (const table of ['media_assets', 'showcases', 'products', 'stores']) {
      await runner.query(
        `DROP INDEX \`idx_${table}_admin_archive\` ON \`${table}\``,
      );
      await runner.query(
        `ALTER TABLE \`${table}\` DROP COLUMN \`admin_archived_at\``,
      );
    }
    await runner.query('ALTER TABLE `users` DROP COLUMN `session_version`');
    await runner.query('ALTER TABLE `users` DROP COLUMN `suspended_at`');
  }
}
