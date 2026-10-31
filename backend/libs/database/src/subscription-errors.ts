// Stable, non-sensitive business codes the API may return for subscription
// state. The exception filter passes only allowlisted values through, so
// adding a code here deliberately makes it client-visible.
import { STORY_LIMIT_CODE, STORY_OFFLINE_CODE } from './story-policy';

export const TRIAL_EXPIRED_CODE = 'TRIAL_EXPIRED';
export const FREE_TRIAL_CAP_CODE = 'FREE_TRIAL_CAP';
// The plan grace window ended and the shop is locked: hidden from shoppers and
// limited to its renewal page until an administrator confirms the renewal.
export const SHOP_RENEWAL_REQUIRED_CODE = 'SHOP_RENEWAL_REQUIRED';
// A content section the owner turned off cannot receive new content.
export const SECTION_DISABLED_CODE = 'SECTION_DISABLED';
// Turning a section back on needs at least one free slot in the shared pool.
export const SECTION_NO_ROOM_CODE = 'SECTION_NO_ROOM';
// A shop must keep at least one of its two content sections on.
export const SECTION_LAST_ENABLED_CODE = 'SECTION_LAST_ENABLED';
// An administrator can hand a shop over only to an account that can hold it:
// no live subscription, or a plan whose shop slots are all taken, is refused.
export const OWNER_PLAN_INACTIVE_CODE = 'OWNER_PLAN_INACTIVE';
export const OWNER_PLAN_FULL_CODE = 'OWNER_PLAN_FULL';

export const SAFE_SUBSCRIPTION_CODES: ReadonlySet<string> = new Set([
  TRIAL_EXPIRED_CODE,
  FREE_TRIAL_CAP_CODE,
  // Locked-shop writes drive the "Renew to open your shop" screen.
  SHOP_RENEWAL_REQUIRED_CODE,
  SECTION_DISABLED_CODE,
  SECTION_NO_ROOM_CODE,
  SECTION_LAST_ENABLED_CODE,
  // Story slot and shop-state conflicts drive the composer copy.
  STORY_LIMIT_CODE,
  STORY_OFFLINE_CODE,
  // Ownership transfer refusals drive the admin owner-picker copy.
  OWNER_PLAN_INACTIVE_CODE,
  OWNER_PLAN_FULL_CODE,
]);
