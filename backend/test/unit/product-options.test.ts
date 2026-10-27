import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  PRODUCT_OPTIONS_INVALID_CODE,
  normalizeProductOptions,
  normalizeSelectedOptions,
  productFromPriceCents,
  readProductOptions,
  resolveOptionUnitPriceCents,
  selectedOptionsKey,
} from '../../libs/database/src/product-options';

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof BadRequestException)) return undefined;
  const response = error.getResponse();
  return response && typeof response === 'object'
    ? (response as { code?: string }).code
    : undefined;
}

test('option values trim, keep order, and carry optional own prices', () => {
  assert.equal(normalizeProductOptions(null), null);
  assert.equal(normalizeProductOptions([]), null);
  assert.deepEqual(
    normalizeProductOptions([
      {
        name: '  Size ',
        values: [
          ' Small ',
          { label: ' Medium ', priceCents: 250 },
          { label: 'Large', priceCents: null },
          { label: 'XL', priceCents: '300' },
        ],
      },
      {
        name: 'Color',
        values: ['Red', { label: 'Blue', priceCents: 0 }],
      },
    ]),
    [
      {
        name: 'Size',
        values: [
          { label: 'Small', priceCents: null },
          { label: 'Medium', priceCents: '250' },
          { label: 'Large', priceCents: null },
          { label: 'XL', priceCents: '300' },
        ],
      },
      {
        name: 'Color',
        values: [
          { label: 'Red', priceCents: null },
          { label: 'Blue', priceCents: null },
        ],
      },
    ],
  );
});

test('legacy string values read as options without extra prices', () => {
  assert.deepEqual(
    readProductOptions([
      { name: 'Size', values: ['S', 'M'] },
      {
        name: 'Color',
        values: [{ label: 'Blue', priceCents: '150' }],
      },
    ]),
    [
      {
        name: 'Size',
        values: [
          { label: 'S', priceCents: null },
          { label: 'M', priceCents: null },
        ],
      },
      {
        name: 'Color',
        values: [{ label: 'Blue', priceCents: '150' }],
      },
    ],
  );
  assert.equal(readProductOptions('not options'), null);
  assert.equal(readProductOptions([{ name: ' ', values: ['S'] }]), null);
  assert.deepEqual(
    readProductOptions([
      { name: 'Size', values: ['S', { label: '' }, { label: 'M' }] },
      { name: '', values: ['ignored'] },
    ]),
    [
      {
        name: 'Size',
        values: [
          { label: 'S', priceCents: null },
          { label: 'M', priceCents: null },
        ],
      },
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
    [{ name: 'Size', values: ['Small', 'small'] }],
    [{ name: 'Size', values: [{ label: 'Small', priceCents: -1 }] }],
    [{ name: 'Size', values: [{ label: 'Small', priceCents: 1.5 }] }],
    [
      { name: 'Size', values: [{ label: 'Small', priceCents: 1000 }] },
      { name: 'Color', values: [{ label: 'Blue', priceCents: 100 }] },
    ],
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
    {
      name: 'Size',
      values: [
        { label: 'S', priceCents: null },
        { label: 'M', priceCents: '250' },
      ],
    },
    {
      name: 'Color',
      values: [
        { label: 'Red', priceCents: null },
        { label: 'Blue', priceCents: '100' },
      ],
    },
  ];
  const selected = normalizeSelectedOptions(groups, [
    { name: 'Color', value: 'Blue' },
    { name: 'Size', value: 'M' },
  ]);
  assert.deepEqual(selected, [
    { name: 'Size', value: 'M', priceCents: '250' },
    { name: 'Color', value: 'Blue', priceCents: '100' },
  ]);
  assert.equal(
    selectedOptionsKey(selected),
    JSON.stringify([
      ['Size', 'M', '250'],
      ['Color', 'Blue', '100'],
    ]),
  );
  assert.equal(selectedOptionsKey(null), '');
  assert.equal(normalizeSelectedOptions(null, null), null);

  // The request may include extra fields; the server still uses product prices.
  assert.deepEqual(
    normalizeSelectedOptions(groups, [
      { name: 'Size', value: 'M', priceCents: '1' },
      { name: 'Color', value: 'Blue', priceCents: '1' },
    ] as never),
    selected,
  );

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

test('selected options accept legacy product options from older rows', () => {
  assert.deepEqual(
    normalizeSelectedOptions(
      [{ name: 'Size', values: ['S', 'M'] }],
      [{ name: 'Size', value: 'M' }],
    ),
    [{ name: 'Size', value: 'M', priceCents: null }],
  );
});

test('a chosen value price replaces the base price', () => {
  const selection = [
    { name: 'Size', value: 'M', priceCents: '1500' },
    { name: 'Color', value: 'Blue', priceCents: null },
  ];
  assert.equal(resolveOptionUnitPriceCents('1000', selection), '1500');
  assert.equal(resolveOptionUnitPriceCents('1000', null), '1000');
  assert.equal(
    resolveOptionUnitPriceCents('1000', [
      { name: 'Size', value: 'S', priceCents: null },
    ]),
    '1000',
  );
});

test('catalogue from-price ignores a base price no selection can reach', () => {
  const sizes = [
    {
      name: 'Size',
      values: [
        { label: 'Small', priceCents: '1000' },
        { label: 'Medium', priceCents: '1500' },
        { label: 'Large', priceCents: '2000' },
      ],
    },
  ];
  assert.equal(productFromPriceCents('0', sizes), '1000');
  // An unpriced value can still fall back to the base price.
  assert.equal(
    productFromPriceCents('900', [
      {
        name: 'Size',
        values: [
          { label: 'Small', priceCents: null },
          { label: 'Large', priceCents: '2000' },
        ],
      },
    ]),
    '900',
  );
  assert.equal(productFromPriceCents('1250', null), '1250');
});
