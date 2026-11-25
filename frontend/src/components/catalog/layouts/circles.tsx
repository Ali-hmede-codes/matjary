import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps } from '../types';
import { revealDelay } from '../primitives';
import { TileCard } from '../shared/tile-card';

function CirclesGrid({ products, cart, shopSlug, lbpRate }: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-circles">
      {products.map((product, index) => (
        <TileCard
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          delay={revealDelay(index)}
          variant="circles"
        />
      ))}
    </div>
  );
}

/** Circles: round photos with the name underneath. */
export const circlesGrid: CatalogGrid = {
  key: 'circles',
  wire: [
    [3, 3, 9, 9],
    [16, 3, 9, 9],
    [29, 3, 8, 9],
    [3, 16, 9, 9],
    [16, 16, 9, 9],
    [29, 16, 8, 9],
  ],
  skeleton: { shape: 'card', rows: 6, frame: 'layout-circles' },
  imageLed: true,
  Grid: CirclesGrid,
};
