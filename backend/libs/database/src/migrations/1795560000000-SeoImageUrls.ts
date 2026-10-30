import type { MigrationInterface, QueryRunner } from 'typeorm';

// Sharing images and organization logos used to be storage keys only, so an
// administrator could not reuse the website logo (a public path or an external
// HTTPS file). URL columns let SEO point at the same image the branding page
// uses while the legacy key columns keep working for existing rows.
export class SeoImageUrls1795560000000 implements MigrationInterface {
  name = 'SeoImageUrls1795560000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE \`seo_settings\`
      ADD \`default_og_image_url\` VARCHAR(512) NULL AFTER \`default_og_image_key\`,
      ADD \`organization_logo_url\` VARCHAR(512) NULL AFTER \`organization_logo_key\``);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE \`seo_settings\`
      DROP COLUMN \`organization_logo_url\`,
      DROP COLUMN \`default_og_image_url\``);
  }
}
