import { useRef, useState } from 'react';
import {
  readFavoriteShopIds,
  toggleFavoriteShopIds,
  writeFavoriteShopIds,
} from '../lib/favorites';

/**
 * Favorite shops live on this device, matching saved posts: no sign-in step,
 * nothing to sync, and the hearts respond instantly. The page-level component
 * owns the notice so one toast covers every toggle on that page.
 */
export function useShopFavorites(onNotice: (message: string) => void) {
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return readFavoriteShopIds(window.localStorage);
    } catch {
      return [];
    }
  });
  // React batches state updates, so two hearts clicked in the same frame would
  // both read the same stale list. The ref is advanced synchronously instead.
  const latest = useRef(favorites);

  function isFavorite(id: string | null | undefined): boolean {
    return Boolean(id && favorites.includes(id));
  }

  function toggleFavorite(id: string, name?: string) {
    const current = latest.current;
    const removing = current.includes(id);
    const next = toggleFavoriteShopIds(current, id);
    // An invalid id must not pretend to save.
    if (next === current) return;
    latest.current = next;
    setFavorites(next);
    let stored = false;
    try {
      stored = writeFavoriteShopIds(window.localStorage, next);
    } catch {
      stored = false;
    }
    const subject = name?.trim() || 'Shop';
    onNotice(
      removing
        ? `Removed ${subject} from your favorites.`
        : stored
          ? `Saved ${subject} to your favorites.`
          : 'Favorite saved for this visit only. Browser storage is unavailable.',
    );
  }

  return { favorites, isFavorite, toggleFavorite };
}
