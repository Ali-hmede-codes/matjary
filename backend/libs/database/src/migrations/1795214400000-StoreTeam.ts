import type { MigrationInterface, QueryRunner } from 'typeorm';

export class StoreTeam1795214400000 implements MigrationInterface {
  name = 'StoreTeam1795214400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE store_members (
        id varchar(36) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        store_id varchar(36) NOT NULL,
        user_id varchar(36) NOT NULL,
        role enum('editor') NOT NULL DEFAULT 'editor',
        UNIQUE INDEX uq_store_members_store_user (store_id, user_id),
        INDEX idx_store_members_user (user_id),
        PRIMARY KEY (id),
        CONSTRAINT fk_store_members_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT fk_store_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // Rows only exist while an invitation is pending. The email is stored
    // lower-cased by the API, and the unique pair prevents duplicate invites.
    await queryRunner.query(`
      CREATE TABLE store_invitations (
        id varchar(36) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        store_id varchar(36) NOT NULL,
        email varchar(254) NOT NULL,
        invited_by_id varchar(36) NOT NULL,
        expires_at datetime(6) NOT NULL,
        UNIQUE INDEX uq_store_invitations_store_email (store_id, email),
        INDEX idx_store_invitations_email (email),
        INDEX idx_store_invitations_expires (expires_at),
        PRIMARY KEY (id),
        CONSTRAINT fk_store_invitations_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT fk_store_invitations_invited_by FOREIGN KEY (invited_by_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE store_invitations');
    await queryRunner.query('DROP TABLE store_members');
  }
}
