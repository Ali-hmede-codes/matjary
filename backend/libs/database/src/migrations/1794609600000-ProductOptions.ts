import type { MigrationInterface, QueryRunner } from 'typeorm';

// Products gain owner-defined option groups (size, color, ...), and cart lines
// snapshot the shopper's choices. JSON keeps the small ordered lists together
// with their product without a second table and avoids rewriting cart history
// when an owner later edits an option.
export class ProductOptions1794609600000 implements MigrationInterface {
  name = 'ProductOptions1794609600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`products\`
        ADD COLUMN \`options\` JSON NULL
        COMMENT 'Owner-defined choices such as size or color' AFTER \`tags\`;
    `);
    await queryRunner.query(`
      ALTER TABLE \`cart_items\`
        ADD COLUMN \`selected_options\` JSON NULL
        COMMENT 'Chosen product options snapshotted per cart line' AFTER \`notes\`;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`cart_items\`
        DROP COLUMN \`selected_options\`;
    `);
    await queryRunner.query(`
      ALTER TABLE \`products\`
        DROP COLUMN \`options\`;
    `);
  }
}
