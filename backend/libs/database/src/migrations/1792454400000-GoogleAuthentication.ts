import type { MigrationInterface, QueryRunner } from 'typeorm';

export class GoogleAuthentication1792454400000 implements MigrationInterface {
  name = 'GoogleAuthentication1792454400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        MODIFY password_hash varchar(255) NULL,
        ADD google_subject varchar(255) COLLATE utf8mb4_bin NULL,
        ADD UNIQUE INDEX uq_users_google_subject (google_subject)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const [row] = await queryRunner.query(
      'SELECT COUNT(*) AS total FROM users WHERE password_hash IS NULL OR google_subject IS NOT NULL',
    );
    if (Number(row.total) > 0) {
      throw new Error(
        'Cannot revert Google authentication while Google accounts exist',
      );
    }
    await queryRunner.query(`
      ALTER TABLE users
        DROP INDEX uq_users_google_subject,
        DROP COLUMN google_subject,
        MODIFY password_hash varchar(255) NOT NULL
    `);
  }
}
