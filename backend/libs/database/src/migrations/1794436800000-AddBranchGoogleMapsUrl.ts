import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBranchGoogleMapsUrl1794436800000 implements MigrationInterface {
  name = 'AddBranchGoogleMapsUrl1794436800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`store_branches\`
        ADD COLUMN \`google_maps_url\` VARCHAR(1000) NULL
        COMMENT 'Validated Google Maps share link' AFTER \`opening_hours\`;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`store_branches\`
        DROP COLUMN \`google_maps_url\`;
    `);
  }
}
