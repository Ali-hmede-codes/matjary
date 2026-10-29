import { BadRequestException } from '@nestjs/common';

// Client-visible code: the owner panel explains the refusal in plain words.
export const PRODUCT_SALE_PRICE_INVALID_CODE = 'PRODUCT_SALE_PRICE_INVALID';

/**
 * Normalises the optional "was" price of an item on sale.
 *
 * `price_cents` stays the only amount a shopper pays, so the compare-at value
 * must stay strictly above it. Anything else is refused instead of silently
 * ignored: a published discount that is not a discount would mislead shoppers.
 * `null` (or nothing) ends the sale.
 */
export function normalizeCompareAtPriceCents(
  compareAtPriceCents: number | string | null | undefined,
  priceCents: number | string,
): string | null {
  if (compareAtPriceCents === null || compareAtPriceCents === undefined)
    return null;
  const compare = BigInt(compareAtPriceCents);
  if (compare <= BigInt(priceCents)) {
    throw new BadRequestException({
      code: PRODUCT_SALE_PRICE_INVALID_CODE,
      message: 'The old price must be higher than the current price',
    });
  }
  return compare.toString();
}
