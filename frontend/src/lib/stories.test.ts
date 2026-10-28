import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Story, StoryGroup } from './api.ts';
import {
  STORY_IMAGE_DISPLAY_MS,
  STORY_MAX_VIDEO_MS,
  STORY_SEEN_LIMIT,
  STORY_SEEN_STORAGE_KEY,
  liveStories,
  markStoriesSeen,
  readSeenStoryIds,
  storyDisplayMs,
  storyGroupUnseen,
  storyLinkPath,
  storyTimeLabel,
} from './stories.ts';

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-1',
    createdAt: new Date('2026-10-28T10:00:00Z').toISOString(),
    expiresAt: new Date('2026-10-29T10:00:00Z').toISOString(),
    media: {
      id: 'asset-1',
      kind: 'image',
      mimeType: 'image/jpeg',
      width: 1080,
      height: 1920,
      durationMs: null,
      primaryUrl: '/api/v1/uploads/a.jpg',
      posterUrl: null,
    },
    ...overrides,
  };
}

test('image stories hold for five seconds and videos never pass 30 seconds', () => {
  assert.equal(storyDisplayMs(story()), STORY_IMAGE_DISPLAY_MS);
  assert.equal(
    storyDisplayMs(
      story({
        media: { ...story().media, kind: 'video', durationMs: 12_400 },
      }),
    ),
    12_400,
  );
  assert.equal(
    storyDisplayMs(
      story({
        media: { ...story().media, kind: 'video', durationMs: 90_000 },
      }),
    ),
    STORY_MAX_VIDEO_MS,
  );
  assert.equal(
    storyDisplayMs(
      story({ media: { ...story().media, kind: 'video', durationMs: null } }),
    ),
    15_000,
    'a video without metadata still advances',
  );
});

test('expired stories leave the ring and the queue', () => {
  const now = Date.parse('2026-10-29T10:00:01Z');
  const group: StoryGroup = {
    store: {
      id: 'shop',
      name: 'Cedar',
      slug: 'cedar',
      logoKey: null,
      brandColor: null,
      hasVerificationBadge: false,
      verificationBadgeExpiresAt: null,
      businessCategoryLabel: 'Cafe',
    },
    stories: [story(), { ...story(), id: 'story-2' }],
  };
  assert.equal(liveStories(group, now).length, 0);
  assert.equal(
    storyGroupUnseen(group, [], Date.parse('2026-10-28T11:00:00Z')),
    true,
  );
  assert.equal(
    storyGroupUnseen(group, ['story-1', 'story-2'], now),
    false,
    'nothing unseen is left once the stories expired',
  );
});

test('seen ids keep the newest entries and tolerate blocked storage', () => {
  assert.deepEqual(readSeenStoryIds(undefined), []);
  assert.deepEqual(
    readSeenStoryIds({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    }),
    [],
  );
  assert.deepEqual(
    readSeenStoryIds({
      getItem: () => JSON.stringify(['a', 7, null, 'b']),
      setItem: () => undefined,
    }),
    ['a', 'b'],
  );

  let stored = '';
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  };
  assert.deepEqual(markStoriesSeen(['a', 'b'], ['a'], storage), ['a', 'b']);
  assert.equal(stored, JSON.stringify(['a', 'b']));
  assert.equal(STORY_SEEN_STORAGE_KEY, 'matjary:stories:seen');

  const many = Array.from({ length: STORY_SEEN_LIMIT + 20 }, (_, i) => `s${i}`);
  const capped = markStoriesSeen(many, [...many], storage);
  assert.equal(capped.length, STORY_SEEN_LIMIT);
  assert.equal(capped.at(-1), many.at(-1));
  assert.deepEqual(
    markStoriesSeen(['x'], ['x'], {
      getItem: () => '',
      setItem: () => {
        throw new Error('blocked');
      },
    }),
    ['x'],
    'a blocked write still updates the in-memory list',
  );
});

test('story timestamps and links read like the rest of the shop', () => {
  const now = Date.parse('2026-10-28T13:30:00Z');
  assert.equal(storyTimeLabel('2026-10-28T13:29:40Z', now), 'Just now');
  assert.equal(storyTimeLabel('2026-10-28T13:00:00Z', now), '30m');
  assert.equal(storyTimeLabel('2026-10-28T10:30:00Z', now), '3h');
  assert.equal(storyTimeLabel('2026-10-26T10:30:00Z', now), '23h+');
  assert.equal(storyTimeLabel('not-a-date', now), 'Just now');

  assert.equal(
    storyLinkPath(
      {
        type: 'product',
        name: 'Honey jar',
        slug: 'honey-jar',
        priceCents: '1200',
        currency: 'USD',
      },
      'cedar',
    ),
    '/stores/cedar/p/honey-jar',
  );
  assert.equal(
    storyLinkPath(
      {
        type: 'category',
        name: 'Sweet things',
        slug: null,
        priceCents: null,
        currency: null,
      },
      'cedar',
    ),
    '/stores/cedar/c/sweet-things',
  );
  assert.equal(
    storyLinkPath(
      {
        type: 'product',
        name: 'Missing slug',
        slug: null,
        priceCents: null,
        currency: null,
      },
      'cedar',
    ),
    '/stores/cedar',
  );
});
