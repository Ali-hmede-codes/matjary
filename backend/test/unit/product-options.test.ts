import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  PRODUCT_OPTIONS_INVALID_CODE,
  normalizeProductOptions,
  normalizeSelectedOptions,
  selectedOptionsKey,
} from '../../libs/database/src/product-options';

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof BadRequestException)) return undefined;
  const response = error.getResponse();
  return response && typeof response === 'object'
    ? (response as { code?: string }).code
    : undefined;
}

test('product options trim, de-duplicate, and preserve owner order', () => {
  assert.equal(normalizeProductOptions(null), null);
  assert.equal(normalizeProductOptions([]), null);
  assert.deepEqual(
    normalizeProductOptions([
      { name: '  Size ', values: [' Small ', 'Medium', 'small', ''] },
      { name: 'Color', values: ['Red', 'Blue'] },
    ]),
    [
      { name: 'Size', values: ['Small', 'Medium'] },
      { name: 'Color', values: ['Red', 'Blue'] },
    ],
  );
});

test('invalid option groups fail with a stable product-options code', () => {
  const invalidGroups = [
    [{ name: ' ', values: ['Small'] }],
    [{ name: 'Size', values: [] }],
    [
      { name: 'Size', values: ['Small'] },
      { name: 'size', values: ['Medium'] },
    ],
    [{ name: 'Size', values: [' '] }],
    [{ name: 'S'.repeat(61), values: ['Small'] }],
    [{ name: 'Size', values: Array.from({ length: 26 }, (_, i) => `S${i}`) }],
  ];
  for (const groups of invalidGroups) {
    assert.throws(
      () => normalizeProductOptions(groups),
      (error) => errorCode(error) === PRODUCT_OPTIONS_INVALID_CODE,
    );
  }
});

test('selected options must match every current group and value', () => {
  const groups = [
    { name: 'Size', values: ['S', 'M'] },
    { name: 'Color', values: ['Red', 'Blue'] },
  ];
  const selected = normalizeSelectedOptions(groups, [
    { name: 'Color', value: 'Blue' },
    { name: 'Size', value: 'M' },
  ]);
  assert.deepEqual(selected, [
    { name: 'Size', value: 'M' },
    { name: 'Color', value: 'Blue' },
  ]);
  assert.equal(
    selectedOptionsKey(selected),
    JSON.stringify([
      ['Size', 'M'],
      ['Color', 'Blue'],
    ]),
  );
  assert.equal(selectedOptionsKey(null), '');
  assert.equal(normalizeSelectedOptions(null, null), null);

  for (const invalid of [
    null,
    [{ name: 'Size', value: 'M' }],
    [
      { name: 'Size', value: 'XL' },
      { name: 'Color', value: 'Blue' },
    ],
    [
      { name: 'Size', value: 'M' },
      { name: 'Size', value: 'S' },
      { name: 'Color', value: 'Blue' },
    ],
  ]) {
    assert.throws(
      () => normalizeSelectedOptions(groups, invalid as never),
      (error) => errorCode(error) === PRODUCT_OPTIONS_INVALID_CODE,
    );
  }
  assert.throws(
    () => normalizeSelectedOptions(null, [{ name: 'Size', value: 'M' }]),
    (error) => errorCode(error) === PRODUCT_OPTIONS_INVALID_CODE,
  );
});
