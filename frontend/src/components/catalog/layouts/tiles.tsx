import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps } from '../types';
import { revealDelay } from '../primitives';
import { TileCard } from '../shared/tile-card';

function TilesGrid({ products, cart, shopSlug, lbpRate }: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-tiles">
      {products.map((product, index) => (
        <TileCard
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          delay={revealDelay(index)}
          variant="tiles"
        />
      ))}
    </div>
  );
}

/** Photo tiles: 4:3 photos with a quiet caption below. */
export const tilesGrid: CatalogGrid = {
  key: 'tiles',
  wire: [
    [2, 2, 11, 8],
    [15, 2, 11, 8],
    [28, 2, 10, 8],
    [2, 13, 11, 8],
    [15, 13, 11, 8],
    [28, 13, 10, 8],
  ],
  skeleton: { shape: 'card', rows: 6, frame: 'layout-tiles' },
  imageLed: true,
  Grid: TilesGrid,
};
