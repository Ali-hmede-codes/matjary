import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeStoreSlugs } from '../../apps/api/src/modules/showcases/services/feed-explore.service';

test('favorite shop slugs are trimmed, validated and deduplicated', () => {
  assert.deepEqual(
    normalizeStoreSlugs([' cedar-bakery ', 'cedar-bakery', 'blue-fig']),
    ['cedar-bakery', 'blue-fig'],
  );
  assert.deepEqual(normalizeStoreSlugs(['', '   ']), []);
  // Underscores, capitals, spaces and oversized slugs are never trusted.
  assert.deepEqual(
    normalizeStoreSlugs(['bad_slug', 'Bad-Slug', 'a'.repeat(192)]),
    [],
  );
});

test('a favorites request is capped at twelve shops', () => {
  const normalized = normalizeStoreSlugs(
    Array.from({ length: 20 }, (_, index) => `shop-${index}`),
  );
  assert.equal(normalized.length, 12);
  assert.equal(normalized[0], 'shop-0');
  assert.equal(normalized[11], 'shop-11');
});
