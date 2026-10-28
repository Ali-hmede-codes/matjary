import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getMyStories,
  getStories,
  type MyStories,
  type StoryList,
} from '../lib/api';
import {
  STORY_SEEN_STORAGE_KEY,
  markStoriesSeen,
  readSeenStoryIds,
} from '../lib/stories';

/** Live stories for the rail, one shop, or the favorites strip. */
export function useStoryGroups(shopSlugs?: string[], enabled = true) {
  const key = (shopSlugs ?? []).join(',');
  return useQuery<StoryList>({
    queryKey: ['stories', key],
    queryFn: ({ signal }) => getStories(key || undefined, signal),
    enabled,
    // Stories change on publish and after 24 hours, not every second.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Owner slots for the "+" on the shop logo and the dashboard block. */
export function useMyStories(storeSlug: string | null, enabled: boolean) {
  return useQuery<MyStories>({
    queryKey: ['my-stories', storeSlug],
    queryFn: ({ signal }) => getMyStories(storeSlug!, signal),
    enabled: Boolean(storeSlug) && enabled,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Device-local "already watched" ids. Local storage is shared by every tab, so
 * a story opened in one tab quiets the ring in the other.
 */
export function useSeenStories() {
  const [seen, setSeen] = useState<string[]>(() => readSeenStoryIds());
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key === STORY_SEEN_STORAGE_KEY)
        setSeen(readSeenStoryIds());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const markSeen = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setSeen((current) => markStoriesSeen(ids, current));
  }, []);
  return { seen, markSeen };
}
