import { ConflictException } from '@nestjs/common';

// Owners do not type addresses: new content derives a readable slug from its
// name, and a numeric suffix resolves collisions (`mug`, `mug-2`, …) so links
// stay meaningful instead of carrying an opaque identifier. The unique index
// stays the final authority; callers map duplicate-key errors to the same
// conflict response.
export async function chooseContentSlug(
  name: string,
  requested: string | undefined,
  exists: (slug: string) => Promise<unknown>,
): Promise<string> {
  if (requested) return requested;
  const base =
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      // Leave room for the collision suffix inside the 191-character columns.
      .slice(0, 180)
      .replace(/-$/g, '') || 'shop';
  for (let attempt = 1; attempt <= 50; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    if (!(await exists(slug))) return slug;
  }
  throw new ConflictException(
    'Could not reserve a unique address. Please try again.',
  );
}
