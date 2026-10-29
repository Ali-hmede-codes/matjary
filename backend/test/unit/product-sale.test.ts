import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  PRODUCT_SALE_PRICE_INVALID_CODE,
  normalizeCompareAtPriceCents,
} from '../../libs/database/src/product-sale';

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof BadRequestException)) return undefined;
  const response = error.getResponse();
  return response && typeof response === 'object'
    ? (response as { code?: string }).code
    : undefined;
}

test('a sale keeps the old price above the amount shoppers pay', () => {
  assert.equal(normalizeCompareAtPriceCents(undefined, 1000), null);
  assert.equal(normalizeCompareAtPriceCents(null, 1000), null);
  assert.equal(normalizeCompareAtPriceCents(2000, 1000), '2000');
  // The stored price is a BIGINT string, and the check must not lose precision.
  assert.equal(
    normalizeCompareAtPriceCents('9007199254740991', '1'),
    '9007199254740991',
  );
});

test('an old price that is not a discount is refused with a safe code', () => {
  for (const value of [1000, 999, 0]) {
    assert.throws(
      () => normalizeCompareAtPriceCents(value, 1000),
      (error: unknown) => errorCode(error) === PRODUCT_SALE_PRICE_INVALID_CODE,
    );
  }
  // The refusal never echoes the amounts the owner typed.
  assert.throws(
    () => normalizeCompareAtPriceCents(500, 1000),
    (error: unknown) => {
      assert.equal(
        String((error as BadRequestException).message).includes('500'),
        false,
      );
      return true;
    },
  );
});
