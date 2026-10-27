import type { EntityManager } from 'typeorm';

const VARIANT_WIDTHS = [480, 1080, 1600] as const;
const VARIANT_FORMATS = ['avif', 'webp', 'jpeg'] as const;

// The encoder writes every derivative to a deterministic path before its row
// commits. A post deleted mid-flight would otherwise strand those bytes, so
// the purge claims them too; deleting a missing object is a no-op.
function encodedVariantKeys(showcaseId: string, assetId: string): string[] {
  const directory = `media/${showcaseId}/${assetId}`;
  return [
    ...VARIANT_WIDTHS.flatMap((width) =>
      VARIANT_FORMATS.map(
        (format) =>
          `${directory}/${format}-${width}.${format === 'jpeg' ? 'jpg' : format}`,
      ),
    ),
    `${directory}/mp4-720.mp4`,
    `${directory}/poster-jpeg.jpg`,
  ];
}

// Every relationship uses ON DELETE RESTRICT, so a post deletion must remove
// its children explicitly. The caller locks the post row first and removes the
// returned storage keys only after commit: orphaned bytes are safer than a
// committed deletion pointing at missing rows.
export async function purgeShowcaseRecords(
  manager: EntityManager,
  showcaseId: string,
): Promise<string[]> {
  const assets = (await manager.query(
    'SELECT id, original_key AS storageKey FROM media_assets WHERE showcase_id = ?',
    [showcaseId],
  )) as Array<{ id: string; storageKey: string | null }>;
  const variants = (await manager.query(
    'SELECT variant.storage_key AS storageKey FROM media_variants variant JOIN media_assets asset ON asset.id = variant.asset_id WHERE asset.showcase_id = ?',
    [showcaseId],
  )) as Array<{ storageKey: string | null }>;

  const keys = new Set<string>();
  for (const asset of assets) {
    if (asset.storageKey) keys.add(asset.storageKey);
    for (const key of encodedVariantKeys(showcaseId, asset.id)) keys.add(key);
  }
  for (const variant of variants)
    if (variant.storageKey) keys.add(variant.storageKey);

  // Media rows first: variants and the outbox reference assets, and assets
  // reference the post.
  await manager.query(
    'DELETE FROM media_processing_outbox WHERE asset_id IN (SELECT id FROM media_assets WHERE showcase_id = ?)',
    [showcaseId],
  );
  await manager.query(
    'DELETE FROM media_variants WHERE asset_id IN (SELECT id FROM media_assets WHERE showcase_id = ?)',
    [showcaseId],
  );
  await manager.query('DELETE FROM media_assets WHERE showcase_id = ?', [
    showcaseId,
  ]);

  // Engagement, SEO, and campaigns all reference the post with RESTRICT.
  await manager.query(
    'DELETE FROM engagement_flush_receipts WHERE post_id = ?',
    [showcaseId],
  );
  await manager.query('DELETE FROM post_engagement WHERE post_id = ?', [
    showcaseId,
  ]);
  await manager.query('DELETE FROM post_likes WHERE post_id = ?', [showcaseId]);
  await manager.query('DELETE FROM showcase_seo WHERE showcase_id = ?', [
    showcaseId,
  ]);
  await manager.query(
    'DELETE FROM boost_campaign_performance WHERE campaign_id IN (SELECT id FROM boost_campaigns WHERE target_showcase_id = ?)',
    [showcaseId],
  );
  await manager.query(
    'DELETE FROM boost_campaigns WHERE target_showcase_id = ?',
    [showcaseId],
  );

  await manager.query('DELETE FROM showcases WHERE id = ?', [showcaseId]);
  return [...keys];
}
