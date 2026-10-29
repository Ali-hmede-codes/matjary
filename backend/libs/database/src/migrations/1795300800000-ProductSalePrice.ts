import type { MigrationInterface, QueryRunner } from 'typeorm';

// A sale is one optional "was" price beside the amount the shop already
// charges. Keeping it in a nullable column means every existing product stays
// exactly as it is, and cart/checkout arithmetic keeps reading price_cents.
export class ProductSalePrice1795300800000 implements MigrationInterface {
  name = 'ProductSalePrice1795300800000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE \`products\`
        ADD COLUMN \`compare_at_price_cents\` BIGINT UNSIGNED NULL AFTER \`price_cents\`
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE `products` DROP COLUMN `compare_at_price_cents`',
    );
  }
}
