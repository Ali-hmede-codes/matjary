import type { ComponentType } from 'react';
import type { Product } from '../../lib/api';
import type { CatalogLayout } from '../../lib/catalog-layouts';
import type { ShopCartController } from '../../hooks/useShopCart';

/**
 * The miniature geometry the design studio draws for a grid: one rectangle per
 * `[x, y, width, height]` in a 40 x 28 viewBox. It lives with the grid so a new
 * layout ships its own preview instead of editing a map in the studio.
 */
export type CatalogWire = readonly (readonly [
  number,
  number,
  number,
  number,
])[];

/** Props every single product card accepts. */
export interface CatalogItemProps {
  product: Product;
  cart: ShopCartController;
  /** The product page this card opens. */
  href: string;
  lbpRate?: number | null;
  showDescriptions?: boolean;
  /** Stagger index in milliseconds for layouts that rise in on first paint. */
  delay?: number;
  /** 1-based position, used by the numbered grid. */
  position?: number;
}

/** Props every product-section grid accepts. */
export interface CatalogGridProps {
  products: Product[];
  cart: ShopCartController;
  shopSlug: string;
  lbpRate?: number | null;
  showDescriptions?: boolean;
}

/**
 * The box a grid's loading skeleton draws, so the page keeps its shape while
 * the products arrive:
 *  - `card`   a photo box above a two-line caption,
 *  - `line`   a thin price-list row,
 *  - `overlay` a single solid photo tile.
 */
export interface CatalogSkeleton {
  shape: 'card' | 'line' | 'overlay';
  rows: number;
  /** The frame class list; it mirrors the painted grid's container. */
  frame: string;
}

/**
 * One product-section grid. Every file in `layouts/` exports exactly one of
 * these, which is everything the catalogue, the storefront and the studio need:
 * adding a grid is adding a file and one line in `registry.ts`.
 */
export interface CatalogGrid {
  key: CatalogLayout;
  /** Preview geometry for the design studio. */
  wire: CatalogWire;
  /** Shape of the loading placeholder. */
  skeleton: CatalogSkeleton;
  /** Photo-first grids degrade to the price list when photos are hidden. */
  imageLed?: boolean;
  Grid: ComponentType<CatalogGridProps>;
}
