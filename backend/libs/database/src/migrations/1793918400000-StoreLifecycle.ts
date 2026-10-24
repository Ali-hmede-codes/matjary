import type { MigrationInterface, QueryRunner } from 'typeorm';

export class StoreLifecycle1793918400000 implements MigrationInterface {
  name = 'StoreLifecycle1793918400000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE stores
      ADD status ENUM('active','offline','archived','trashed') NOT NULL DEFAULT 'active',
      ADD trashed_at DATETIME(6) NULL,
      ADD INDEX idx_stores_owner_status (owner_id, status)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    const rows = await runner.query(
      "SELECT COUNT(*) AS count FROM stores WHERE status != 'active'",
    );
    // Removing the visibility column must never silently republish hidden stores.
    if (Number(rows[0]?.count) > 0)
      throw new Error(
        'Resolve hidden store states before reverting this migration',
      );
    await runner.query(
      'ALTER TABLE stores DROP INDEX idx_stores_owner_status, DROP COLUMN trashed_at, DROP COLUMN status',
    );
  }
}
