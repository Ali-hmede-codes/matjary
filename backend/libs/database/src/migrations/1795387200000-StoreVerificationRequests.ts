import type { MigrationInterface, QueryRunner } from 'typeorm';

// Monthly verification badges: owners apply with their name and a Lebanese
// phone number, an administrator approves, and the paid month lives on the
// store's existing verification_badge_expires_at column. Requests keep their
// own history so pending work and rejected reasons stay visible.
export class StoreVerificationRequests1795387200000 implements MigrationInterface {
  name = 'StoreVerificationRequests1795387200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`store_verification_requests\` (
        \`id\` VARCHAR(36) NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`store_id\` VARCHAR(36) NOT NULL,
        \`owner_id\` VARCHAR(36) NOT NULL,
        \`applicant_name\` VARCHAR(120) NOT NULL,
        \`phone\` VARCHAR(20) NOT NULL,
        \`note\` TEXT NULL,
        \`status\` ENUM('pending', 'approved', 'rejected', 'withdrawn') NOT NULL DEFAULT 'pending',
        \`included_in_plan\` BOOLEAN NOT NULL DEFAULT FALSE,
        \`price_cents\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
        \`period_starts_at\` DATETIME(6) NULL,
        \`period_ends_at\` DATETIME(6) NULL,
        \`reviewed_by\` VARCHAR(36) NULL,
        \`reviewed_at\` DATETIME(6) NULL,
        \`review_note\` VARCHAR(500) NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_store_verification_requests_status\` (\`status\`, \`created_at\`),
        INDEX \`idx_store_verification_requests_store\` (\`store_id\`, \`created_at\`),
        INDEX \`idx_store_verification_requests_owner\` (\`owner_id\`, \`created_at\`),
        CONSTRAINT \`fk_store_verification_requests_store\` FOREIGN KEY (\`store_id\`) REFERENCES \`stores\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT \`fk_store_verification_requests_owner\` FOREIGN KEY (\`owner_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `store_verification_requests`');
  }
}
