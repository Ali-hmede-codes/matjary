import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps } from '../types';
import { revealDelay } from '../primitives';
import { TileCard } from '../shared/tile-card';

function StaggerGrid({ products, cart, shopSlug, lbpRate }: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-stagger">
      {products.map((product, index) => (
        <TileCard
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          delay={revealDelay(index)}
          variant="stagger"
        />
      ))}
    </div>
  );
}

/** Staggered: 4:3 photos on an offset, editorial rhythm. */
export const staggerGrid: CatalogGrid = {
  key: 'stagger',
  wire: [
    [2, 2, 11, 8],
    [15, 7, 11, 8],
    [28, 2, 10, 8],
    [2, 16, 11, 8],
    [15, 21, 11, 8],
    [28, 16, 10, 8],
  ],
  skeleton: { shape: 'card', rows: 6, frame: 'layout-stagger' },
  imageLed: true,
  Grid: StaggerGrid,
};
