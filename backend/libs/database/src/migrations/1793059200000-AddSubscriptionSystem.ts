import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionSystem1793059200000 implements MigrationInterface {
  name = 'AddSubscriptionSystem1793059200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create subscription_plans table
    await queryRunner.query(`
      CREATE TABLE \`subscription_plans\` (
        \`id\` CHAR(36) NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`name\` VARCHAR(100) NOT NULL,
        \`slug\` VARCHAR(100) NOT NULL,
        \`description\` TEXT NULL,
        \`price_cents\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
        \`currency\` VARCHAR(3) NOT NULL DEFAULT 'USD',
        \`billing_cycle\` ENUM('monthly', 'yearly', 'lifetime') NOT NULL DEFAULT 'monthly',
        \`limits\` JSON NOT NULL,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`sort_order\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`legacy_tier\` ENUM('free', 'basic', 'premium') NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_subscription_plans_slug\` (\`slug\`),
        INDEX \`idx_subscription_plans_active\` (\`is_active\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // Create user_subscriptions table
    await queryRunner.query(`
      CREATE TABLE \`user_subscriptions\` (
        \`id\` CHAR(36) NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`user_id\` CHAR(36) NOT NULL,
        \`plan_id\` CHAR(36) NOT NULL,
        \`status\` ENUM('active', 'expired', 'cancelled', 'pending') NOT NULL DEFAULT 'pending',
        \`starts_at\` DATETIME(6) NOT NULL,
        \`expires_at\` DATETIME(6) NULL,
        \`assigned_by\` CHAR(36) NULL,
        \`notes\` TEXT NULL,
        \`external_id\` VARCHAR(255) NULL,
        \`external_status\` VARCHAR(50) NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_user_subscriptions_user\` (\`user_id\`),
        INDEX \`idx_user_subscriptions_plan\` (\`plan_id\`),
        INDEX \`idx_user_subscriptions_status\` (\`status\`),
        INDEX \`idx_user_subscriptions_expires\` (\`expires_at\`),
        CONSTRAINT \`fk_user_subscriptions_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_user_subscriptions_plan\` FOREIGN KEY (\`plan_id\`) REFERENCES \`subscription_plans\` (\`id\`) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // Insert default subscription plans
    await queryRunner.query(`
      INSERT INTO \`subscription_plans\` (\`id\`, \`name\`, \`slug\`, \`description\`, \`price_cents\`, \`currency\`, \`billing_cycle\`, \`limits\`, \`is_active\`, \`sort_order\`, \`legacy_tier\`) VALUES
      (UUID(), 'Free', 'free', 'Free tier with basic features', 0, 'USD', 'monthly',
        '{"maxVideoDurationSeconds": 60, "maxVideoSizeBytes": 52428800, "maxVideoQuality": "720p", "maxImageCount": 10, "maxImageSizeBytes": 10485760, "maxImageWidth": 1920, "maxImageHeight": 1080, "maxPostsPerMonth": 5, "maxTotalPosts": 20, "maxProducts": 10, "maxStorageBytes": 1073741824, "enableCart": true, "enableWhatsAppCheckout": false, "enableAnalytics": false, "enableCustomDomain": false, "enablePrioritySupport": false}',
        1, 0, 'free'),
      (UUID(), 'Basic', 'basic', 'Basic plan for growing businesses', 999, 'USD', 'monthly',
        '{"maxVideoDurationSeconds": 300, "maxVideoSizeBytes": 209715200, "maxVideoQuality": "1080p", "maxImageCount": 50, "maxImageSizeBytes": 20971520, "maxImageWidth": 3840, "maxImageHeight": 2160, "maxPostsPerMonth": 30, "maxTotalPosts": 200, "maxProducts": 100, "maxStorageBytes": 10737418240, "enableCart": true, "enableWhatsAppCheckout": true, "enableAnalytics": true, "enableCustomDomain": false, "enablePrioritySupport": false}',
        1, 1, 'basic'),
      (UUID(), 'Premium', 'premium', 'Premium plan for established businesses', 2999, 'USD', 'monthly',
        '{"maxVideoDurationSeconds": 1800, "maxVideoSizeBytes": 1073741824, "maxVideoQuality": "4k", "maxImageCount": 200, "maxImageSizeBytes": 52428800, "maxImageWidth": 7680, "maxImageHeight": 4320, "maxPostsPerMonth": 100, "maxTotalPosts": 1000, "maxProducts": null, "maxStorageBytes": 107374182400, "enableCart": true, "enableWhatsAppCheckout": true, "enableAnalytics": true, "enableCustomDomain": true, "enablePrioritySupport": true}',
        1, 2, 'premium');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`user_subscriptions\``);
    await queryRunner.query(`DROP TABLE \`subscription_plans\``);
  }
}
