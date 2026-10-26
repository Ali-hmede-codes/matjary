import type { MigrationInterface, QueryRunner } from 'typeorm';

// Shops gain a public business taxonomy that powers feed facets and the light
// category-affinity ranking. Existing rows are mapped immediately so no shop
// drops out of the browse filters after deploy.
export class AddBusinessCategory1794523200000 implements MigrationInterface {
  name = 'AddBusinessCategory1794523200000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE \`stores\`
        ADD COLUMN \`business_category\` VARCHAR(64) NOT NULL DEFAULT 'other' AFTER \`store_type\`
    `);
    await runner.query(
      'CREATE INDEX `idx_stores_business_category` ON `stores` (`business_category`)',
    );
    await runner.query(`
      UPDATE \`stores\`
      SET \`business_category\` = CASE
        WHEN \`store_type\` = 'restaurant_menu' THEN 'restaurants'
        ELSE 'retail_store'
      END
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX `idx_stores_business_category` ON `stores`');
    await runner.query('ALTER TABLE `stores` DROP COLUMN `business_category`');
  }
}
