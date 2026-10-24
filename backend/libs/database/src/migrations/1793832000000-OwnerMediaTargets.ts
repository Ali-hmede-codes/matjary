import type { MigrationInterface, QueryRunner } from 'typeorm';

export class OwnerMediaTargets1793832000000 implements MigrationInterface {
  name = 'OwnerMediaTargets1793832000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE media_assets
      MODIFY showcase_id VARCHAR(36) NULL,
      ADD store_id VARCHAR(36) NULL,
      ADD product_id VARCHAR(36) NULL,
      ADD purpose VARCHAR(24) NOT NULL DEFAULT 'post'`);
    await runner.query(`ALTER TABLE media_assets
      ADD CONSTRAINT fk_media_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT,
      ADD CONSTRAINT fk_media_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
      ADD CONSTRAINT chk_media_parent CHECK (
        (purpose = 'post' AND showcase_id IS NOT NULL AND store_id IS NULL AND product_id IS NULL) OR
        (purpose IN ('store_logo', 'store_banner') AND store_id IS NOT NULL AND showcase_id IS NULL AND product_id IS NULL AND kind = 'image') OR
        (purpose = 'product_image' AND product_id IS NOT NULL AND showcase_id IS NULL AND store_id IS NULL AND kind = 'image')
      ),
      ADD INDEX idx_media_store_purpose (store_id, purpose),
      ADD INDEX idx_media_product (product_id)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    // Never discard real branding/product uploads to satisfy the old schema.
    const rows = await runner.query(
      'SELECT COUNT(*) AS count FROM media_assets WHERE showcase_id IS NULL',
    );
    if (Number(rows[0]?.count) > 0)
      throw new Error('Move non-post media before reverting this migration');
    await runner.query(`ALTER TABLE media_assets
      DROP CHECK chk_media_parent,
      DROP FOREIGN KEY fk_media_store,
      DROP FOREIGN KEY fk_media_product,
      DROP INDEX idx_media_store_purpose,
      DROP INDEX idx_media_product,
      DROP COLUMN store_id,
      DROP COLUMN product_id,
      DROP COLUMN purpose,
      MODIFY showcase_id VARCHAR(36) NOT NULL`);
  }
}
