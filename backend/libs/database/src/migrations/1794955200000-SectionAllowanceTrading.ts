import type { MigrationInterface, QueryRunner } from 'typeorm';

// Owners can turn a content section off instead of leaving plan allowance
// unused. A turned-off section keeps its rows (and stays editable), but the
// storefront hides it and no new content can be created there; the unused
// allowance moves to the section that stays on. Both sections start on, so
// existing shops keep their current storefront.
export class SectionAllowanceTrading1794955200000 implements MigrationInterface {
  name = 'SectionAllowanceTrading1794955200000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE \`stores\`
        ADD COLUMN \`enable_posts_section\` TINYINT(1) NOT NULL DEFAULT 1 AFTER \`show_prices_in_lbp\`
    `);
    await runner.query(`
      ALTER TABLE \`stores\`
        ADD COLUMN \`enable_products_section\` TINYINT(1) NOT NULL DEFAULT 1 AFTER \`enable_posts_section\`
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE \`stores\`
        DROP COLUMN \`enable_products_section\`,
        DROP COLUMN \`enable_posts_section\`
    `);
  }
}
