import type { MigrationInterface, QueryRunner } from 'typeorm';

// Storage is a platform resource, not a plan entitlement. Existing plan rows
// keep the key as JSON null (the policy's "unlimited" value), and the API also
// normalizes new/updated plans so a cap cannot be reintroduced.
export class UnlimitedPlanStorage1794091200000 implements MigrationInterface {
  name = 'UnlimitedPlanStorage1794091200000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      UPDATE \`subscription_plans\`
      SET \`limits\` = JSON_SET(\`limits\`, '$.maxStorageBytes', CAST('null' AS JSON))
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    // Custom plans cannot be restored to an unknown previous value; the three
    // seeded plans return to their original quotas.
    await runner.query(`
      UPDATE \`subscription_plans\`
      SET \`limits\` = JSON_SET(
        \`limits\`,
        '$.maxStorageBytes',
        CASE \`slug\`
          WHEN 'free' THEN 1073741824
          WHEN 'basic' THEN 10737418240
          WHEN 'premium' THEN 107374182400
        END
      )
      WHERE \`slug\` IN ('free', 'basic', 'premium')
    `);
  }
}
