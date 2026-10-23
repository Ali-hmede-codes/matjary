import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStoreLocation1793318400000 implements MigrationInterface {
  name = 'AddStoreLocation1793318400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add location fields to stores table
    await queryRunner.query(`
      ALTER TABLE \`stores\`
        ADD COLUMN \`latitude\` DECIMAL(10, 8) NULL COMMENT 'Latitude coordinate (-90 to 90)',
        ADD COLUMN \`longitude\` DECIMAL(11, 8) NULL COMMENT 'Longitude coordinate (-180 to 180)',
        ADD COLUMN \`address\` VARCHAR(500) NULL COMMENT 'Full street address',
        ADD COLUMN \`city\` VARCHAR(100) NULL COMMENT 'City name',
        ADD COLUMN \`country\` VARCHAR(100) NULL COMMENT 'Country name (default: Lebanon)',
        ADD COLUMN \`postal_code\` VARCHAR(20) NULL COMMENT 'Postal/ZIP code',
        ADD COLUMN \`location_name\` VARCHAR(200) NULL COMMENT 'Custom location name (e.g., "Beirut Mall")',
        ADD COLUMN \`phone\` VARCHAR(30) NULL COMMENT 'Store phone number',
        ADD COLUMN \`website\` VARCHAR(500) NULL COMMENT 'Store website URL',
        ADD COLUMN \`opening_hours\` JSON NULL COMMENT 'Opening hours as JSON (e.g., {"mon": "9:00-18:00"})';
    `);

    // Add indexes for location-based queries
    await queryRunner.query(
      'CREATE INDEX `idx_stores_location` ON `stores` (`latitude`, `longitude`)',
    );
    await queryRunner.query(
      'CREATE INDEX `idx_stores_city` ON `stores` (`city`)',
    );
    await queryRunner.query(
      'CREATE INDEX `idx_stores_country` ON `stores` (`country`)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`idx_stores_country\` ON \`stores\``);
    await queryRunner.query(`DROP INDEX \`idx_stores_city\` ON \`stores\``);
    await queryRunner.query(`DROP INDEX \`idx_stores_location\` ON \`stores\``);

    await queryRunner.query(`
      ALTER TABLE \`stores\`
        DROP COLUMN \`opening_hours\`,
        DROP COLUMN \`website\`,
        DROP COLUMN \`phone\`,
        DROP COLUMN \`location_name\`,
        DROP COLUMN \`postal_code\`,
        DROP COLUMN \`country\`,
        DROP COLUMN \`city\`,
        DROP COLUMN \`address\`,
        DROP COLUMN \`longitude\`,
        DROP COLUMN \`latitude\`;
    `);
  }
}
