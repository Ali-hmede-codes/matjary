// ---------------------------------------------------------------------------
// Product-section grid catalogue
// ---------------------------------------------------------------------------
// The saved vocabulary of the storefront's product-section grids. This module
// is plain data on purpose: `node --experimental-strip-types` loads it in the
// unit tests, so it must never import React or a component.
//
// It mirrors backend/apps/api/src/modules/stores/dto/store-design.dto.ts.
// Adding or removing a grid is a four-step change:
//   1. add or delete the key below,
//   2. add or delete the same key in the backend DTO,
//   3. add or delete frontend/src/components/catalog/layouts/<key>.tsx,
//   4. register or unregister it in
//      frontend/src/components/catalog/registry.tsx.
// TypeScript refuses to compile a registry that does not cover every key here,
// and refuses a key that has no registry entry.
export const catalogLayouts = [
  'list',
  'cards',
  'compact',
  'menu',
  'gallery',
  'featured',
  'shelves',
  'overlay',
  'tiles',
  'bento',
  'sticker',
  'circles',
  'rail',
  'ribbon',
  'zigzag',
  'index',
  'rows',
  'banner',
  'cover',
] as const;
export type CatalogLayout = (typeof catalogLayouts)[number];

/** The shop a grid suits best. Drives the studio's MENU / E-COMMERCE / BOTH tabs. */
export const catalogLayoutGroups = ['menu', 'ecommerce', 'both'] as const;
export type CatalogLayoutGroup = (typeof catalogLayoutGroups)[number];

export const catalogLayoutGroupInfo: Record<
  CatalogLayoutGroup,
  { label: string; hint: string }
> = {
  menu: {
    label: 'MENU',
    hint: 'Price lists and menu grids for dishes and sections.',
  },
  ecommerce: {
    label: 'E-COMMERCE',
    hint: 'Product grids for cards, collections and drops.',
  },
  both: {
    label: 'BOTH',
    hint: 'Flexible grids that work for either kind of shop.',
  },
};

/**
 * The one category each product-section grid is listed under in the studio.
 * Every grid keeps a single home so the studio shows a stable order.
 */
export const catalogLayoutGroupOf: Record<CatalogLayout, CatalogLayoutGroup> = {
  list: 'both',
  cards: 'ecommerce',
  compact: 'menu',
  menu: 'menu',
  gallery: 'ecommerce',
  featured: 'ecommerce',
  shelves: 'ecommerce',
  overlay: 'ecommerce',
  tiles: 'ecommerce',
  bento: 'ecommerce',
  sticker: 'ecommerce',
  circles: 'both',
  rail: 'ecommerce',
  ribbon: 'ecommerce',
  zigzag: 'both',
  index: 'menu',
  rows: 'menu',
  banner: 'ecommerce',
  cover: 'ecommerce',
};

export const catalogLayoutInfo: Record<
  CatalogLayout,
  { label: string; hint: string }
> = {
  list: { label: 'Classic rows', hint: 'Photo, name, description, price.' },
  cards: {
    label: 'Square grid',
    hint: '1:1 card boxes, name and price inside the box.',
  },
  compact: { label: 'Price list', hint: 'Fast to scan, no photos.' },
  menu: { label: 'Menu', hint: 'Dotted prices, editorial feel.' },
  gallery: {
    label: 'Portrait grid',
    hint: '3:4 card boxes, copy inside the box.',
  },
  featured: {
    label: 'Wide feature',
    hint: '4:3 landscape card boxes, two per row.',
  },
  shelves: {
    label: 'Sideways rail',
    hint: 'Card boxes that scroll left to right.',
  },
  overlay: {
    label: 'Photo overlay',
    hint: 'Full 4:3 photos with a glass name and price.',
  },
  tiles: {
    label: 'Photo tiles',
    hint: '4:3 photos with a quiet caption below.',
  },
  bento: {
    label: 'Bento',
    hint: '4:3 photos in a mixed grid with one wide tile.',
  },
  sticker: {
    label: 'Sticker',
    hint: 'A caption card overlapping each 4:3 photo.',
  },
  circles: {
    label: 'Circles',
    hint: 'Round photos with the name underneath.',
  },
  rail: {
    label: 'Photo rail',
    hint: 'A 4:3 strip that snaps sideways.',
  },
  ribbon: {
    label: 'Ribbon',
    hint: 'A 4:3 strip that drifts on its own.',
  },
  zigzag: {
    label: 'Zigzag',
    hint: 'Photo and text rows that alternate sides.',
  },
  index: {
    label: 'Numbered',
    hint: 'An editorial list with big index numbers.',
  },
  rows: {
    label: 'Photo menu',
    hint: 'Thin rows with a small 4:3 photo and dotted prices.',
  },
  banner: {
    label: 'Banner card',
    hint: 'A wide cover with a floating tile, scrolled sideways.',
  },
  cover: {
    label: 'Cover card',
    hint: 'The same card without the floating tile.',
  },
};
