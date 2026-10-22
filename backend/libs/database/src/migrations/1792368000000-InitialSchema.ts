import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1792368000000 implements MigrationInterface {
  name = 'InitialSchema1792368000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id varchar(36) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        email varchar(254) NOT NULL,
        display_name varchar(120) NOT NULL,
        password_hash varchar(255) NOT NULL,
        UNIQUE INDEX uq_users_email (email),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await queryRunner.query(`
      CREATE TABLE showcases (
        id varchar(36) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        owner_id varchar(36) NOT NULL,
        slug varchar(191) NOT NULL,
        title varchar(200) NOT NULL,
        description text NULL,
        status enum('draft','published','archived') NOT NULL DEFAULT 'draft',
        published_at datetime(6) NULL,
        UNIQUE INDEX uq_showcases_slug (slug),
        INDEX idx_showcases_owner_created (owner_id, created_at),
        INDEX idx_showcases_status_published (status, published_at),
        PRIMARY KEY (id),
        CONSTRAINT fk_showcases_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await queryRunner.query(`
      CREATE TABLE media_assets (
        id varchar(36) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        showcase_id varchar(36) NOT NULL,
        kind enum('image','video') NOT NULL,
        status enum('pending','processing','ready','failed') NOT NULL DEFAULT 'pending',
        original_key varchar(512) COLLATE utf8mb4_bin NULL,
        mime_type varchar(100) NOT NULL,
        size_bytes bigint UNSIGNED NOT NULL,
        width int UNSIGNED NULL,
        height int UNSIGNED NULL,
        duration_ms int UNSIGNED NULL,
        alt_text varchar(500) NULL,
        position int UNSIGNED NOT NULL DEFAULT 0,
        UNIQUE INDEX uq_media_assets_original_key (original_key),
        INDEX idx_media_assets_showcase_position (showcase_id, position),
        INDEX idx_media_assets_status_created (status, created_at),
        PRIMARY KEY (id),
        CONSTRAINT fk_media_showcase FOREIGN KEY (showcase_id) REFERENCES showcases(id) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await queryRunner.query(`
      CREATE TABLE media_variants (
        id varchar(36) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        asset_id varchar(36) NOT NULL,
        label varchar(64) NOT NULL,
        storage_key varchar(512) COLLATE utf8mb4_bin NOT NULL,
        mime_type varchar(100) NOT NULL,
        size_bytes bigint UNSIGNED NOT NULL,
        width int UNSIGNED NOT NULL,
        height int UNSIGNED NOT NULL,
        duration_ms int UNSIGNED NULL,
        UNIQUE INDEX uq_media_variants_asset_label (asset_id, label),
        UNIQUE INDEX uq_media_variants_storage_key (storage_key),
        PRIMARY KEY (id),
        CONSTRAINT fk_variants_asset FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  // Destructive rollback: use only on a disposable database or after a backup.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE media_variants');
    await queryRunner.query('DROP TABLE media_assets');
    await queryRunner.query('DROP TABLE showcases');
    await queryRunner.query('DROP TABLE users');
  }
}
