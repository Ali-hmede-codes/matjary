import { IsNull, Not, type EntityManager } from 'typeorm';
import { Store, StoreMediaArchiveState, StoreStatus } from './entities';

export interface LockedShopSummary {
  id: string;
  name: string;
  slug: string;
  lockedAt: Date | null;
  mediaArchiveState: StoreMediaArchiveState;
  productsCount: number;
  postsCount: number;
}

/**
 * Locks every shop an owner still has open after the plan grace window ended.
 * Only a publicly active shop becomes `locked`; offline and archived shops keep
 * their owner-chosen status but are still counted as locked so a renewal never
 * turns them back on behind the owner's back. Trashed and moderator-archived
 * shops are untouched.
 */
export async function lockOwnerShops(
  manager: EntityManager,
  ownerId: string,
  now = new Date(),
): Promise<number> {
  const shops = await manager.find(Store, {
    where: {
      ownerId,
      status: Not(StoreStatus.TRASHED),
      adminArchivedAt: IsNull(),
      subscriptionLockedAt: IsNull(),
    },
    select: {
      id: true,
      status: true,
      mediaArchiveState: true,
    },
  });
  let locked = 0;
  for (const shop of shops) {
    const status =
      shop.status === StoreStatus.ACTIVE ? StoreStatus.LOCKED : shop.status;
    // A shop that was already archived keeps its archived state; a fresh lock
    // queues the media pass unless the volume is missing (handled by the worker).
    const archiveState =
      shop.mediaArchiveState === StoreMediaArchiveState.NONE
        ? StoreMediaArchiveState.PENDING
        : shop.mediaArchiveState;
    const result: { affectedRows?: number } = await manager.query(
      'UPDATE stores SET status = ?, subscription_locked_at = ?, media_archive_state = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND owner_id = ? AND subscription_locked_at IS NULL',
      [status, now, archiveState, shop.id, ownerId],
    );
    locked += Number(result?.affectedRows ?? 0);
  }
  return locked;
}

/**
 * Renewal path. A locked shop becomes active again; offline/archived shops keep
 * their status. Any archive state that may hold moved bytes turns into
 * `restoring` so the worker normalizes the files, including a partial pass left
 * by a crash or a failed archive.
 */
export async function unlockOwnerShops(
  manager: EntityManager,
  ownerId: string,
): Promise<number> {
  const shops = await manager.find(Store, {
    where: { ownerId, subscriptionLockedAt: Not(IsNull()) },
    select: {
      id: true,
      status: true,
      mediaArchiveState: true,
    },
  });
  let unlocked = 0;
  for (const shop of shops) {
    const status =
      shop.status === StoreStatus.LOCKED ? StoreStatus.ACTIVE : shop.status;
    const archiveState =
      shop.mediaArchiveState === StoreMediaArchiveState.NONE
        ? StoreMediaArchiveState.NONE
        : StoreMediaArchiveState.RESTORING;
    const result: { affectedRows?: number } = await manager.query(
      'UPDATE stores SET status = ?, subscription_locked_at = NULL, media_archive_state = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND owner_id = ? AND subscription_locked_at IS NOT NULL',
      [status, archiveState, shop.id, ownerId],
    );
    unlocked += Number(result?.affectedRows ?? 0);
  }
  return unlocked;
}

// What the locked-shop renewal page shows: identity, when it was frozen, where
// its files are, and how much content is waiting behind the renewal.
export async function lockedShopsForOwner(
  manager: EntityManager,
  ownerId: string,
): Promise<LockedShopSummary[]> {
  const rows: Array<{
    id: string;
    name: string;
    slug: string;
    lockedAt: Date | string | null;
    mediaArchiveState: StoreMediaArchiveState;
    productsCount: number | string;
    postsCount: number | string;
  }> = await manager.query(
    `SELECT s.id,
            s.name,
            s.slug,
            s.subscription_locked_at AS lockedAt,
            s.media_archive_state AS mediaArchiveState,
            (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id) AS productsCount,
            (SELECT COUNT(*) FROM showcases sc WHERE sc.store_id = s.id) AS postsCount
       FROM stores s
      WHERE s.owner_id = ?
        AND s.subscription_locked_at IS NOT NULL
      ORDER BY s.subscription_locked_at DESC`,
    [ownerId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    lockedAt: row.lockedAt ? new Date(row.lockedAt) : null,
    mediaArchiveState: row.mediaArchiveState,
    productsCount: Number(row.productsCount ?? 0),
    postsCount: Number(row.postsCount ?? 0),
  }));
}
