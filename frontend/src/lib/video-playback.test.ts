import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isFeedPlaybackSuspended,
  resumeFeedPlayback,
  subscribeFeedPlayback,
  suspendFeedPlayback,
} from './video-playback.ts';

test('viewer suspension pauses feed clips until every overlay closes', () => {
  let notified = 0;
  const unsubscribe = subscribeFeedPlayback(() => {
    notified += 1;
  });

  assert.equal(isFeedPlaybackSuspended(), false);
  suspendFeedPlayback();
  assert.equal(isFeedPlaybackSuspended(), true);
  // Overlays can nest (viewer over a shop page); closing one must not resume
  // the feed while another is still open.
  suspendFeedPlayback();
  resumeFeedPlayback();
  assert.equal(isFeedPlaybackSuspended(), true);
  resumeFeedPlayback();
  assert.equal(isFeedPlaybackSuspended(), false);
  // Unbalanced resumes cannot park the feed in a suspended state forever.
  resumeFeedPlayback();
  assert.equal(isFeedPlaybackSuspended(), false);

  assert.equal(notified, 5);
  unsubscribe();
  suspendFeedPlayback();
  assert.equal(notified, 5);
  resumeFeedPlayback();
});
