import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserRoles1793745600000 implements MigrationInterface {
  name = 'AddUserRoles1793745600000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      "ALTER TABLE `users` ADD `role` enum('user','admin') NOT NULL DEFAULT 'user'",
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE `users` DROP COLUMN `role`');
  }
}
