import type { MigrationInterface, QueryRunner } from 'typeorm';

// Shops (menus and ecommerce) get owner-defined categories, and plans gain two
// account-wide quotas: maxShops and maxCategories. Custom plans receive the
// same values they already inherit from FREE_LIMITS, so behavior only changes
// where an administrator deliberately edits a plan.
export class StoreCategoriesAndPlanQuotas1794264000000 implements MigrationInterface {
  name = 'StoreCategoriesAndPlanQuotas1794264000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE \`store_categories\` (
        \`id\` VARCHAR(36) NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`store_id\` VARCHAR(36) NOT NULL,
        \`name\` VARCHAR(100) NOT NULL,
        \`sort_order\` INT UNSIGNED NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_store_categories_store_name\` (\`store_id\`, \`name\`),
        INDEX \`idx_store_categories_store_sort\` (\`store_id\`, \`sort_order\`),
        CONSTRAINT \`fk_store_categories_store\` FOREIGN KEY (\`store_id\`) REFERENCES \`stores\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // Products keep the legacy enum for older rows and point at a shop category.
    await runner.query(`
      ALTER TABLE \`products\`
        ADD COLUMN \`category_id\` VARCHAR(36) NULL AFTER \`category\`,
        ADD INDEX \`idx_products_category_id\` (\`category_id\`),
        ADD CONSTRAINT \`fk_products_category\` FOREIGN KEY (\`category_id\`) REFERENCES \`store_categories\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
    `);

    await runner.query(`
      UPDATE \`subscription_plans\`
      SET \`limits\` = JSON_SET(
        \`limits\`,
        '$.maxShops',
        CASE \`slug\`
          WHEN 'free' THEN 1
          WHEN 'basic' THEN 5
          WHEN 'premium' THEN 10
          ELSE 1
        END
      )
    `);

    await runner.query(`
      UPDATE \`subscription_plans\`
      SET \`limits\` = JSON_SET(
        \`limits\`,
        '$.maxCategories',
        CASE \`slug\`
          WHEN 'free' THEN 10
          WHEN 'basic' THEN 40
          WHEN 'premium' THEN 100
          ELSE 10
        END
      )
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE `products` DROP FOREIGN KEY `fk_products_category`',
    );
    await runner.query(
      'ALTER TABLE `products` DROP INDEX `idx_products_category_id`, DROP COLUMN `category_id`',
    );
    await runner.query('DROP TABLE `store_categories`');
    await runner.query(`
      UPDATE \`subscription_plans\`
      SET \`limits\` = JSON_REMOVE(\`limits\`, '$.maxShops')
    `);
    await runner.query(`
      UPDATE \`subscription_plans\`
      SET \`limits\` = JSON_REMOVE(\`limits\`, '$.maxCategories')
    `);
  }
}
