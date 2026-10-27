import type { MigrationInterface, QueryRunner } from 'typeorm';

// Product option prices started as amounts added to the product's base price.
// They now replace it (small $10, medium $15, large $20), so stored deltas must
// be converted once or a $25 item with a $2 large option would start charging
// $2. Values are rewritten in place; cart item snapshots stay untouched because
// their unit price was already the combined total.

interface StoredValue {
  priceCents?: unknown;
}

interface StoredGroup {
  values?: unknown;
}

function parseOptions(raw: unknown): StoredGroup[] | null {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? (parsed as StoredGroup[]) : null;
}

function shiftPrices(
  groups: StoredGroup[],
  baseCents: bigint,
  direction: 1n | -1n,
): boolean {
  let changed = false;
  for (const group of groups) {
    if (!group || typeof group !== 'object' || !Array.isArray(group.values))
      continue;
    for (const raw of group.values) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const entry = raw as StoredValue;
      if (
        typeof entry.priceCents !== 'string' ||
        !/^\d+$/u.test(entry.priceCents)
      )
        continue;
      const price = BigInt(entry.priceCents);
      if (price === 0n) continue;
      const next =
        direction === 1n
          ? baseCents + price
          : price > baseCents
            ? price - baseCents
            : 0n;
      const nextValue = next > 0n ? next.toString() : null;
      if (nextValue !== entry.priceCents) {
        entry.priceCents = nextValue;
        changed = true;
      }
    }
  }
  return changed;
}

export class AbsoluteProductOptionPrices1794696000000 implements MigrationInterface {
  name = 'AbsoluteProductOptionPrices1794696000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const rows: { id: string; price_cents: string; options: unknown }[] =
      await queryRunner.query(
        'SELECT `id`, `price_cents`, `options` FROM `products` WHERE `options` IS NOT NULL',
      );
    for (const row of rows) {
      if (!/^\d+$/u.test(row.price_cents)) continue;
      let groups: StoredGroup[] | null;
      try {
        groups = parseOptions(row.options);
      } catch {
        // Malformed JSON is left for the reader, which already drops it.
        continue;
      }
      if (!groups) continue;
      if (shiftPrices(groups, BigInt(row.price_cents), 1n)) {
        await queryRunner.query(
          'UPDATE `products` SET `options` = ? WHERE `id` = ?',
          [JSON.stringify(groups), row.id],
        );
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows: { id: string; price_cents: string; options: unknown }[] =
      await queryRunner.query(
        'SELECT `id`, `price_cents`, `options` FROM `products` WHERE `options` IS NOT NULL',
      );
    for (const row of rows) {
      if (!/^\d+$/u.test(row.price_cents)) continue;
      let groups: StoredGroup[] | null;
      try {
        groups = parseOptions(row.options);
      } catch {
        continue;
      }
      if (!groups) continue;
      if (shiftPrices(groups, BigInt(row.price_cents), -1n)) {
        await queryRunner.query(
          'UPDATE `products` SET `options` = ? WHERE `id` = ?',
          [JSON.stringify(groups), row.id],
        );
      }
    }
  }
}
