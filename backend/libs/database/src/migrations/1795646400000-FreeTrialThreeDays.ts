import type { MigrationInterface, QueryRunner } from 'typeorm';

// The free trial is three days now. Databases that already ran
// FreeTrialSubscriptions kept its seven-day plan description, so align the
// stored copy with FREE_TRIAL_DAYS; an administrator's custom description is
// left untouched. Trials already issued keep their original end date, because
// shortening a running window would remove access an owner was promised.
export class FreeTrialThreeDays1795646400000 implements MigrationInterface {
  name = 'FreeTrialThreeDays1795646400000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      UPDATE \`subscription_plans\`
      SET \`description\` = '3-day free trial with basic features'
      WHERE \`slug\` = 'free'
        AND \`description\` = '7-day free trial with basic features'
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      UPDATE \`subscription_plans\`
      SET \`description\` = '7-day free trial with basic features'
      WHERE \`slug\` = 'free'
        AND \`description\` = '3-day free trial with basic features'
    `);
  }
}
