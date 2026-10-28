import type { MigrationInterface, QueryRunner } from 'typeorm';

// Shop stories: one photo or short video that expires 24 hours after it is
// published. The plan quota is a live count per shop, so plans gain maxStories
// (free 0, basic 2, premium 10). A future "pro" plan simply sets 5 in the admin
// panel; every other or older plan row stays without stories.
export class StoreStories1795041600000 implements MigrationInterface {
  name = 'StoreStories1795041600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`store_stories\` (
        \`id\` VARCHAR(36) NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`store_id\` VARCHAR(36) NOT NULL,
        \`owner_id\` VARCHAR(36) NOT NULL,
        \`media_asset_id\` VARCHAR(36) NOT NULL,
        \`linked_product_id\` VARCHAR(36) NULL,
        \`linked_category_id\` VARCHAR(36) NULL,
        \`expires_at\` DATETIME(6) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_store_stories_media\` (\`media_asset_id\`),
        INDEX \`idx_store_stories_store_expires\` (\`store_id\`, \`expires_at\`),
        INDEX \`idx_store_stories_expires\` (\`expires_at\`),
        INDEX \`idx_store_stories_owner\` (\`owner_id\`),
        CONSTRAINT \`fk_store_stories_store\` FOREIGN KEY (\`store_id\`) REFERENCES \`stores\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT \`fk_store_stories_owner\` FOREIGN KEY (\`owner_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT \`fk_store_stories_media\` FOREIGN KEY (\`media_asset_id\`) REFERENCES \`media_assets\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT \`fk_store_stories_product\` FOREIGN KEY (\`linked_product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT \`fk_store_stories_category\` FOREIGN KEY (\`linked_category_id\`) REFERENCES \`store_categories\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      UPDATE \`subscription_plans\`
      SET \`limits\` = JSON_SET(
        \`limits\`,
        '$.maxStories',
        CASE \`slug\`
          WHEN 'free' THEN 0
          WHEN 'basic' THEN 2
          WHEN 'premium' THEN 10
          ELSE 0
        END
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE \`subscription_plans\`
      SET \`limits\` = JSON_REMOVE(\`limits\`, '$.maxStories')
    `);
    await queryRunner.query('DROP TABLE `store_stories`');
  }
}
