import type { EntityManager } from 'typeorm';

// Every relationship uses ON DELETE RESTRICT, so a permanent shop deletion
// must remove children explicitly before their parents. The caller locks the
// store row first and removes the returned storage keys only after commit:
// orphaned bytes are safer than a committed deletion pointing at missing rows.
export async function purgeStoreRecords(
  manager: EntityManager,
  storeId: string,
): Promise<string[]> {
  const postIds = 'SELECT id FROM showcases WHERE store_id = ?';
  const productIds = 'SELECT id FROM products WHERE store_id = ?';
  const assetScope = `(showcase_id IN (${postIds}) OR store_id = ? OR product_id IN (${productIds}))`;
  const aliasedAssetScope = `(asset.showcase_id IN (${postIds}) OR asset.store_id = ? OR asset.product_id IN (${productIds}))`;

  const originals = (await manager.query(
    `SELECT original_key AS storageKey FROM media_assets WHERE original_key IS NOT NULL AND ${assetScope}`,
    [storeId, storeId, storeId],
  )) as Array<{ storageKey: string | null }>;
  const variants = (await manager.query(
    `SELECT variant.storage_key AS storageKey FROM media_variants variant JOIN media_assets asset ON asset.id = variant.asset_id WHERE ${aliasedAssetScope}`,
    [storeId, storeId, storeId],
  )) as Array<{ storageKey: string | null }>;
  const keys = [
    ...new Set(
      [...originals, ...variants]
        .map((row) => row.storageKey)
        .filter((key): key is string => Boolean(key)),
    ),
  ];

  // Stories reference the shop, its catalogue rows, and their media assets, so
  // they go before any of them. Their bytes are covered by the shop-wide asset
  // scope below.
  await manager.query('DELETE FROM store_stories WHERE store_id = ?', [
    storeId,
  ]);

  // Media rows first: assets are referenced by variants, the outbox, and
  // three parent tables.
  await manager.query(
    `DELETE FROM media_processing_outbox WHERE asset_id IN (SELECT id FROM media_assets WHERE ${assetScope})`,
    [storeId, storeId, storeId],
  );
  await manager.query(
    `DELETE FROM media_variants WHERE asset_id IN (SELECT id FROM media_assets WHERE ${assetScope})`,
    [storeId, storeId, storeId],
  );
  await manager.query(`DELETE FROM media_assets WHERE ${assetScope}`, [
    storeId,
    storeId,
    storeId,
  ]);

  // Post engagement, receipts, and SEO point at showcases.
  await manager.query(
    `DELETE FROM engagement_flush_receipts WHERE post_id IN (${postIds})`,
    [storeId],
  );
  await manager.query(
    `DELETE FROM post_engagement WHERE post_id IN (${postIds})`,
    [storeId],
  );
  await manager.query(`DELETE FROM post_likes WHERE post_id IN (${postIds})`, [
    storeId,
  ]);
  await manager.query(
    `DELETE FROM showcase_seo WHERE showcase_id IN (${postIds}) OR store_id = ?`,
    [storeId, storeId],
  );

  // Products and shop-level SEO.
  await manager.query(
    `DELETE FROM product_seo WHERE product_id IN (${productIds}) OR store_id = ?`,
    [storeId, storeId],
  );
  await manager.query('DELETE FROM store_seo WHERE store_id = ?', [storeId]);
  // Redirects have no foreign key, so they would otherwise outlive the shop.
  await manager.query('DELETE FROM seo_redirects WHERE store_id = ?', [
    storeId,
  ]);

  // Carts may hold this shop's products even when the cart belongs elsewhere.
  await manager.query(
    `DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE store_id = ?) OR product_id IN (${productIds})`,
    [storeId, storeId],
  );
  await manager.query('DELETE FROM carts WHERE store_id = ?', [storeId]);

  // Campaigns targeting this shop or its posts must go before showcases.
  await manager.query(
    `DELETE FROM boost_campaign_performance WHERE campaign_id IN (SELECT id FROM boost_campaigns WHERE target_store_id = ? OR target_showcase_id IN (${postIds}))`,
    [storeId, storeId],
  );
  await manager.query(
    `DELETE FROM boost_campaigns WHERE target_store_id = ? OR target_showcase_id IN (${postIds})`,
    [storeId, storeId],
  );

  await manager.query('DELETE FROM products WHERE store_id = ?', [storeId]);
  await manager.query('DELETE FROM showcases WHERE store_id = ?', [storeId]);
  await manager.query('DELETE FROM store_categories WHERE store_id = ?', [
    storeId,
  ]);
  await manager.query('DELETE FROM store_members WHERE store_id = ?', [
    storeId,
  ]);
  await manager.query('DELETE FROM store_invitations WHERE store_id = ?', [
    storeId,
  ]);
  await manager.query('DELETE FROM store_branches WHERE store_id = ?', [
    storeId,
  ]);
  // Verification applications belong to the shop's history; the FK would
  // otherwise block the permanent deletion of a store.
  await manager.query(
    'DELETE FROM store_verification_requests WHERE store_id = ?',
    [storeId],
  );
  await manager.query('DELETE FROM stores WHERE id = ?', [storeId]);

  return keys;
}
