import type { MigrationInterface, QueryRunner } from 'typeorm';

// A manual plan assignment now records the recipient's contact number so the
// administrator can reach them. The column is nullable because existing
// accounts were created before the phone was collected.
export class UserPhones1795905600000 implements MigrationInterface {
  name = 'UserPhones1795905600000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE \`users\`
        ADD COLUMN \`phone\` VARCHAR(20) NULL AFTER \`display_name\`
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE `users` DROP COLUMN `phone`');
  }
}
