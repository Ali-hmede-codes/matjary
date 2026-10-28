import type { EntityManager } from 'typeorm';
import { encodedMediaKeys } from './showcase-purge';

export interface StoryPurgeTarget {
  id: string;
  storeId: string;
  mediaAssetId: string;
}

// Stories own one media asset each, so deleting a story must remove the asset
// (and its variants) explicitly: every relation is ON DELETE RESTRICT. The
// caller locks the story row first and removes the returned storage keys only
// after commit, exactly like a post deletion.
export async function purgeStoryRecords(
  manager: EntityManager,
  story: StoryPurgeTarget,
): Promise<string[]> {
  const originals = (await manager.query(
    'SELECT original_key AS storageKey FROM media_assets WHERE id = ?',
    [story.mediaAssetId],
  )) as Array<{ storageKey: string | null }>;
  const variants = (await manager.query(
    'SELECT storage_key AS storageKey FROM media_variants WHERE asset_id = ?',
    [story.mediaAssetId],
  )) as Array<{ storageKey: string | null }>;

  const keys = new Set<string>();
  for (const original of originals)
    if (original.storageKey) keys.add(original.storageKey);
  // Deterministic encoder paths cover a file written just before a failure.
  for (const key of encodedMediaKeys(story.storeId, story.mediaAssetId))
    keys.add(key);
  for (const variant of variants)
    if (variant.storageKey) keys.add(variant.storageKey);

  // The story row references the asset, so it goes first.
  await manager.query('DELETE FROM store_stories WHERE id = ?', [story.id]);
  await manager.query(
    'DELETE FROM media_processing_outbox WHERE asset_id = ?',
    [story.mediaAssetId],
  );
  await manager.query('DELETE FROM media_variants WHERE asset_id = ?', [
    story.mediaAssetId,
  ]);
  await manager.query('DELETE FROM media_assets WHERE id = ?', [
    story.mediaAssetId,
  ]);

  return [...keys];
}

// An upload negotiated for a story but never published would otherwise keep
// both its bytes and a slot forever. The worker sweeps these ready, unattached
// assets; the row cleanup mirrors purgeStoryRecords without a story row.
export async function purgeDetachedStoryAsset(
  manager: EntityManager,
  parentId: string,
  assetId: string,
): Promise<string[]> {
  const originals = (await manager.query(
    'SELECT original_key AS storageKey FROM media_assets WHERE id = ?',
    [assetId],
  )) as Array<{ storageKey: string | null }>;
  const variants = (await manager.query(
    'SELECT storage_key AS storageKey FROM media_variants WHERE asset_id = ?',
    [assetId],
  )) as Array<{ storageKey: string | null }>;

  const keys = new Set<string>();
  for (const original of originals)
    if (original.storageKey) keys.add(original.storageKey);
  for (const key of encodedMediaKeys(parentId, assetId)) keys.add(key);
  for (const variant of variants)
    if (variant.storageKey) keys.add(variant.storageKey);

  await manager.query(
    'DELETE FROM media_processing_outbox WHERE asset_id = ?',
    [assetId],
  );
  await manager.query('DELETE FROM media_variants WHERE asset_id = ?', [
    assetId,
  ]);
  await manager.query('DELETE FROM media_assets WHERE id = ?', [assetId]);

  return [...keys];
}
