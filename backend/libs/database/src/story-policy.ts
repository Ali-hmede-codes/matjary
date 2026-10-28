import { MoreThan, type EntityManager } from 'typeorm';
import { StoreStory } from './entities';

// A story is a single photo or short video that disappears 24 hours after it
// is published. Nothing about the row is monthly: the plan quota counts live
// stories only, so a deletion or an expiry hands the slot back immediately.
export const STORY_TTL_HOURS = 24;
export const STORY_TTL_MS = STORY_TTL_HOURS * 3_600_000;
// The platform ceiling is fixed; a plan can only make it shorter.
export const STORY_MAX_DURATION_SECONDS = 30;
// Images carry no duration, so the viewer shows them for a fixed beat.
export const STORY_IMAGE_DISPLAY_MS = 5000;

export function storyExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + STORY_TTL_MS);
}

// Business codes the storefront can translate without reading server messages.
export const STORY_LIMIT_CODE = 'STORY_LIMIT';
export const STORY_OFFLINE_CODE = 'STORY_STORE_OFFLINE';

export function liveStoryWhere(now = new Date()) {
  return { expiresAt: MoreThan(now) };
}

export async function liveStoryCount(
  manager: EntityManager,
  storeId: string,
  now = new Date(),
): Promise<number> {
  return manager.count(StoreStory, {
    where: { storeId, ...liveStoryWhere(now) },
  });
}
