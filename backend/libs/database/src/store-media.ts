import type { EntityManager } from 'typeorm';
import { MediaStatus } from './entities';

/**
 * Every storage key that belongs to one shop: processed variants, any original
 * that is still retained, and the branding/attachment keys the rows point at.
 * The database is the authoritative list, so a restore never depends on a
 * manifest that a crash could have left half-written.
 */
export async function storeMediaKeys(
  manager: EntityManager,
  storeId: string,
): Promise<string[]> {
  const keys = new Set<string>();
  const variants: Array<{ storageKey: string | null }> = await manager.query(
    `SELECT DISTINCT v.storage_key AS storageKey
       FROM media_variants v
       JOIN media_assets a ON a.id = v.asset_id
       LEFT JOIN products p ON p.id = a.product_id
       LEFT JOIN showcases s ON s.id = a.showcase_id
      WHERE a.status = ?
        AND (a.store_id = ? OR p.store_id = ? OR s.store_id = ?)`,
    [MediaStatus.READY, storeId, storeId, storeId],
  );
  for (const row of variants)
    if (row.storageKey) keys.add(String(row.storageKey));
  const originals: Array<{ storageKey: string | null }> = await manager.query(
    `SELECT DISTINCT a.original_key AS storageKey
       FROM media_assets a
       LEFT JOIN products p ON p.id = a.product_id
       LEFT JOIN showcases s ON s.id = a.showcase_id
      WHERE a.original_key IS NOT NULL
        AND (a.store_id = ? OR p.store_id = ? OR s.store_id = ?)`,
    [storeId, storeId, storeId],
  );
  for (const row of originals)
    if (row.storageKey) keys.add(String(row.storageKey));
  // Attachment columns are a safety net: a key belongs to this shop even if its
  // asset row was lost, and the bytes must still be archived and restored.
  const attachments: Array<{ storageKey: string | null }> = await manager.query(
    `SELECT logo_key AS storageKey FROM stores
      WHERE id = ? AND logo_key IS NOT NULL
     UNION
     SELECT banner_key AS storageKey FROM stores
      WHERE id = ? AND banner_key IS NOT NULL
     UNION
     SELECT jt.storageKey
       FROM products p
       JOIN JSON_TABLE(
         p.image_keys, '$[*]' COLUMNS (storageKey VARCHAR(512) PATH '$')
       ) AS jt
      WHERE p.store_id = ? AND p.image_keys IS NOT NULL`,
    [storeId, storeId, storeId],
  );
  for (const row of attachments)
    if (row.storageKey) keys.add(String(row.storageKey));
  return [...keys];
}
