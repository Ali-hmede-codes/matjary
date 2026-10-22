import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBoostSystem1793400000000 implements MigrationInterface {
  name = 'AddBoostSystem1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create boost_coins table for user balances
    await queryRunner.query(`
      CREATE TABLE \`boost_coins\` (
        \`user_id\` VARCHAR(36) NOT NULL COMMENT 'User ID',
        \`balance\` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Current boost coin balance',
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`user_id\`),
        CONSTRAINT \`fk_boost_coins_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='User boost coin balances';
    `);

    // Create boost_transactions table for audit trail
    await queryRunner.query(`
      CREATE TABLE \`boost_transactions\` (
        \`id\` VARCHAR(36) NOT NULL COMMENT 'Transaction UUID',
        \`user_id\` VARCHAR(36) NOT NULL COMMENT 'User ID',
        \`operation_id\` VARCHAR(100) COLLATE utf8mb4_bin NULL UNIQUE,
        \`type\` ENUM('purchase', 'admin_grant', 'admin_deduct', 'campaign_spend', 'refund', 'expired') NOT NULL COMMENT 'Transaction type',
        \`amount\` BIGINT NOT NULL COMMENT 'Coin amount (positive for credit, negative for debit)',
        \`balance_before\` BIGINT UNSIGNED NOT NULL COMMENT 'Balance before transaction',
        \`balance_after\` BIGINT UNSIGNED NOT NULL COMMENT 'Balance after transaction',
        \`reference_id\` VARCHAR(36) NULL COMMENT 'Reference ID (campaign ID, payment ID, etc.)',
        \`reference_type\` ENUM('campaign', 'payment', 'admin', 'system') NULL COMMENT 'Reference type',
        \`description\` VARCHAR(500) NULL COMMENT 'Transaction description',
        \`metadata\` JSON NULL COMMENT 'Additional metadata (payment details, admin notes, etc.)',
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_boost_transactions_user\` (\`user_id\`),
        INDEX \`idx_boost_transactions_reference\` (\`reference_id\`, \`reference_type\`),
        INDEX \`idx_boost_transactions_created\` (\`created_at\`),
        CONSTRAINT \`fk_boost_transactions_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Boost coin transaction history';
    `);

    // Create boost_campaigns table for ad campaigns
    await queryRunner.query(`
      CREATE TABLE \`boost_campaigns\` (
        \`id\` VARCHAR(36) NOT NULL COMMENT 'Campaign UUID',
        \`user_id\` VARCHAR(36) NOT NULL COMMENT 'Campaign owner (advertiser)',
        \`name\` VARCHAR(100) NOT NULL COMMENT 'Campaign name',
        \`target_type\` ENUM('showcase', 'store') NOT NULL COMMENT 'What is being boosted',
        \`target_store_id\` VARCHAR(36) NULL,
        \`target_showcase_id\` VARCHAR(36) NULL,
        CONSTRAINT \`chk_boost_target\` CHECK ((\`target_type\` = 'store' AND \`target_store_id\` IS NOT NULL AND \`target_showcase_id\` IS NULL) OR (\`target_type\` = 'showcase' AND \`target_showcase_id\` IS NOT NULL AND \`target_store_id\` IS NULL)),
        \`status\` ENUM('draft', 'pending_review', 'active', 'paused', 'completed', 'rejected', 'cancelled') NOT NULL DEFAULT 'draft' COMMENT 'Campaign status',
        \`budget_coins\` BIGINT UNSIGNED NOT NULL COMMENT 'Total budget in boost coins',
        \`spent_coins\` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Coins spent so far',
        \`daily_budget_coins\` BIGINT UNSIGNED NULL COMMENT 'Optional daily budget cap',
        \`bid_strategy\` ENUM('cpc', 'cpm', 'auto') NOT NULL DEFAULT 'auto' COMMENT 'Bidding strategy',
        \`bid_amount_coins\` BIGINT UNSIGNED NULL COMMENT 'Manual bid amount (for cpc/cpm)',
        \`targeting\` JSON NOT NULL COMMENT 'Targeting criteria (location, interests, demographics, etc.)',
        \`creative\` JSON NULL COMMENT 'Ad creative override (headline, description, CTA, media)',
        \`start_at\` DATETIME(6) NULL COMMENT 'Campaign start time',
        \`end_at\` DATETIME(6) NULL COMMENT 'Campaign end time',
        \`paused_at\` DATETIME(6) NULL COMMENT 'When paused by user',
        \`rejected_at\` DATETIME(6) NULL COMMENT 'When rejected by admin',
        \`rejection_reason\` VARCHAR(500) NULL COMMENT 'Reason for rejection',
        \`completed_at\` DATETIME(6) NULL COMMENT 'When completed (budget exhausted or time ended)',
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_boost_campaigns_user\` (\`user_id\`),
        INDEX \`idx_boost_campaigns_target\` (\`target_type\`, \`target_store_id\`, \`target_showcase_id\`),
        INDEX \`idx_boost_campaigns_status\` (\`status\`),
        INDEX \`idx_boost_campaigns_schedule\` (\`start_at\`, \`end_at\`),
        CONSTRAINT \`fk_boost_campaigns_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_boost_campaigns_showcase\` FOREIGN KEY (\`target_showcase_id\`) REFERENCES \`showcases\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_boost_campaigns_store\` FOREIGN KEY (\`target_store_id\`) REFERENCES \`stores\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Boost ad campaigns';
    `);

    // Create boost_campaign_performance table for daily stats
    await queryRunner.query(`
      CREATE TABLE \`boost_campaign_performance\` (
        \`campaign_id\` VARCHAR(36) NOT NULL COMMENT 'Campaign ID',
        \`date\` DATE NOT NULL COMMENT 'Stat date (UTC)',
        \`impressions\` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Ad impressions',
        \`clicks\` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Ad clicks',
        \`spend_coins\` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Coins spent this day',
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`campaign_id\`, \`date\`),
        INDEX \`idx_boost_performance_date\` (\`date\`),
        CONSTRAINT \`fk_boost_performance_campaign\` FOREIGN KEY (\`campaign_id\`) REFERENCES \`boost_campaigns\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Daily campaign performance metrics';
    `);

    // Create boost_settings table for admin-configurable settings
    await queryRunner.query(`
      CREATE TABLE \`boost_settings\` (
        \`key\` VARCHAR(100) NOT NULL COMMENT 'Setting key',
        \`value\` JSON NOT NULL COMMENT 'Setting value (JSON for flexibility)',
        \`description\` VARCHAR(500) NULL COMMENT 'Setting description',
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`updated_by\` VARCHAR(36) NULL COMMENT 'Admin user who last updated',
        PRIMARY KEY (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Boost system admin settings';
    `);

    // Insert default boost settings
    await queryRunner.query(`
      INSERT INTO \`boost_settings\` (\`key\`, \`value\`, \`description\`) VALUES
        ('coin_price_cents', '100', 'Price per boost coin in cents (e.g., 100 = $1.00 per coin)'),
        ('min_purchase_coins', '100', 'Minimum coins per purchase'),
        ('max_purchase_coins', '100000', 'Maximum coins per purchase'),
        ('default_daily_budget_coins', '1000', 'Default daily budget for new campaigns'),
        ('min_campaign_budget_coins', '100', 'Minimum campaign budget'),
        ('max_campaign_duration_days', '90', 'Maximum campaign duration in days'),
        ('campaign_review_required', 'true', 'Whether new campaigns require admin review'),
        ('auto_approve_threshold_coins', '1000', 'Auto-approve campaigns under this budget'),
        ('cpc_min_bid_coins', '1', 'Minimum CPC bid in coins'),
        ('cpm_min_bid_coins', '10', 'Minimum CPM bid in coins (per 1000 impressions)'),
        ('platform_fee_percent', '0', 'Platform fee percentage (0-100)');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`boost_settings\``);
    await queryRunner.query(`DROP TABLE \`boost_campaign_performance\``);
    await queryRunner.query(`DROP TABLE \`boost_campaigns\``);
    await queryRunner.query(`DROP TABLE \`boost_transactions\``);
    await queryRunner.query(`DROP TABLE \`boost_coins\``);
  }
}
