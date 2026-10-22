import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVerificationBadge1792657536000 implements MigrationInterface {
  name = 'AddVerificationBadge1792657536000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add verification badge fields to stores table
    await queryRunner.query(`
      ALTER TABLE \`stores\`
        ADD COLUMN \`has_verification_badge\` BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Whether the store has a verification badge',
        ADD COLUMN \`verification_badge_granted_at\` DATETIME(6) NULL COMMENT 'When the badge was granted',
        ADD COLUMN \`verification_badge_granted_by\` VARCHAR(36) NULL COMMENT 'Admin user ID who granted the badge',
        ADD COLUMN \`verification_badge_expires_at\` DATETIME(6) NULL COMMENT 'Optional badge expiration date';
    `);

    // Add index for verification badge queries
    await queryRunner.query(`
      CREATE INDEX \`idx_stores_verification_badge\` ON \`stores\` (\`has_verification_badge\`);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`idx_stores_verification_badge\` ON \`stores\``,
    );

    await queryRunner.query(`
      ALTER TABLE \`stores\`
        DROP COLUMN \`verification_badge_expires_at\`,
        DROP COLUMN \`verification_badge_granted_by\`,
        DROP COLUMN \`verification_badge_granted_at\`,
        DROP COLUMN \`has_verification_badge\`;
    `);
  }
}
