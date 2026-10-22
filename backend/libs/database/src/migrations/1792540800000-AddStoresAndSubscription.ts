import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStoresAndSubscription1792540800000 implements MigrationInterface {
  name = 'AddStoresAndSubscription1792540800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE stores (
        id varchar(36) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        name varchar(200) NOT NULL,
        slug varchar(191) NOT NULL,
        owner_id varchar(36) NOT NULL,
        subscription_tier enum('free','basic','premium') NOT NULL DEFAULT 'free',
        subscription_expires_at datetime(6) NULL,
        posts_count_this_month int NOT NULL DEFAULT 0,
        UNIQUE INDEX uq_stores_slug (slug),
        INDEX idx_stores_owner (owner_id),
        PRIMARY KEY (id),
        CONSTRAINT fk_stores_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      ALTER TABLE showcases
        ADD store_id varchar(36) NULL,
        ADD INDEX idx_showcases_store (store_id),
        ADD CONSTRAINT fk_showcases_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE showcases
        DROP FOREIGN KEY fk_showcases_store,
        DROP INDEX idx_showcases_store,
        DROP COLUMN store_id
    `);
    await queryRunner.query('DROP TABLE stores');
  }
}
