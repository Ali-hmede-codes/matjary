import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStoreFeatureFlagsAndDesignSettings1792972800000 implements MigrationInterface {
  name = 'AddStoreFeatureFlagsAndDesignSettings1792972800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add feature flags
    await queryRunner.query(`
      ALTER TABLE \`stores\`
      ADD COLUMN \`enable_cart\` TINYINT(1) NOT NULL DEFAULT 1,
      ADD COLUMN \`enable_whatsapp_checkout\` TINYINT(1) NOT NULL DEFAULT 1,
      ADD COLUMN \`design_settings\` JSON NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`stores\`
      DROP COLUMN \`enable_cart\`,
      DROP COLUMN \`enable_whatsapp_checkout\`,
      DROP COLUMN \`design_settings\`
    `);
  }
}
