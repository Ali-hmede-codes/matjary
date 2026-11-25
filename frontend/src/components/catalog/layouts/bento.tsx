import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps } from '../types';
import { revealDelay } from '../primitives';
import { TileCard } from '../shared/tile-card';

function BentoGrid({ products, cart, shopSlug, lbpRate }: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-bento">
      {products.map((product, index) => (
        <TileCard
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          delay={revealDelay(index)}
          variant="bento"
        />
      ))}
    </div>
  );
}

/** Bento: 4:3 photos in a mixed grid with one wide tile. */
export const bentoGrid: CatalogGrid = {
  key: 'bento',
  wire: [
    [2, 2, 23, 8],
    [27, 2, 11, 8],
    [2, 13, 11, 8],
    [15, 13, 11, 8],
    [28, 13, 10, 8],
  ],
  skeleton: { shape: 'card', rows: 6, frame: 'layout-bento' },
  imageLed: true,
  Grid: BentoGrid,
};
