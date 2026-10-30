import { createHash } from 'node:crypto';

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

/**
 * Every shop gets a generated card even without a logo, so a shared link is
 * never text-only. The name and brand color are part of the version, which
 * makes a rename produce a fresh card (and cache URL) automatically.
 */
export function storeBrandCardVersion(
  name: string,
  brandColor: string | null | undefined,
): string {
  return createHash('sha256')
    .update(`${name.trim()}\u0000${brandColor?.trim() ?? ''}`)
    .digest('hex')
    .slice(0, 12);
}

/** Storage key of the name/brand card used when no logo card exists. */
export function storeBrandCardKey(storeId: string, version: string): string {
  return `og/store/${storeId}/brand-${version}.jpg`;
}
