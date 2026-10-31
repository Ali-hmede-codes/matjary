import type { EntityManager } from 'typeorm';

export interface TrialShopForDeletion {
  id: string;
  ownerId: string;
}

/**
 * A trial-only account is one whose entire subscription history is the free
 * trial. Paid customers keep the archive design: their shops are locked and
 * archived after a lapse, but are never deleted automatically. This check is
 * repeated under the store lock before an irreversible purge.
 */
export async function isTrialOnlyOwner(
  manager: EntityManager,
  ownerId: string,
): Promise<boolean> {
  const rows: Array<{ trial: number | string; paid: number | string }> =
    await manager.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM user_subscriptions s
             JOIN subscription_plans p ON p.id = s.plan_id
            WHERE s.user_id = ? AND p.slug = 'free'
         ) AS trial,
         EXISTS (
           SELECT 1 FROM user_subscriptions s
             JOIN subscription_plans p ON p.id = s.plan_id
            WHERE s.user_id = ? AND p.slug <> 'free'
         ) AS paid`,
      [ownerId, ownerId],
    );
  const row = rows[0];
  return Boolean(row && Number(row.trial) === 1 && Number(row.paid) === 0);
}

// Only shops that locked and are still trial-only after the retention delay.
// Suspended or moderator-archived shops stay for a human decision.
export async function trialShopsDueForDeletion(
  manager: EntityManager,
  cutoff: Date,
  limit = 5,
): Promise<TrialShopForDeletion[]> {
  const take = Math.max(1, Math.min(50, Math.trunc(limit)));
  return manager.query(
    `SELECT s.id, s.owner_id AS ownerId
       FROM stores s
       JOIN users u ON u.id = s.owner_id
      WHERE s.status = 'locked'
        AND s.subscription_locked_at IS NOT NULL
        AND s.subscription_locked_at <= ?
        AND s.admin_archived_at IS NULL
        -- Wait for the archive pass: deleting a shop that is still moving
        -- bytes would leave orphaned files behind.
        AND s.media_archive_state IN ('none', 'archived', 'failed')
        AND u.suspended_at IS NULL
        AND EXISTS (
          SELECT 1 FROM user_subscriptions t
            JOIN subscription_plans tp ON tp.id = t.plan_id
           WHERE t.user_id = u.id AND tp.slug = 'free'
        )
        AND NOT EXISTS (
          SELECT 1 FROM user_subscriptions paid
            JOIN subscription_plans pp ON pp.id = paid.plan_id
           WHERE paid.user_id = u.id AND pp.slug <> 'free'
        )
      ORDER BY s.subscription_locked_at ASC
      LIMIT ${take}`,
    [cutoff],
  );
}
