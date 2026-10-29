import type { MigrationInterface, QueryRunner } from 'typeorm';

// A plan-bundled badge is part of the subscription, not a free-standing month.
// This column remembers whether the shop's current badge consumes one of the
// owner's bundled slots, so bundled badges can follow the subscription end and
// monthly add-ons never occupy a bundled slot by accident.
export class PlanIncludedVerificationBadges1795473600000 implements MigrationInterface {
  name = 'PlanIncludedVerificationBadges1795473600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `stores` ADD COLUMN `verification_included_in_plan` BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Whether the current badge uses a plan-bundled slot' AFTER `verification_badge_granted_by`",
    );
    // Backfill from the latest approved application so shops granted through a
    // plan bundle keep counting against their owner's slots after rollout.
    await queryRunner.query(`
      UPDATE \`stores\` \`s\`
      SET \`s\`.\`verification_included_in_plan\` = TRUE
      WHERE \`s\`.\`has_verification_badge\` = TRUE
        AND (
          SELECT \`r\`.\`included_in_plan\`
          FROM \`store_verification_requests\` \`r\`
          WHERE \`r\`.\`store_id\` = \`s\`.\`id\` AND \`r\`.\`status\` = 'approved'
          ORDER BY \`r\`.\`reviewed_at\` DESC, \`r\`.\`created_at\` DESC
          LIMIT 1
        ) = TRUE
    `);
    // Bundled badges still inside their paid month follow the subscription that
    // pays for them; badges already past the renewal window stay expired.
    await queryRunner.query(`
      UPDATE \`stores\` \`s\`
      INNER JOIN (
        SELECT \`us1\`.\`user_id\`, MAX(\`us1\`.\`starts_at\`) AS \`latest_start\`
        FROM \`user_subscriptions\` \`us1\`
        WHERE \`us1\`.\`status\` = 'active'
        GROUP BY \`us1\`.\`user_id\`
      ) \`pick\` ON \`pick\`.\`user_id\` = \`s\`.\`owner_id\`
      INNER JOIN \`user_subscriptions\` \`us\`
        ON \`us\`.\`user_id\` = \`pick\`.\`user_id\`
       AND \`us\`.\`status\` = 'active'
       AND \`us\`.\`starts_at\` = \`pick\`.\`latest_start\`
      SET \`s\`.\`verification_badge_expires_at\` = \`us\`.\`expires_at\`
      WHERE \`s\`.\`verification_included_in_plan\` = TRUE
        AND \`s\`.\`has_verification_badge\` = TRUE
        AND \`us\`.\`expires_at\` IS NOT NULL
        AND \`us\`.\`expires_at\` > NOW(6)
        AND (
          \`s\`.\`verification_badge_expires_at\` IS NULL
          OR \`s\`.\`verification_badge_expires_at\` > NOW(6) - INTERVAL 5 DAY
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `stores` DROP COLUMN `verification_included_in_plan`',
    );
  }
}
