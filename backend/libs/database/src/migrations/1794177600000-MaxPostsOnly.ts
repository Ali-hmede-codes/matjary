import type { MigrationInterface, QueryRunner } from 'typeorm';

// Plans now expose one total post maximum (maxTotalPosts). The legacy monthly
// quota stays in the JSON for compatibility but is cleared so older plan rows
// cannot silently cap a month. The API also normalizes new/updated plans.
export class MaxPostsOnly1794177600000 implements MigrationInterface {
  name = 'MaxPostsOnly1794177600000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      UPDATE \`subscription_plans\`
      SET \`limits\` = JSON_SET(\`limits\`, '$.maxPostsPerMonth', CAST('null' AS JSON))
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    // Custom plans cannot be restored to an unknown previous value; the three
    // seeded plans return to their original monthly quotas.
    await runner.query(`
      UPDATE \`subscription_plans\`
      SET \`limits\` = JSON_SET(
        \`limits\`,
        '$.maxPostsPerMonth',
        CASE \`slug\`
          WHEN 'free' THEN 5
          WHEN 'basic' THEN 30
          WHEN 'premium' THEN 100
        END
      )
      WHERE \`slug\` IN ('free', 'basic', 'premium')
    `);
  }
}
