import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps } from '../types';
import { PhotoCard } from '../shared/photo-card';
import { ShelfRail } from '../shared/shelf-rail';

function ShelvesGrid({
  products,
  cart,
  shopSlug,
  lbpRate,
  showDescriptions,
}: CatalogGridProps) {
  return (
    <ShelfRail count={products.length}>
      {products.map((product) => (
        <PhotoCard
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          showDescriptions={showDescriptions}
        />
      ))}
    </ShelfRail>
  );
}

/** Sideways rail: 1:1 card boxes that scroll left to right. */
export const shelvesGrid: CatalogGrid = {
  key: 'shelves',
  wire: [
    [1, 4, 9, 20],
    [11, 4, 9, 20],
    [21, 4, 9, 20],
    [31, 4, 8, 20],
  ],
  skeleton: { shape: 'card', rows: 6, frame: 'layout-shelves' },
  imageLed: true,
  Grid: ShelvesGrid,
};
