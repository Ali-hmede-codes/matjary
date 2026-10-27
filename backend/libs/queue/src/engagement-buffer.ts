import { randomUUID } from 'node:crypto';
import type { RedisService } from './redis.service';

export const ENGAGEMENT_DIRTY = 'matjary:eng:dirty';
export interface EngagementBatch {
  id: string;
  likes: Record<string, 'user' | 'visitor'>;
  views: number;
}
export interface EngagementState {
  likes: Record<string, 'user' | 'visitor'>;
  views: number;
  pendingViews: number;
  changed: boolean;
  batch?: EngagementBatch;
}
const stateKey = (postId: string) => `matjary:eng:state:${postId}`;

// One nonexpiring key holds the live state AND immutable in-flight batch.
// Atomic scripts retain concurrent changes and never clear another batch.
const MUTATE = `
local raw = redis.call('GET', KEYS[1])
if not raw then return false end
local s = cjson.decode(raw)
if ARGV[2] == 'like' then
  if s.likes[ARGV[3]] then s.likes[ARGV[3]] = nil else s.likes[ARGV[3]] = ARGV[4] end
elseif ARGV[2] == 'view' then
  if not redis.call('SET', KEYS[3], '1', 'NX', 'EX', ARGV[5]) then return raw end
  s.views = s.views + 1
  s.pendingViews = s.pendingViews + 1
end
s.changed = true
local updated = cjson.encode(s)
redis.call('SET', KEYS[1], updated)
redis.call('SADD', KEYS[2], ARGV[1])
return updated`;
const STAGE = `
local raw = redis.call('GET', KEYS[1])
if not raw then redis.call('SREM', KEYS[2], ARGV[1]); return false end
local s = cjson.decode(raw)
if s.batch then return cjson.encode(s.batch) end
if not s.changed then redis.call('SREM', KEYS[2], ARGV[1]); return false end
s.batch = {id=ARGV[2], likes=s.likes, views=s.pendingViews}
s.pendingViews = 0
s.changed = false
redis.call('SET', KEYS[1], cjson.encode(s))
return cjson.encode(s.batch)`;
const ACK = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local s = cjson.decode(raw)
if not s.batch or s.batch.id ~= ARGV[2] then return 0 end
s.batch = nil
redis.call('SET', KEYS[1], cjson.encode(s))
if not s.changed then redis.call('SREM', KEYS[2], ARGV[1]) end
return 1`;

export async function readEngagement(
  redis: RedisService,
  postId: string,
): Promise<EngagementState | null> {
  const value = await redis.get(stateKey(postId));
  return value ? (JSON.parse(value) as EngagementState) : null;
}

/**
 * Batched variant of readEngagement for feed pages. Missing or malformed
 * entries are simply absent from the map; callers fall back to the durable
 * MySQL counters for those posts.
 */
export async function readEngagementMany(
  redis: RedisService,
  postIds: string[],
): Promise<Map<string, EngagementState>> {
  const states = new Map<string, EngagementState>();
  if (postIds.length === 0) return states;
  const values = await redis.mget(postIds.map(stateKey));
  postIds.forEach((postId, index) => {
    const value = values[index];
    if (!value) return;
    try {
      states.set(postId, JSON.parse(value) as EngagementState);
    } catch {
      // A corrupt entry must not fail the whole feed page.
    }
  });
  return states;
}
export async function hydrateEngagement(
  redis: RedisService,
  postId: string,
  likes: Record<string, 'user' | 'visitor'>,
  views: number,
): Promise<void> {
  await redis.evaluate(
    "return redis.call('SET', KEYS[1], ARGV[1], 'NX')",
    [stateKey(postId)],
    [JSON.stringify({ likes, views, pendingViews: 0, changed: false })],
  );
}
export async function mutateEngagement(
  redis: RedisService,
  postId: string,
  action: 'like' | 'view',
  voterId: string,
  voterType: 'user' | 'visitor',
  dedupeSeconds: number,
): Promise<EngagementState | null> {
  const result = await redis.evaluate(
    MUTATE,
    [
      stateKey(postId),
      ENGAGEMENT_DIRTY,
      `matjary:eng:seen:${postId}:${voterType}:${voterId}`,
    ],
    [postId, action, voterId, voterType, String(dedupeSeconds)],
  );
  return typeof result === 'string'
    ? (JSON.parse(result) as EngagementState)
    : null;
}
export async function stageEngagement(
  redis: RedisService,
  postId: string,
): Promise<EngagementBatch | null> {
  const result = await redis.evaluate(
    STAGE,
    [stateKey(postId), ENGAGEMENT_DIRTY],
    [postId, randomUUID()],
  );
  return typeof result === 'string'
    ? (JSON.parse(result) as EngagementBatch)
    : null;
}
export async function acknowledgeEngagement(
  redis: RedisService,
  postId: string,
  batchId: string,
): Promise<void> {
  await redis.evaluate(
    ACK,
    [stateKey(postId), ENGAGEMENT_DIRTY],
    [postId, batchId],
  );
}

/**
 * Drops the buffered state of a post that no longer exists. The flusher locks
 * the post row before staging, so a leftover dirty member would make every
 * engagement flush retry a deleted post forever.
 */
export async function forgetEngagement(
  redis: RedisService,
  postId: string,
): Promise<void> {
  await redis.evaluate(
    "redis.call('DEL', KEYS[1]); redis.call('SREM', KEYS[2], ARGV[1])",
    [stateKey(postId), ENGAGEMENT_DIRTY],
    [postId],
  );
}
