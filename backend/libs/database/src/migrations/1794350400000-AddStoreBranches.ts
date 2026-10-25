import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStoreBranches1794350400000 implements MigrationInterface {
  name = 'AddStoreBranches1794350400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE store_branches (
        id varchar(36) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        store_id varchar(36) NOT NULL,
        name varchar(120) NOT NULL,
        address varchar(500) NULL,
        city varchar(100) NULL,
        country varchar(100) NULL,
        postal_code varchar(20) NULL,
        latitude decimal(10,8) NULL,
        longitude decimal(11,8) NULL,
        phone varchar(30) NULL,
        whatsapp varchar(30) NULL,
        opening_hours json NULL,
        is_primary boolean NOT NULL DEFAULT false,
        sort_order int NOT NULL DEFAULT 0,
        INDEX idx_store_branches_store (store_id),
        INDEX idx_store_branches_order (store_id, sort_order),
        PRIMARY KEY (id),
        CONSTRAINT fk_store_branches_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // Keep an existing single location visible after the upgrade. The row is
    // only a convenience copy; the legacy columns stay authoritative until the
    // owner saves branches, which then mirror the primary branch back.
    await queryRunner.query(`
      INSERT INTO store_branches (
        id, store_id, name, address, city, country, postal_code,
        latitude, longitude, phone, whatsapp, opening_hours,
        is_primary, sort_order
      )
      SELECT
        UUID(),
        store.id,
        COALESCE(
          NULLIF(store.location_name, ''),
          NULLIF(store.city, ''),
          'Main location'
        ),
        store.address,
        store.city,
        store.country,
        store.postal_code,
        store.latitude,
        store.longitude,
        store.phone,
        CASE
          WHEN store.social_media_links IS NOT NULL
            AND JSON_VALID(store.social_media_links)
            AND JSON_UNQUOTE(JSON_EXTRACT(store.social_media_links, '$.whatsapp')) LIKE 'https://wa.me/%'
          THEN NULLIF(
            REGEXP_REPLACE(
              JSON_UNQUOTE(JSON_EXTRACT(store.social_media_links, '$.whatsapp')),
              '[^0-9]',
              ''
            ),
            ''
          )
          ELSE NULL
        END,
        store.opening_hours,
        true,
        0
      FROM stores AS store
      WHERE store.address IS NOT NULL
        OR store.city IS NOT NULL
        OR store.country IS NOT NULL
        OR store.phone IS NOT NULL
        OR store.latitude IS NOT NULL
        OR store.longitude IS NOT NULL
        OR store.opening_hours IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE store_branches');
  }
}
