import { BadRequestException } from '@nestjs/common';

// Product choices are small owner-defined lists (size, color, ...). A value may
// carry its own price that replaces the product's base price (small $10, medium
// $15, large $20); values without a price fall back to the base price. Prices
// are stored as BIGINT strings so cents never pass through JavaScript floating
// point, and a cart line snapshots the chosen values plus their prices.
export interface ProductOptionValue {
  label: string;
  priceCents: string | null;
}

export interface ProductOptionGroup {
  name: string;
  values: ProductOptionValue[];
}

export interface SelectedProductOption {
  name: string;
  value: string;
  priceCents: string | null;
}

// Writes may still arrive with legacy string values, e.g. ["S", "M"].
export type ProductOptionValueInput =
  | string
  | {
      label?: unknown;
      name?: unknown;
      value?: unknown;
      priceCents?: unknown;
    };

export interface ProductOptionGroupInput {
  name: string;
  values: readonly ProductOptionValueInput[];
}

export const PRODUCT_OPTIONS_INVALID_CODE = 'PRODUCT_OPTIONS_INVALID';
export const PRODUCT_SLUG_TAKEN_CODE = 'PRODUCT_SLUG_TAKEN';

export const MAX_PRODUCT_OPTION_GROUPS = 10;
export const MAX_PRODUCT_OPTION_VALUES = 25;
export const MAX_PRODUCT_OPTION_NAME = 60;
export const MAX_PRODUCT_OPTION_VALUE = 80;

function invalid(message: string): never {
  throw new BadRequestException({
    code: PRODUCT_OPTIONS_INVALID_CODE,
    message,
  });
}

function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function parsePriceCents(value: unknown): bigint | null {
  if (value === undefined || value === null || value === '') return 0n;
  let parsed: bigint | null = null;
  if (typeof value === 'number') {
    parsed = Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  } else if (typeof value === 'string' && /^\d+$/u.test(value.trim())) {
    parsed = BigInt(value.trim());
  }
  return parsed !== null && parsed <= BigInt(Number.MAX_SAFE_INTEGER)
    ? parsed
    : null;
}

/**
 * Accepts the current object shape and the earlier string-only shape. Returning
 * null marks a value that cannot be used, which the strict writer rejects and
 * the lenient reader silently drops.
 */
function readOptionValue(raw: unknown): ProductOptionValue | null {
  let label: unknown;
  let rawPrice: unknown;
  if (typeof raw === 'string') {
    label = raw;
  } else if (raw && typeof raw === 'object') {
    const value = raw as Record<string, unknown>;
    label = value.label ?? value.name ?? value.value;
    rawPrice = value.priceCents;
  } else {
    return null;
  }
  if (typeof label !== 'string') return null;
  const cleanLabel = cleanText(label);
  if (!cleanLabel || cleanLabel.length > MAX_PRODUCT_OPTION_VALUE) return null;
  const price = parsePriceCents(rawPrice);
  if (price === null) return null;
  return {
    label: cleanLabel,
    // Zero means "use the base price"; keep the stored JSON compact.
    priceCents: price > 0n ? price.toString() : null,
  };
}

/**
 * Reads options from the database. Legacy string values become values without
 * their own price, and malformed groups are dropped instead of breaking a
 * public product page. Writes use normalizeProductOptions below.
 */
export function readProductOptions(
  input: unknown,
): ProductOptionGroup[] | null {
  if (!Array.isArray(input)) return null;
  const groups: ProductOptionGroup[] = [];
  const names = new Set<string>();
  for (const rawGroup of input.slice(0, MAX_PRODUCT_OPTION_GROUPS)) {
    if (!rawGroup || typeof rawGroup !== 'object') continue;
    const record = rawGroup as { name?: unknown; values?: unknown };
    if (typeof record.name !== 'string') continue;
    const name = cleanText(record.name);
    if (!name || name.length > MAX_PRODUCT_OPTION_NAME) continue;
    const nameKey = name.toLocaleLowerCase('en-US');
    if (names.has(nameKey) || !Array.isArray(record.values)) continue;

    const values: ProductOptionValue[] = [];
    const seen = new Set<string>();
    for (const rawValue of record.values.slice(0, MAX_PRODUCT_OPTION_VALUES)) {
      const value = readOptionValue(rawValue);
      if (!value) continue;
      const valueKey = value.label.toLocaleLowerCase('en-US');
      if (seen.has(valueKey)) continue;
      seen.add(valueKey);
      values.push(value);
    }
    if (!values.length) continue;
    names.add(nameKey);
    groups.push({ name, values });
  }
  return groups.length ? groups : null;
}

/**
 * Trims, de-duplicates, and bounds owner-supplied option groups. Invalid input
 * fails with a stable code so the panel can explain the problem without
 * exposing validation internals.
 */
export function normalizeProductOptions(
  input: readonly ProductOptionGroupInput[] | null | undefined,
): ProductOptionGroup[] | null {
  if (!input?.length) return null;
  if (input.length > MAX_PRODUCT_OPTION_GROUPS)
    invalid(`A product can have at most ${MAX_PRODUCT_OPTION_GROUPS} options`);
  const groups: ProductOptionGroup[] = [];
  const names = new Set<string>();
  // Unit price is resolved from the first priced selection, so two priced
  // groups would make the result depend on option order. Reject that instead.
  let pricedGroup: string | null = null;
  for (const group of input) {
    if (
      !group ||
      typeof group.name !== 'string' ||
      !Array.isArray(group.values)
    )
      invalid('Product options are invalid');
    const name = cleanText(group.name);
    if (!name || name.length > MAX_PRODUCT_OPTION_NAME)
      invalid(
        `Option names must be 1-${MAX_PRODUCT_OPTION_NAME} characters long`,
      );
    const nameKey = name.toLocaleLowerCase('en-US');
    if (names.has(nameKey)) invalid('Option names must be unique');
    names.add(nameKey);

    const values: ProductOptionValue[] = [];
    const seen = new Set<string>();
    for (const raw of group.values) {
      const value = readOptionValue(raw);
      if (!value)
        invalid('Each option value needs a label and a non-negative price');
      const valueKey = value.label.toLocaleLowerCase('en-US');
      if (seen.has(valueKey)) invalid('Option value labels must be unique');
      seen.add(valueKey);
      values.push(value);
    }
    if (!values.length) invalid('Each option needs at least one value');
    if (values.length > MAX_PRODUCT_OPTION_VALUES)
      invalid(
        `Each option can have at most ${MAX_PRODUCT_OPTION_VALUES} values`,
      );
    if (values.some((value) => value.priceCents !== null)) {
      if (pricedGroup !== null)
        invalid(
          'Only one option can set its own prices; leave the other options blank',
        );
      pricedGroup = name;
    }
    groups.push({ name, values });
  }
  return groups;
}

/**
 * Validates a shopper's choice against the product's current options and
 * returns it in the product's group order. Prices always come from the
 * product, never from the request, so a client cannot choose its own price.
 */
export function normalizeSelectedOptions(
  productOptions: unknown,
  input: readonly { name: string; value: string }[] | null | undefined,
): SelectedProductOption[] | null {
  const groups = readProductOptions(productOptions) ?? [];
  if (!groups.length) {
    if (input?.length) invalid('This product does not have options');
    return null;
  }
  if (!input?.length) invalid('Choose a value for each option');
  if (input.length > MAX_PRODUCT_OPTION_GROUPS)
    invalid('Too many selected options');

  const chosen = new Map<string, string>();
  for (const option of input) {
    if (
      !option ||
      typeof option.name !== 'string' ||
      typeof option.value !== 'string'
    )
      invalid('The selected options are invalid');
    const name = cleanText(option.name);
    const value = cleanText(option.value);
    const key = name.toLocaleLowerCase('en-US');
    if (!name || !value || chosen.has(key))
      invalid('Choose exactly one value for each option');
    chosen.set(key, value);
  }
  if (chosen.size !== groups.length) invalid('Choose a value for each option');

  return groups.map((group) => {
    const value = chosen.get(group.name.toLocaleLowerCase('en-US'));
    const optionValue = group.values.find((entry) => entry.label === value);
    if (!value || !optionValue) invalid('The selected option is not available');
    return {
      name: group.name,
      value: optionValue.label,
      priceCents: optionValue.priceCents,
    };
  });
}

/**
 * A chosen value with its own price replaces the product's base price; an
 * unpriced value keeps the base price. Writes allow only one priced group, so
 * the first priced selection is unambiguous. The client mirrors this rule.
 */
export function resolveOptionUnitPriceCents(
  basePriceCents: string,
  selected: readonly SelectedProductOption[] | null | undefined,
): string {
  for (const option of selected ?? []) {
    if (option.priceCents && /^\d+$/u.test(option.priceCents))
      return option.priceCents;
  }
  return basePriceCents;
}

/**
 * Lowest price a shopper can reach. Every value with its own price is a
 * candidate; the base price stays reachable while any value is unpriced.
 * Catalogue labels use this so a priced product never advertises $0.
 */
export function productFromPriceCents(
  basePriceCents: string,
  options: readonly ProductOptionGroup[] | null | undefined,
): string {
  let lowest: bigint | null = null;
  let allPriced = Boolean(options?.length);
  for (const group of options ?? []) {
    for (const value of group.values) {
      if (value.priceCents && /^\d+$/u.test(value.priceCents)) {
        const cents = BigInt(value.priceCents);
        if (lowest === null || cents < lowest) lowest = cents;
      } else {
        allPriced = false;
      }
    }
  }
  if (lowest === null) return basePriceCents;
  if (!allPriced && /^\d+$/u.test(basePriceCents)) {
    const base = BigInt(basePriceCents);
    if (base < lowest) lowest = base;
  }
  return lowest.toString();
}

/** Stable comparison key for cart lines that share a product but not choices. */
export function selectedOptionsKey(
  options: readonly SelectedProductOption[] | null | undefined,
): string {
  return options?.length
    ? JSON.stringify(
        options.map((option) => [
          option.name,
          option.value,
          option.priceCents ?? '',
        ]),
      )
    : '';
}
