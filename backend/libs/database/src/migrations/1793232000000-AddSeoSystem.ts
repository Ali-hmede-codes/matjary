import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSeoSystem1793232000000 implements MigrationInterface {
  name = 'AddSeoSystem1793232000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create store_seo table with GEO/AI fields
    await queryRunner.query(`
      CREATE TABLE \`store_seo\` (
        \`id\` VARCHAR(36) NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`store_id\` VARCHAR(36) NOT NULL,
        \`meta_title\` VARCHAR(120) NULL,
        \`meta_description\` VARCHAR(320) NULL,
        \`meta_keywords\` VARCHAR(500) NULL,
        \`og_title\` VARCHAR(120) NULL,
        \`og_description\` VARCHAR(320) NULL,
        \`og_image_key\` VARCHAR(512) COLLATE utf8mb4_bin NULL,
        \`og_type\` VARCHAR(50) NOT NULL DEFAULT 'website',
        \`og_site_name\` VARCHAR(100) NULL,
        \`twitter_card\` VARCHAR(50) NOT NULL DEFAULT 'summary_large_image',
        \`twitter_site\` VARCHAR(100) NULL,
        \`twitter_creator\` VARCHAR(100) NULL,
        \`robots\` ENUM('index, follow', 'index, nofollow', 'noindex, follow', 'noindex, nofollow') NOT NULL DEFAULT 'index, follow',
        \`ai_robots\` ENUM('allow', 'disallow', 'training-allow', 'training-disallow') NULL DEFAULT 'allow',
        \`ai_training\` ENUM('allow', 'disallow', 'training-allow', 'training-disallow') NULL DEFAULT 'training-disallow',
        \`canonical_url\` VARCHAR(1000) NULL,
        \`structured_data\` JSON NULL,
        \`hreflang\` JSON NULL,
        \`auto_generated_fields\` JSON NULL,
        \`content_hash\` VARCHAR(64) NULL,
        \`last_auto_generated_at\` DATETIME(6) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_store_seo_store\` (\`store_id\`),
        CONSTRAINT \`fk_store_seo_store\` FOREIGN KEY (\`store_id\`) REFERENCES \`stores\` (\`id\`) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // Create product_seo table with GEO/AI fields
    await queryRunner.query(`
      CREATE TABLE \`product_seo\` (
        \`id\` VARCHAR(36) NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`product_id\` VARCHAR(36) NOT NULL,
        \`store_id\` VARCHAR(36) NOT NULL,
        \`meta_title\` VARCHAR(120) NULL,
        \`meta_description\` VARCHAR(320) NULL,
        \`meta_keywords\` VARCHAR(500) NULL,
        \`og_title\` VARCHAR(120) NULL,
        \`og_description\` VARCHAR(320) NULL,
        \`og_image_key\` VARCHAR(512) COLLATE utf8mb4_bin NULL,
        \`og_type\` VARCHAR(50) NOT NULL DEFAULT 'product',
        \`twitter_card\` VARCHAR(50) NOT NULL DEFAULT 'summary_large_image',
        \`robots\` ENUM('index, follow', 'index, nofollow', 'noindex, follow', 'noindex, nofollow') NOT NULL DEFAULT 'index, follow',
        \`ai_robots\` ENUM('allow', 'disallow', 'training-allow', 'training-disallow') NULL DEFAULT 'allow',
        \`ai_training\` ENUM('allow', 'disallow', 'training-allow', 'training-disallow') NULL DEFAULT 'training-disallow',
        \`canonical_url\` VARCHAR(1000) NULL,
        \`structured_data\` JSON NULL,
        \`gtin\` VARCHAR(100) NULL,
        \`mpn\` VARCHAR(100) NULL,
        \`brand\` VARCHAR(100) NULL,
        \`sku\` VARCHAR(100) NULL,
        \`auto_generated_fields\` JSON NULL,
        \`content_hash\` VARCHAR(64) NULL,
        \`last_auto_generated_at\` DATETIME(6) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_product_seo_product\` (\`product_id\`),
        INDEX \`idx_product_seo_store\` (\`store_id\`),
        CONSTRAINT \`fk_product_seo_product\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_product_seo_store\` FOREIGN KEY (\`store_id\`) REFERENCES \`stores\` (\`id\`) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // Create showcase_seo table with GEO/AI fields
    await queryRunner.query(`
      CREATE TABLE \`showcase_seo\` (
        \`id\` VARCHAR(36) NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`showcase_id\` VARCHAR(36) NOT NULL,
        \`store_id\` VARCHAR(36) NULL,
        \`meta_title\` VARCHAR(120) NULL,
        \`meta_description\` VARCHAR(320) NULL,
        \`meta_keywords\` VARCHAR(500) NULL,
        \`og_title\` VARCHAR(120) NULL,
        \`og_description\` VARCHAR(320) NULL,
        \`og_image_key\` VARCHAR(512) COLLATE utf8mb4_bin NULL,
        \`og_type\` VARCHAR(50) NOT NULL DEFAULT 'article',
        \`twitter_card\` VARCHAR(50) NOT NULL DEFAULT 'summary_large_image',
        \`robots\` ENUM('index, follow', 'index, nofollow', 'noindex, follow', 'noindex, nofollow') NOT NULL DEFAULT 'index, follow',
        \`ai_robots\` ENUM('allow', 'disallow', 'training-allow', 'training-disallow') NULL DEFAULT 'allow',
        \`ai_training\` ENUM('allow', 'disallow', 'training-allow', 'training-disallow') NULL DEFAULT 'training-disallow',
        \`canonical_url\` VARCHAR(1000) NULL,
        \`structured_data\` JSON NULL,
        \`article_author\` VARCHAR(100) NULL,
        \`article_published_time\` DATETIME(6) NULL,
        \`article_modified_time\` DATETIME(6) NULL,
        \`article_section\` VARCHAR(100) NULL,
        \`article_tags\` JSON NULL,
        \`auto_generated_fields\` JSON NULL,
        \`content_hash\` VARCHAR(64) NULL,
        \`last_auto_generated_at\` DATETIME(6) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_showcase_seo_showcase\` (\`showcase_id\`),
        INDEX \`idx_showcase_seo_store\` (\`store_id\`),
        CONSTRAINT \`fk_showcase_seo_showcase\` FOREIGN KEY (\`showcase_id\`) REFERENCES \`showcases\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_showcase_seo_store\` FOREIGN KEY (\`store_id\`) REFERENCES \`stores\` (\`id\`) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // Create seo_redirects table
    await queryRunner.query(`
      CREATE TABLE \`seo_redirects\` (
        \`id\` VARCHAR(36) NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`store_id\` VARCHAR(36) NULL,
        \`from_path\` VARCHAR(700) NOT NULL,
        \`to_path\` VARCHAR(1000) NOT NULL,
        \`status_code\` INT NOT NULL DEFAULT 301,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`idx_seo_redirects_from\` (\`from_path\`),
        INDEX \`idx_seo_redirects_store\` (\`store_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // Create seo_settings table with GEO/AI settings
    await queryRunner.query(`
      CREATE TABLE \`seo_settings\` (
        \`id\` VARCHAR(36) NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`site_name\` VARCHAR(100) NOT NULL DEFAULT 'Matjary',
        \`default_title\` VARCHAR(120) NULL,
        \`default_description\` VARCHAR(320) NULL,
        \`default_og_image_key\` VARCHAR(512) COLLATE utf8mb4_bin NULL,
        \`twitter_site\` VARCHAR(100) NULL,
        \`google_site_verification\` VARCHAR(255) NULL,
        \`bing_site_verification\` VARCHAR(255) NULL,
        \`yandex_site_verification\` VARCHAR(255) NULL,
        \`sitemap_enabled\` TINYINT(1) NOT NULL DEFAULT 1,
        \`sitemap_changefreq\` VARCHAR(20) NOT NULL DEFAULT 'daily',
        \`sitemap_priority\` DECIMAL(2,1) NOT NULL DEFAULT 0.8,
        \`robots_txt_custom\` TEXT NULL,
        \`organization_name\` VARCHAR(200) NULL,
        \`organization_url\` VARCHAR(500) NULL,
        \`organization_logo_key\` VARCHAR(512) COLLATE utf8mb4_bin NULL,
        \`organization_same_as\` JSON NULL,
        -- GEO / AI Optimization settings (2026)
        \`ai_crawlers_allowed\` TINYINT(1) NOT NULL DEFAULT 1,
        \`ai_training_allowed\` TINYINT(1) NOT NULL DEFAULT 0,
        \`ai_crawler_user_agents\` JSON NULL,
        \`llms_txt_enabled\` TINYINT(1) NOT NULL DEFAULT 1,
        \`llms_txt_content\` TEXT NULL,
        \`indexnow_enabled\` TINYINT(1) NOT NULL DEFAULT 0,
        \`indexnow_key\` VARCHAR(128) NULL,
        \`indexnow_key_location\` VARCHAR(512) NULL,
        \`speakable_enabled\` TINYINT(1) NOT NULL DEFAULT 1,
        \`speakable_css_selectors\` JSON NULL,
        \`faq_enabled\` TINYINT(1) NOT NULL DEFAULT 1,
        \`howto_enabled\` TINYINT(1) NOT NULL DEFAULT 1,
        \`freshness_threshold_days\` INT NOT NULL DEFAULT 30,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // Insert default SEO settings
    await queryRunner.query(`
      INSERT INTO \`seo_settings\` (\`id\`, \`site_name\`, \`default_title\`, \`default_description\`, \`sitemap_enabled\`, \`sitemap_changefreq\`, \`sitemap_priority\`) VALUES
      (UUID(), 'Matjary', 'Matjary - Your Showcase Platform', 'Discover amazing stores, products, and posts on Matjary', 1, 'daily', 0.8)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`seo_settings\``);
    await queryRunner.query(`DROP TABLE \`seo_redirects\``);
    await queryRunner.query(`DROP TABLE \`showcase_seo\``);
    await queryRunner.query(`DROP TABLE \`product_seo\``);
    await queryRunner.query(`DROP TABLE \`store_seo\``);
  }
}
