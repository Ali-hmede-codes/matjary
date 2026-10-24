import type { MigrationInterface, QueryRunner } from 'typeorm';

// The free plan becomes a one-time trial. Existing accounts receive a fixed
// seven-day window from rollout; environments without users only get the plan
// description update. MySQL DML here is intentionally small and inspectable
// because migrations are not transactional.
export class FreeTrialSubscriptions1794004800000 implements MigrationInterface {
  name = 'FreeTrialSubscriptions1794004800000';

  async up(runner: QueryRunner): Promise<void> {
    // A free assignment without an end date would grant permanent access.
    await runner.query(`
      UPDATE \`user_subscriptions\` \`us\`
      JOIN \`subscription_plans\` \`p\` ON \`p\`.\`id\` = \`us\`.\`plan_id\`
      SET \`us\`.\`expires_at\` = DATE_ADD(GREATEST(NOW(6), \`us\`.\`starts_at\`), INTERVAL 7 DAY),
          \`us\`.\`notes\` = CONCAT(COALESCE(\`us\`.\`notes\`, ''), ' [free-trial-rollout]')
      WHERE \`p\`.\`slug\` = 'free'
        AND \`us\`.\`status\` = 'active'
        AND \`us\`.\`expires_at\` IS NULL
    `);

    // Every account without a running subscription starts a fresh trial now.
    await runner.query(`
      INSERT INTO \`user_subscriptions\`
        (\`id\`, \`user_id\`, \`plan_id\`, \`status\`, \`starts_at\`, \`expires_at\`, \`assigned_by\`, \`notes\`)
      SELECT UUID(), \`u\`.\`id\`, \`p\`.\`id\`, 'active',
             NOW(6), DATE_ADD(NOW(6), INTERVAL 7 DAY), NULL, 'Free trial (rollout)'
      FROM \`users\` \`u\`
      JOIN \`subscription_plans\` \`p\` ON \`p\`.\`slug\` = 'free'
      WHERE NOT EXISTS (
        SELECT 1 FROM \`user_subscriptions\` \`s\`
        WHERE \`s\`.\`user_id\` = \`u\`.\`id\`
          AND \`s\`.\`status\` = 'active'
          AND \`s\`.\`starts_at\` <= NOW(6)
          AND (\`s\`.\`expires_at\` IS NULL OR \`s\`.\`expires_at\` > NOW(6))
      )
    `);

    await runner.query(`
      UPDATE \`subscription_plans\`
      SET \`description\` = '7-day free trial with basic features'
      WHERE \`slug\` = 'free'
        AND \`description\` = 'Free tier with basic features'
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DELETE FROM \`user_subscriptions\`
      WHERE \`notes\` = 'Free trial (rollout)'
    `);

    await runner.query(`
      UPDATE \`user_subscriptions\`
      SET \`expires_at\` = NULL,
          \`notes\` = NULLIF(TRIM(REPLACE(\`notes\`, '[free-trial-rollout]', '')), '')
      WHERE \`notes\` LIKE '%[free-trial-rollout]%'
    `);

    await runner.query(`
      UPDATE \`subscription_plans\`
      SET \`description\` = 'Free tier with basic features'
      WHERE \`slug\` = 'free'
        AND \`description\` = '7-day free trial with basic features'
    `);
  }
}
