import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

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
      .slice(0, 140)
      .replace(/-$/g, '') || 'shop';
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = `${base}-${randomUUID().replace(/-/g, '')}`;
    if (!(await exists(slug))) return slug;
  }
  throw new ConflictException(
    'Could not reserve a unique address. Please try again.',
  );
}
