import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WebsiteSettings1793659200000 implements MigrationInterface {
  name = 'WebsiteSettings1793659200000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE \`website_settings\` (
      \`id\` tinyint unsigned NOT NULL,
      \`site_name\` varchar(100) NOT NULL DEFAULT 'Matjary',
      \`tagline\` varchar(200) NULL,
      \`description\` varchar(1000) NULL,
      \`primary_color\` varchar(7) NOT NULL DEFAULT '#254e40',
      \`secondary_color\` varchar(7) NOT NULL DEFAULT '#d9a441',
      \`background_color\` varchar(7) NOT NULL DEFAULT '#ffffff',
      \`text_color\` varchar(7) NOT NULL DEFAULT '#17231e',
      \`logo_url\` varchar(2048) NULL,
      \`favicon_url\` varchar(2048) NULL,
      \`banner_url\` varchar(2048) NULL,
      \`contact_email\` varchar(254) NULL,
      \`footer_text\` varchar(500) NULL,
      \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (\`id\`),
      CONSTRAINT \`chk_website_settings_singleton\` CHECK (\`id\` = 1)
    ) ENGINE=InnoDB`);
    // Seed once so simultaneous administrators can lock the same existing row.
    await runner.query('INSERT INTO `website_settings` (`id`) VALUES (1)');
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE `website_settings`');
  }
}
