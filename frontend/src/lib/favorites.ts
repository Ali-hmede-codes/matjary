// Favorite shops are device-local, matching how saved posts work. Only public
// shop ids are stored; the directory resolves them into cards on the favorites
// page, so a renamed or removed shop can never be rendered from stale data.
const favoriteShopsKey = 'matjary:favorite-shops';
const MAX_FAVORITE_SHOPS = 500;
const shopIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const isShopId = (value: unknown): value is string =>
  typeof value === 'string' && shopIdPattern.test(value);

export function readFavoriteShopIds(
  storage: Pick<Storage, 'getItem'>,
): string[] {
  try {
    const value: unknown = JSON.parse(
      storage.getItem(favoriteShopsKey) || '[]',
    );
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(isShopId))].slice(-MAX_FAVORITE_SHOPS);
  } catch {
    return [];
  }
}

export function writeFavoriteShopIds(
  storage: Pick<Storage, 'setItem'>,
  ids: string[],
): boolean {
  try {
    storage.setItem(
      favoriteShopsKey,
      JSON.stringify(
        [...new Set(ids.filter(isShopId))].slice(-MAX_FAVORITE_SHOPS),
      ),
    );
    return true;
  } catch {
    return false;
  }
}

/** Adds or removes one shop, keeping the newest favorite at the end. */
export function toggleFavoriteShopIds(ids: string[], id: string): string[] {
  if (!isShopId(id)) return ids;
  return ids.includes(id)
    ? ids.filter((value) => value !== id)
    : [...ids, id].slice(-MAX_FAVORITE_SHOPS);
}
