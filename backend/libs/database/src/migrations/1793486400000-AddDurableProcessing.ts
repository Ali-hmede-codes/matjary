import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDurableProcessing1793486400000 implements MigrationInterface {
  name = 'AddDurableProcessing1793486400000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE media_assets ADD processing_limits JSON NULL, ADD upload_expires_at DATETIME(6) NULL');
    await runner.query('ALTER TABLE post_engagement ADD last_batch_id VARCHAR(36) NULL');
    await runner.query(`CREATE TABLE media_processing_outbox (
      asset_id VARCHAR(36) NOT NULL PRIMARY KEY,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      CONSTRAINT fk_media_outbox_asset FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    await runner.query(`CREATE TABLE engagement_flush_receipts (
      batch_id VARCHAR(36) NOT NULL PRIMARY KEY,
      post_id VARCHAR(36) NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      CONSTRAINT fk_engagement_receipt_post FOREIGN KEY (post_id) REFERENCES showcases(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE engagement_flush_receipts');
    await runner.query('DROP TABLE media_processing_outbox');
    await runner.query('ALTER TABLE post_engagement DROP COLUMN last_batch_id');
    await runner.query('ALTER TABLE media_assets DROP COLUMN upload_expires_at, DROP COLUMN processing_limits');
  }
}
