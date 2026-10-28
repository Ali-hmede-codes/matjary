// Stable, non-sensitive business codes the API may return for subscription
// state. The exception filter passes only allowlisted values through, so
// adding a code here deliberately makes it client-visible.
import { STORY_LIMIT_CODE, STORY_OFFLINE_CODE } from './story-policy';

export const TRIAL_EXPIRED_CODE = 'TRIAL_EXPIRED';
export const FREE_TRIAL_CAP_CODE = 'FREE_TRIAL_CAP';
// A content section the owner turned off cannot receive new content.
export const SECTION_DISABLED_CODE = 'SECTION_DISABLED';
// Turning a section back on needs at least one free slot in the shared pool.
export const SECTION_NO_ROOM_CODE = 'SECTION_NO_ROOM';
// A shop must keep at least one of its two content sections on.
export const SECTION_LAST_ENABLED_CODE = 'SECTION_LAST_ENABLED';

export const SAFE_SUBSCRIPTION_CODES: ReadonlySet<string> = new Set([
  TRIAL_EXPIRED_CODE,
  FREE_TRIAL_CAP_CODE,
  SECTION_DISABLED_CODE,
  SECTION_NO_ROOM_CODE,
  SECTION_LAST_ENABLED_CODE,
  // Story slot and shop-state conflicts drive the composer copy.
  STORY_LIMIT_CODE,
  STORY_OFFLINE_CODE,
]);
