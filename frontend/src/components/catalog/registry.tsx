import type { CatalogLayout } from '../../lib/catalog-layouts';
import type { CatalogGrid } from './types';
import { listGrid } from './layouts/list';
import { cardsGrid } from './layouts/cards';
import { compactGrid } from './layouts/compact';
import { menuGrid } from './layouts/menu';
import { galleryGrid } from './layouts/gallery';
import { featuredGrid } from './layouts/featured';
import { shelvesGrid } from './layouts/shelves';
import { overlayGrid } from './layouts/overlay';
import { tilesGrid } from './layouts/tiles';
import { bentoGrid } from './layouts/bento';
import { stickerGrid } from './layouts/sticker';
import { circlesGrid } from './layouts/circles';
import { railGrid } from './layouts/rail';
import { ribbonGrid } from './layouts/ribbon';
import { zigzagGrid } from './layouts/zigzag';
import { numberedGrid } from './layouts/numbered';
import { rowsGrid } from './layouts/rows';
import { bannerGrid } from './layouts/banner';
import { coverGrid } from './layouts/cover';
import { glassGrid } from './layouts/glass';

/**
 * The registry is the only place that knows every grid by name.
 *
 * Adding a grid: create `layouts/<name>.tsx`, import it here and add one entry.
 * Removing a grid: delete its entry and its file (and its key in
 * `lib/catalog-layouts.ts` plus the backend DTO).
 *
 * The `Record<CatalogLayout, CatalogGrid>` annotation makes TypeScript reject a
 * missing entry and an entry for a key that is no longer in the catalogue, so
 * the storefront can never fall back to a blank section.
 */
export const catalogGridByKey: Record<CatalogLayout, CatalogGrid> = {
  list: listGrid,
  cards: cardsGrid,
  compact: compactGrid,
  menu: menuGrid,
  gallery: galleryGrid,
  featured: featuredGrid,
  shelves: shelvesGrid,
  overlay: overlayGrid,
  tiles: tilesGrid,
  bento: bentoGrid,
  sticker: stickerGrid,
  circles: circlesGrid,
  rail: railGrid,
  ribbon: ribbonGrid,
  zigzag: zigzagGrid,
  index: numberedGrid,
  rows: rowsGrid,
  banner: bannerGrid,
  cover: coverGrid,
  glass: glassGrid,
};

/** Every grid, in the catalogue's own order (the studio lists them grouped). */
export const catalogGrids: readonly CatalogGrid[] =
  Object.values(catalogGridByKey);

/** Resolve one grid by its saved key. */
export function catalogGrid(key: CatalogLayout): CatalogGrid {
  return catalogGridByKey[key];
}
