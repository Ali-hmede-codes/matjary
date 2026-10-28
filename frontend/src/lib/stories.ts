import type { Story, StoryGroup, StoryLink } from './api.ts';
import {
  categorySlug,
  storeCategoryPath,
  storePath,
  storeProductPath,
} from './storefront.ts';

// Images carry no duration, so the viewer shows them for a fixed beat. Videos
// follow their own length, capped by the platform's 30-second story ceiling.
export const STORY_IMAGE_DISPLAY_MS = 5000;
export const STORY_MAX_VIDEO_MS = 30_000;
export const STORY_VIDEO_FALLBACK_MS = 15_000;

// Seen state is per browser, like favorites and saved posts: the ring turns
// quiet on this device once every live story of a shop was watched.
export const STORY_SEEN_STORAGE_KEY = 'matjary:stories:seen';
export const STORY_SEEN_LIMIT = 200;

export function storyDisplayMs(story: Story): number {
  if (story.media.kind !== 'video') return STORY_IMAGE_DISPLAY_MS;
  const duration = story.media.durationMs;
  return Math.min(
    typeof duration === 'number' && duration > 0
      ? duration
      : STORY_VIDEO_FALLBACK_MS,
    STORY_MAX_VIDEO_MS,
  );
}

/** Drops stories whose 24 hours ended while the page was open. */
export function liveStories(group: StoryGroup, now = Date.now()): Story[] {
  return group.stories.filter((story) => Date.parse(story.expiresAt) > now);
}

/** True while at least one live story of the shop was never opened here. */
export function storyGroupUnseen(
  group: StoryGroup,
  seen: readonly string[],
  now = Date.now(),
): boolean {
  return liveStories(group, now).some((story) => !seen.includes(story.id));
}

export type StoryStorage = Pick<Storage, 'getItem' | 'setItem'>;

function storyStorage(): StoryStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readSeenStoryIds(
  storage: StoryStorage | undefined = storyStorage(),
): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORY_SEEN_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    // Private modes and corrupted values simply start fresh.
    return [];
  }
}

export function markStoriesSeen(
  ids: readonly string[],
  current: readonly string[] = readSeenStoryIds(),
  storage: StoryStorage | undefined = storyStorage(),
): string[] {
  const merged = [...current.filter((id) => !ids.includes(id)), ...ids];
  const next = merged.slice(-STORY_SEEN_LIMIT);
  try {
    storage?.setItem(STORY_SEEN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Storage is optional; the ring simply stays unseen. */
  }
  return next;
}

export function storyTimeLabel(createdAt: string, now = Date.now()): string {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return 'Just now';
  const minutes = Math.max(0, Math.floor((now - created) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : '23h+';
}

/** One story link resolves to the shop's product or section page. */
export function storyLinkPath(link: StoryLink, shopSlug: string): string {
  if (link.type === 'product')
    return link.slug
      ? storeProductPath(shopSlug, link.slug)
      : storePath(shopSlug);
  return storeCategoryPath(shopSlug, categorySlug(link.name));
}
