import type { MigrationInterface, QueryRunner } from 'typeorm';

// Display-only Lebanese pound pricing: the platform sets one USD -> LBP rate
// and each shop chooses whether its public prices also appear in LBP. Stored
// prices and cart arithmetic stay in USD cents, so these columns only affect
// what shoppers read, never what they are charged.
export class LbpPriceDisplay1794868800000 implements MigrationInterface {
  name = 'LbpPriceDisplay1794868800000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE \`website_settings\`
        ADD COLUMN \`lbp_exchange_rate\` INT UNSIGNED NOT NULL DEFAULT 0 AFTER \`footer_text\`
    `);
    await runner.query(`
      ALTER TABLE \`stores\`
        ADD COLUMN \`show_prices_in_lbp\` TINYINT(1) NOT NULL DEFAULT 0 AFTER \`enable_whatsapp_checkout\`
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE `stores` DROP COLUMN `show_prices_in_lbp`');
    await runner.query(
      'ALTER TABLE `website_settings` DROP COLUMN `lbp_exchange_rate`',
    );
  }
}
