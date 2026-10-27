import type { DesignSettings } from '@app/database';

/**
 * Upper bound for per-section layout overrides. The studio only shows the
 * owner's live categories, so a longer list can only be stale or forged.
 */
export const DESIGN_CATEGORY_LAYOUT_LIMIT = 200;

const STRING_KEYS = [
  'template',
  'palette',
  'typography',
  'shape',
  'density',
  'hero',
  'postsLayout',
  'catalogLayout',
  'accentLayout',
  'thirdLayout',
  'rhythm',
] as const;

const BOOLEAN_KEYS = ['showProductImages', 'showProductDescriptions'] as const;

/**
 * Copy only the studio fields the storefront understands and drop overrides
 * that point at a category outside this store. The DTO already rejects unknown
 * keys; this second pass keeps the JSON column small, deterministic, and safe
 * against a category deleted between validation and save.
 */
export function storedDesignSettings(
  settings: DesignSettings | null | undefined,
  categoryIds: Iterable<string> | null,
): DesignSettings | null {
  if (!settings) return null;
  const result: DesignSettings = {};
  for (const key of STRING_KEYS) {
    const value = settings[key];
    if (typeof value === 'string' && value.length > 0 && value.length <= 40)
      result[key] = value;
  }
  for (const key of BOOLEAN_KEYS) {
    const value = settings[key];
    if (typeof value === 'boolean') result[key] = value;
  }
  if (
    Array.isArray(settings.categoryLayouts) &&
    settings.categoryLayouts.length
  ) {
    const allowed = categoryIds ? new Set(categoryIds) : null;
    const seen = new Set<string>();
    const layouts = [];
    for (const entry of settings.categoryLayouts) {
      const categoryId = entry?.categoryId;
      const layout = entry?.layout;
      if (typeof categoryId !== 'string' || typeof layout !== 'string')
        continue;
      if (allowed && !allowed.has(categoryId)) continue;
      if (seen.has(categoryId)) continue;
      seen.add(categoryId);
      layouts.push({ categoryId, layout });
      if (layouts.length >= DESIGN_CATEGORY_LAYOUT_LIMIT) break;
    }
    if (layouts.length) result.categoryLayouts = layouts;
  }
  return result;
}
