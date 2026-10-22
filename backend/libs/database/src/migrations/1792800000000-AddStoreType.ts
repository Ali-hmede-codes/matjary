import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStoreType1792800000000 implements MigrationInterface {
  name = 'AddStoreType1792800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE stores
        ADD COLUMN store_type enum('ecommerce','restaurant_menu') NOT NULL DEFAULT 'ecommerce' AFTER subscription_expires_at
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE stores
        DROP COLUMN store_type
    `);
  }
}
