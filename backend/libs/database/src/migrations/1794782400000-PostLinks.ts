import type { MigrationInterface, QueryRunner } from 'typeorm';

// Shoppable posts: a post can point at one of the shop's products or at one of
// its categories. Both columns are nullable, so existing posts stay untouched,
// and the foreign keys keep a link from outliving the row it points at.
export class PostLinks1794782400000 implements MigrationInterface {
  name = 'PostLinks1794782400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `showcases` ADD `linked_product_id` varchar(36) NULL',
    );
    await queryRunner.query(
      'ALTER TABLE `showcases` ADD `linked_category_id` varchar(36) NULL',
    );
    await queryRunner.query(
      'ALTER TABLE `showcases` ADD CONSTRAINT `fk_showcases_linked_product` FOREIGN KEY (`linked_product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    await queryRunner.query(
      'ALTER TABLE `showcases` ADD CONSTRAINT `fk_showcases_linked_category` FOREIGN KEY (`linked_category_id`) REFERENCES `store_categories`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `showcases` DROP FOREIGN KEY `fk_showcases_linked_category`',
    );
    await queryRunner.query(
      'ALTER TABLE `showcases` DROP FOREIGN KEY `fk_showcases_linked_product`',
    );
    await queryRunner.query(
      'ALTER TABLE `showcases` DROP COLUMN `linked_category_id`',
    );
    await queryRunner.query(
      'ALTER TABLE `showcases` DROP COLUMN `linked_product_id`',
    );
  }
}
