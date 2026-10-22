import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCartAndCartItems1792886400000 implements MigrationInterface {
  name = 'AddCartAndCartItems1792886400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Create carts table
    await queryRunner.query(`
      CREATE TABLE carts (
        id varchar(36) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        user_id varchar(36) NULL,
        visitor_id varchar(255) NULL,
        store_id varchar(36) NOT NULL,
        currency varchar(3) NOT NULL DEFAULT 'USD',
        status enum('active','checked_out','abandoned','expired') NOT NULL DEFAULT 'active',
        customer_notes text NULL,
        expires_at datetime(6) NULL,
        INDEX idx_carts_user (user_id),
        INDEX idx_carts_visitor (visitor_id),
        INDEX idx_carts_store (store_id),
        INDEX idx_carts_status (status),
        PRIMARY KEY (id),
        CONSTRAINT fk_carts_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // Create cart_items table
    await queryRunner.query(`
      CREATE TABLE cart_items (
        id varchar(36) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        cart_id varchar(36) NOT NULL,
        product_id varchar(36) NOT NULL,
        quantity int UNSIGNED NOT NULL DEFAULT 1,
        unit_price_cents bigint UNSIGNED NOT NULL,
        product_name varchar(200) NOT NULL,
        product_slug varchar(191) NOT NULL,
        notes text NULL,
        INDEX idx_cart_items_cart (cart_id),
        INDEX idx_cart_items_product (product_id),
        PRIMARY KEY (id),
        CONSTRAINT fk_cart_items_cart FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT fk_cart_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE cart_items');
    await queryRunner.query('DROP TABLE carts');
  }
}
