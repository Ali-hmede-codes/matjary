import type { MigrationInterface, QueryRunner } from 'typeorm';
import { latinSlugBase } from '../content-slug';

// Arabic names used to be erased by the ASCII fold, so shops, products and
// posts created with an Arabic name received the generic "shop" address
// ("shop", "shop-2", …). The generator transliterates now; this migration
// heals the rows still stuck on that generic family and leaves every other
// address untouched. Ids, relations and media stay unchanged, so only the
// public link moves.
export class ArabicSlugRepair1795819200000 implements MigrationInterface {
  name = 'ArabicSlugRepair1795819200000';

  async up(runner: QueryRunner): Promise<void> {
    await repairGenericSlugs(runner, 'stores', 'name');
    await repairGenericSlugs(runner, 'products', 'name');
    await repairGenericSlugs(runner, 'showcases', 'title');
  }

  async down(): Promise<void> {
    // The generic addresses were the defect; restoring them would break the
    // repaired links again. This migration owns no schema.
  }
}

const GENERIC_SLUG = /^shop(?:-\d+)?$/;
const ARABIC_LETTER = /[\u0621-\u064a\u066e-\u06ff\ufb50-\ufdff\ufe70-\ufefc]/u;

interface SlugRow {
  id: string;
  label: string;
  slug: string;
}

async function repairGenericSlugs(
  runner: QueryRunner,
  table: 'stores' | 'products' | 'showcases',
  labelColumn: 'name' | 'title',
): Promise<void> {
  const rows: SlugRow[] = await runner.query(
    `SELECT id, \`${labelColumn}\` AS label, slug FROM \`${table}\` ORDER BY created_at, id`,
  );
  // Every current address stays reserved: a repaired row must not steal a
  // custom address another owner already uses.
  const used = new Set(rows.map((row) => row.slug));
  for (const row of rows) {
    if (!GENERIC_SLUG.test(row.slug)) continue;
    if (!ARABIC_LETTER.test(row.label)) continue;
    const base = latinSlugBase(row.label);
    if (!base || base === 'shop') continue;
    let slug = base;
    for (let suffix = 2; used.has(slug); suffix++) slug = `${base}-${suffix}`;
    await runner.query(`UPDATE \`${table}\` SET slug = ? WHERE id = ?`, [
      slug,
      row.id,
    ]);
    used.add(slug);
  }
}
