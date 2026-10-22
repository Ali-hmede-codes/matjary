import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceIndexesAndDenormalizedCounters1793145600000 implements MigrationInterface {
  name = 'AddPerformanceIndexesAndDenormalizedCounters1793145600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add denormalized counter columns to showcases table
    await queryRunner.query(`
      ALTER TABLE \`showcases\`
      ADD COLUMN \`media_count\` INT UNSIGNED NOT NULL DEFAULT 0,
      ADD COLUMN \`likes_count\` INT UNSIGNED NOT NULL DEFAULT 0,
      ADD COLUMN \`views_count\` INT UNSIGNED NOT NULL DEFAULT 0
    `);

    // Composite index for user dashboard pagination (owner + status + createdAt)
    await queryRunner.query(`
      CREATE INDEX \`idx_showcases_owner_status_created\` ON \`showcases\` (\`owner_id\`, \`status\`, \`created_at\`)
    `);

    // Composite index for store posts listing (store + createdAt)
    await queryRunner.query(`
      CREATE INDEX \`idx_showcases_store_created\` ON \`showcases\` (\`store_id\`, \`created_at\`)
    `);

    // Composite index for products by store with status
    await queryRunner.query(`
      CREATE INDEX \`idx_products_store_status_created\` ON \`products\` (\`store_id\`, \`status\`, \`created_at\`)
    `);

    // Index for media assets by showcase (already has showcase_id FK, but explicit for clarity)
    await queryRunner.query(`
      CREATE INDEX \`idx_media_assets_showcase_kind\` ON \`media_assets\` (\`showcase_id\`, \`kind\`)
    `);

    // Backfill denormalized counters from existing data
    // media_count
    await queryRunner.query(`
      UPDATE \`showcases\` s
      SET \`media_count\` = (
        SELECT COUNT(*) FROM \`media_assets\` ma WHERE ma.\`showcase_id\` = s.\`id\`
      )
    `);

    // likes_count from post_engagements
    await queryRunner.query(`
      UPDATE \`showcases\` s
      SET \`likes_count\` = (
        SELECT COALESCE(pe.\`likes_count\`, 0) FROM \`post_engagements\` pe WHERE pe.\`post_id\` = s.\`id\`
      )
    `);

    // views_count from post_engagements
    await queryRunner.query(`
      UPDATE \`showcases\` s
      SET \`views_count\` = (
        SELECT COALESCE(pe.\`views_count\`, 0) FROM \`post_engagements\` pe WHERE pe.\`post_id\` = s.\`id\`
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(
      `DROP INDEX \`idx_media_assets_showcase_kind\` ON \`media_assets\``,
    );
    await queryRunner.query(
      `DROP INDEX \`idx_products_store_status_created\` ON \`products\``,
    );
    await queryRunner.query(
      `DROP INDEX \`idx_showcases_store_created\` ON \`showcases\``,
    );
    await queryRunner.query(
      `DROP INDEX \`idx_showcases_owner_status_created\` ON \`showcases\``,
    );

    // Drop denormalized columns
    await queryRunner.query(`
      ALTER TABLE \`showcases\`
      DROP COLUMN \`views_count\`,
      DROP COLUMN \`likes_count\`,
      DROP COLUMN \`media_count\`
    `);
  }
}
