import type { MigrationInterface, QueryRunner } from 'typeorm';

// Verification badges are sold monthly outside a plan bundle: a plan may bundle
// free slots, but owners whose plans have none (or whose slots are already
// used) need one platform-controlled price. This singleton also stores the
// number they call or message to pay.
export class VerificationSettings1795992000000 implements MigrationInterface {
  name = 'VerificationSettings1795992000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE \`verification_settings\` (
      \`id\` tinyint unsigned NOT NULL,
      \`badge_price_cents\` int unsigned NOT NULL DEFAULT 0,
      \`contact_phone\` varchar(20) NULL,
      \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (\`id\`),
      CONSTRAINT \`chk_verification_settings_singleton\` CHECK (\`id\` = 1)
    ) ENGINE=InnoDB`);
    // Seed once so simultaneous administrators lock the same existing row.
    await runner.query('INSERT INTO `verification_settings` (`id`) VALUES (1)');
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE `verification_settings`');
  }
}
