import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStoreBrandingAndProducts1792713600000 implements MigrationInterface {
  name = 'AddStoreBrandingAndProducts1792713600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns to stores table
    await queryRunner.query(`
      ALTER TABLE stores
        ADD COLUMN brand_color varchar(7) NULL AFTER slug,
        ADD COLUMN description text NULL AFTER brand_color,
        ADD COLUMN social_media_links json NULL AFTER description,
        ADD COLUMN logo_key varchar(512) NULL AFTER social_media_links,
        ADD COLUMN banner_key varchar(512) NULL AFTER logo_key
    `);

    // Create products table
    await queryRunner.query(`
      CREATE TABLE products (
        id varchar(36) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        store_id varchar(36) NOT NULL,
        slug varchar(191) NOT NULL,
        name varchar(200) NOT NULL,
        description text NULL,
        price_cents bigint UNSIGNED NOT NULL,
        currency varchar(3) NOT NULL DEFAULT 'USD',
        category enum('food','beverage','merchandise','service','other') NOT NULL DEFAULT 'other',
        status enum('draft','active','archived','out_of_stock') NOT NULL DEFAULT 'draft',
        sku varchar(100) NULL,
        stock_quantity int UNSIGNED NULL,
        weight_grams int UNSIGNED NULL,
        image_keys json NULL,
        tags json NULL,
        sort_order int UNSIGNED NOT NULL DEFAULT 0,
        requires_shipping boolean NOT NULL DEFAULT true,
        UNIQUE INDEX uq_products_slug (slug),
        INDEX idx_products_store (store_id),
        INDEX idx_products_status (status),
        INDEX idx_products_category (category),
        PRIMARY KEY (id),
        CONSTRAINT fk_products_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE products');
    await queryRunner.query(`
      ALTER TABLE stores
        DROP COLUMN brand_color,
        DROP COLUMN description,
        DROP COLUMN social_media_links,
        DROP COLUMN logo_key,
        DROP COLUMN banner_key
    `);
  }
}
