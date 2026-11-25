import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps } from '../types';
import { revealDelay } from '../primitives';
import { TileCard } from '../shared/tile-card';
import { ShelfRail } from '../shared/shelf-rail';

function RailGrid({ products, cart, shopSlug, lbpRate }: CatalogGridProps) {
  return (
    <ShelfRail count={products.length} variant="rail">
      {products.map((product, index) => (
        <TileCard
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          delay={revealDelay(index)}
          variant="rail"
        />
      ))}
    </ShelfRail>
  );
}

/** Photo rail: the same 4:3 cards in a sideways, snapping strip. */
export const railGrid: CatalogGrid = {
  key: 'rail',
  wire: [
    [1, 4, 13, 10],
    [15, 4, 13, 10],
    [29, 4, 12, 10],
    [1, 17, 13, 4],
    [15, 17, 13, 4],
  ],
  skeleton: { shape: 'card', rows: 5, frame: 'layout-rail' },
  imageLed: true,
  Grid: RailGrid,
};
