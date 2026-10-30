import type { MigrationInterface, QueryRunner } from 'typeorm';

// Administrators can now be limited to specific shops. Existing administrators
// keep global reach (`all`), and the assignment table only records the shops a
// `stores`-scoped administrator may oversee.
export class AdminStoreScopes1795732800000 implements MigrationInterface {
  name = 'AdminStoreScopes1795732800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `users` ADD `admin_scope` enum('all','stores') NOT NULL DEFAULT 'all'",
    );
    await queryRunner.query(`
      CREATE TABLE admin_store_assignments (
        id varchar(36) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        user_id varchar(36) NOT NULL,
        store_id varchar(36) NOT NULL,
        UNIQUE INDEX uq_admin_store_assignments_user_store (user_id, store_id),
        INDEX idx_admin_store_assignments_store (store_id),
        PRIMARY KEY (id),
        CONSTRAINT fk_admin_store_assignments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT fk_admin_store_assignments_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE admin_store_assignments');
    await queryRunner.query('ALTER TABLE `users` DROP COLUMN `admin_scope`');
  }
}
