// Link-preview cards are derived from a store's logo asset. Deriving the key
// from the asset id means replacing the logo automatically produces a new card
// without an extra database column.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const VARIANT_KEY = new RegExp(`^media/${UUID}/(${UUID})/[^/]+$`, 'iu');

/** Asset id encoded in a processed variant key (`media/<parent>/<asset>/...`). */
export function mediaAssetIdFromKey(
  key: string | null | undefined,
): string | null {
  if (!key) return null;
  return VARIANT_KEY.exec(key)?.[1] ?? null;
}

/** Storage key of the auto-generated social card for a store logo asset. */
export function storeShareCardKey(storeId: string, assetId: string): string {
  return `og/store/${storeId}/${assetId}.jpg`;
}
