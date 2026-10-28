import type { MigrationInterface, QueryRunner } from 'typeorm';

// The original media parent check predates stories: it only allowed post,
// store_logo, store_banner and product_image rows. A story asset is shop-scoped
// like branding but may also be a video, so the constraint must accept it or the
// insert fails with ER_CHECK_CONSTRAINT_VIOLATED (surfaced as a 503).
export class StoryMediaPurpose1795128000000 implements MigrationInterface {
  name = 'StoryMediaPurpose1795128000000';

  async up(runner: QueryRunner): Promise<void> {
    // Separate statements: MySQL DDL is non-transactional and drops first.
    await runner.query(
      'ALTER TABLE `media_assets` DROP CHECK `chk_media_parent`',
    );
    await runner.query(`
      ALTER TABLE \`media_assets\`
        ADD CONSTRAINT \`chk_media_parent\` CHECK (
          (purpose = 'post' AND showcase_id IS NOT NULL AND store_id IS NULL AND product_id IS NULL) OR
          (purpose IN ('store_logo', 'store_banner') AND store_id IS NOT NULL AND showcase_id IS NULL AND product_id IS NULL AND kind = 'image') OR
          (purpose = 'product_image' AND product_id IS NOT NULL AND showcase_id IS NULL AND store_id IS NULL AND kind = 'image') OR
          (purpose = 'store_story' AND store_id IS NOT NULL AND showcase_id IS NULL AND product_id IS NULL)
        )
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    // Never strand real story uploads behind the old constraint.
    const rows = (await runner.query(
      "SELECT COUNT(*) AS count FROM media_assets WHERE purpose = 'store_story'",
    )) as Array<{ count: string | number }>;
    if (Number(rows[0]?.count ?? 0) > 0)
      throw new Error('Remove story media before reverting this migration');
    await runner.query(
      'ALTER TABLE `media_assets` DROP CHECK `chk_media_parent`',
    );
    await runner.query(`
      ALTER TABLE \`media_assets\`
        ADD CONSTRAINT \`chk_media_parent\` CHECK (
          (purpose = 'post' AND showcase_id IS NOT NULL AND store_id IS NULL AND product_id IS NULL) OR
          (purpose IN ('store_logo', 'store_banner') AND store_id IS NOT NULL AND showcase_id IS NULL AND product_id IS NULL AND kind = 'image') OR
          (purpose = 'product_image' AND product_id IS NOT NULL AND showcase_id IS NULL AND store_id IS NULL AND kind = 'image')
        )
    `);
  }
}
