import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFavoriteShopIds,
  toggleFavoriteShopIds,
  writeFavoriteShopIds,
} from './favorites.ts';

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

test('favorite shops tolerate blocked storage and malformed data', () => {
  assert.deepEqual(
    readFavoriteShopIds({
      getItem: () => {
        throw new Error('blocked');
      },
    }),
    [],
  );
  assert.deepEqual(readFavoriteShopIds({ getItem: () => '{broken' }), []);
  assert.deepEqual(readFavoriteShopIds({ getItem: () => '{"a":1}' }), []);
  assert.deepEqual(
    readFavoriteShopIds({
      getItem: () => JSON.stringify([id(1), id(1), 'draft', null, 7, id(2)]),
    }),
    [id(1), id(2)],
  );
  assert.equal(
    readFavoriteShopIds({
      getItem: () =>
        JSON.stringify(Array.from({ length: 600 }, (_, i) => id(i))),
    }).length,
    500,
  );
});

test('favorite writes keep only valid shop ids and report blocked storage', () => {
  let stored = '';
  assert.equal(
    writeFavoriteShopIds(
      {
        setItem: (_key, value) => {
          stored = value;
        },
      },
      [id(3), 'bad-id', id(3)],
    ),
    true,
  );
  assert.equal(stored, JSON.stringify([id(3)]));
  assert.equal(
    writeFavoriteShopIds(
      {
        setItem: () => {
          throw new Error('blocked');
        },
      },
      [id(1)],
    ),
    false,
  );
});

test('toggling a favorite appends it once and removes it later', () => {
  assert.deepEqual(toggleFavoriteShopIds([id(1)], id(2)), [id(1), id(2)]);
  assert.deepEqual(toggleFavoriteShopIds([id(1), id(2)], id(1)), [id(2)]);
  assert.deepEqual(toggleFavoriteShopIds([id(1)], id(1)), []);
  // Demo shops use synthetic ids, so an invalid id must change nothing.
  assert.deepEqual(toggleFavoriteShopIds([], 'not-a-shop-id'), []);
});
