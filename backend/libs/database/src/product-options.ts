import { BadRequestException } from '@nestjs/common';

// Product choices are small owner-defined lists (size, color, ...). They are
// stored as JSON on the product and snapshotted per cart line so an owner can
// rename or remove a value later without rewriting historical orders.
export interface ProductOptionGroup {
  name: string;
  values: string[];
}

export interface SelectedProductOption {
  name: string;
  value: string;
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

/**
 * Trims, de-duplicates, and bounds owner-supplied option groups. Invalid input
 * fails with a stable code so the panel can explain the problem without
 * exposing validation internals.
 */
export function normalizeProductOptions(
  input: readonly ProductOptionGroup[] | null | undefined,
): ProductOptionGroup[] | null {
  if (!input?.length) return null;
  if (input.length > MAX_PRODUCT_OPTION_GROUPS)
    invalid(`A product can have at most ${MAX_PRODUCT_OPTION_GROUPS} options`);
  const groups: ProductOptionGroup[] = [];
  const names = new Set<string>();
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

    const values: string[] = [];
    const seen = new Set<string>();
    for (const raw of group.values) {
      if (typeof raw !== 'string') invalid('Option values must be text');
      const value = cleanText(raw);
      // Empty entries are dropped rather than rejected: the panel filters
      // them while the owner is still typing, and the DTO already refuses
      // empty strings from hand-made API requests.
      if (!value) continue;
      if (value.length > MAX_PRODUCT_OPTION_VALUE)
        invalid(
          `Option values must be 1-${MAX_PRODUCT_OPTION_VALUE} characters long`,
        );
      const valueKey = value.toLocaleLowerCase('en-US');
      if (seen.has(valueKey)) continue;
      seen.add(valueKey);
      values.push(value);
    }
    if (!values.length) invalid('Each option needs at least one value');
    if (values.length > MAX_PRODUCT_OPTION_VALUES)
      invalid(
        `Each option can have at most ${MAX_PRODUCT_OPTION_VALUES} values`,
      );
    groups.push({ name, values });
  }
  return groups;
}

/**
 * Validates a shopper's choice against the product's current options and
 * returns it in the product's group order. The canonical order makes the
 * serialized signature stable when matching existing cart lines.
 */
export function normalizeSelectedOptions(
  productOptions: readonly ProductOptionGroup[] | null | undefined,
  input: readonly SelectedProductOption[] | null | undefined,
): SelectedProductOption[] | null {
  if (!productOptions?.length) {
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
  if (chosen.size !== productOptions.length)
    invalid('Choose a value for each option');

  return productOptions.map((group) => {
    const value = chosen.get(group.name.toLocaleLowerCase('en-US'));
    if (!value || !group.values.includes(value))
      invalid('The selected option is not available');
    return { name: group.name, value };
  });
}

/** Stable comparison key for cart lines that share a product but not choices. */
export function selectedOptionsKey(
  options: readonly SelectedProductOption[] | null | undefined,
): string {
  return options?.length
    ? JSON.stringify(options.map((option) => [option.name, option.value]))
    : '';
}
