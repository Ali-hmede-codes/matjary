import type { MigrationInterface, QueryRunner } from 'typeorm';

// Category cards use a direct image link (PNG/JPG/WebP) instead of an upload:
// the owner pastes a URL and the storefront renders it with a privacy-preserving
// <img>. The column is nullable so every existing category keeps its current
// text-only row and falls back to the typographic card.
export class CategoryImageUrl1796251200000 implements MigrationInterface {
  name = 'CategoryImageUrl1796251200000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE \`store_categories\`
        ADD COLUMN \`image_url\` VARCHAR(2048) NULL
        COMMENT 'Owner-supplied direct image link; never fetched by the API'
        AFTER \`sort_order\`
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE `store_categories` DROP COLUMN `image_url`',
    );
  }
}
