// Pure ranking helpers for the discovery feed. Keeping the math here makes the
// "small algorithm" explainable and unit-testable without a database.

export interface RankableStore {
  brandColor?: string | null;
  logoKey?: string | null;
  businessCategory?: string | null;
  location?: {
    latitude?: number | null;
    longitude?: number | null;
  } | null;
}

export interface RankableFeedItem {
  id?: string;
  storeId?: string | null;
  publishedAt?: Date | null;
  engagement: { likes: number; views: number };
  media: { kind: string }[];
  store?: RankableStore | null;
}

export interface ExploreRankContext {
  latitude?: number;
  longitude?: number;
  /** Likes accumulated per business category for the current viewer. */
  affinity?: ReadonlyMap<string, number>;
  distanceKm?: (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) => number;
  /** Injectable clock so tests stay deterministic. */
  now?: number;
}

function hoursSince(publishedAt: Date | null | undefined, now: number): number {
  if (!publishedAt) return 0;
  const value = new Date(publishedAt).getTime();
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, (now - value) / (1000 * 60 * 60));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Mixed "For you" score: freshness, engagement quality, media richness, shop
 * completeness, distance and a small boost for categories the viewer liked.
 */
export function exploreScore(
  item: RankableFeedItem,
  context: ExploreRankContext = {},
): number {
  const now = context.now ?? Date.now();
  const hours = hoursSince(item.publishedAt, now);
  let score = Math.max(0, 40 - hours * 1.5);

  const engagementRate =
    item.engagement.views > 0
      ? item.engagement.likes / item.engagement.views
      : 0;
  score += Math.min(35, engagementRate * 100 + item.engagement.likes * 2);

  if (item.media.length > 0) {
    score += item.media.some((media) => media.kind === 'video') ? 10 : 5;
    if (item.media.length > 1) score += 5;
  }

  if (item.store) {
    if (item.store.brandColor) score += 2;
    if (item.store.logoKey) score += 3;
    if (
      item.store.location?.latitude !== undefined &&
      item.store.location.latitude !== null
    )
      score += 5;
  }

  const latitude = item.store?.location?.latitude;
  const longitude = item.store?.location?.longitude;
  if (
    context.latitude !== undefined &&
    context.longitude !== undefined &&
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    context.distanceKm
  ) {
    const distance = context.distanceKm(
      context.latitude,
      context.longitude,
      latitude,
      longitude,
    );
    score += Math.max(0, 15 - distance);
  }

  // A familiar category is a nudge, never a filter. Capped so one affinity
  // cannot bury every fresh discovery.
  const category = item.store?.businessCategory;
  const affinityCount = category ? (context.affinity?.get(category) ?? 0) : 0;
  if (affinityCount > 0) score += Math.min(20, 8 + affinityCount * 3);

  return round(score, 2);
}

/** Engagement velocity inside a freshness window (72 hours by default). */
export function trendingScore(
  item: RankableFeedItem,
  now = Date.now(),
  maxAgeHours = 72,
): number {
  const hours = hoursSince(item.publishedAt, now);
  if (hours > maxAgeHours) return 0;
  const velocity =
    (item.engagement.likes + item.engagement.views * 0.05) / Math.max(1, hours);
  return round(velocity, 3);
}

/** All-time engagement weight. */
export function popularityScore(item: RankableFeedItem): number {
  return round(item.engagement.likes * 2 + item.engagement.views * 0.1, 2);
}

/** Newest-first weight. */
export function recencyScore(item: RankableFeedItem, now = Date.now()): number {
  return Math.max(0, 1000 - hoursSince(item.publishedAt, now));
}

/** Distance plus freshness for the nearby algorithm. */
export function nearbyScore(
  item: RankableFeedItem,
  latitude: number,
  longitude: number,
  distanceKm: (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) => number,
  now = Date.now(),
): number {
  const itemLatitude = item.store?.location?.latitude;
  const itemLongitude = item.store?.location?.longitude;
  if (typeof itemLatitude !== 'number' || typeof itemLongitude !== 'number')
    return 0;
  const distance = distanceKm(latitude, longitude, itemLatitude, itemLongitude);
  return round(
    100 - distance * 2 + (100 - hoursSince(item.publishedAt, now)),
    2,
  );
}

/** Shop-page feed weight: strong freshness plus engagement. */
export function storeFeedScore(
  item: RankableFeedItem,
  now = Date.now(),
): number {
  const hours = hoursSince(item.publishedAt, now);
  let score = Math.max(0, 60 - hours * 3);
  score += item.engagement.likes * 4;
  score += item.engagement.views * 0.3;
  if (item.media.length > 0) {
    score += item.media.some((media) => media.kind === 'video') ? 20 : 15;
  }
  return round(score, 2);
}

/**
 * Reorders without dropping anything so one shop cannot occupy a whole page.
 * When a run of two posts from the same shop is reached, the next available
 * post from another shop is pulled forward.
 */
export function diversifyByStore<T extends { storeId?: string | null }>(
  items: readonly T[],
  maxStreak = 2,
): T[] {
  if (maxStreak < 1 || items.length < 2) return [...items];

  const remaining = [...items];
  const result: T[] = [];
  let lastStoreId: string | null | undefined;
  let streak = 0;

  while (remaining.length > 0) {
    let index = 0;
    if (streak >= maxStreak && lastStoreId) {
      const alternative = remaining.findIndex(
        (item) => item.storeId !== lastStoreId,
      );
      if (alternative >= 0) index = alternative;
    }
    const next = remaining.splice(index, 1)[0];
    if (!next) break;

    if (next.storeId && next.storeId === lastStoreId) {
      streak += 1;
    } else {
      lastStoreId = next.storeId;
      streak = 1;
    }
    result.push(next);
  }

  return result;
}
