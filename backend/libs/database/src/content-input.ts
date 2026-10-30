import { ConflictException } from '@nestjs/common';
import { latinSlugBase } from './content-slug';

// Owners do not type addresses: new content derives a readable slug from its
// name, and a numeric suffix resolves collisions (`mug`, `mug-2`, …) so links
// stay meaningful instead of carrying an opaque identifier. Arabic names are
// transliterated to latin so they do not collapse into the generic fallback.
// The unique index stays the final authority; callers map duplicate-key errors
// to the same conflict response.
export async function chooseContentSlug(
  name: string,
  requested: string | undefined,
  exists: (slug: string) => Promise<unknown>,
): Promise<string> {
  if (requested) return requested;
  const base = latinSlugBase(name) || 'shop';
  for (let attempt = 1; attempt <= 50; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    if (!(await exists(slug))) return slug;
  }
  throw new ConflictException(
    'Could not reserve a unique address. Please try again.',
  );
}
