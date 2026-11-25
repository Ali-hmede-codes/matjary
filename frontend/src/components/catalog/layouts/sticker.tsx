import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps } from '../types';
import { revealDelay } from '../primitives';
import { TileCard } from '../shared/tile-card';

function StickerGrid({ products, cart, shopSlug, lbpRate }: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-sticker">
      {products.map((product, index) => (
        <TileCard
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          delay={revealDelay(index)}
          variant="sticker"
        />
      ))}
    </div>
  );
}

/** Sticker: a caption card overlapping each 4:3 photo. */
export const stickerGrid: CatalogGrid = {
  key: 'sticker',
  wire: [
    [2, 2, 11, 9],
    [15, 2, 11, 9],
    [28, 2, 10, 9],
    [4, 9, 7, 2],
    [17, 9, 7, 2],
    [30, 9, 6, 2],
    [2, 16, 11, 9],
    [15, 16, 11, 9],
    [28, 16, 10, 9],
    [4, 23, 7, 2],
    [17, 23, 7, 2],
    [30, 23, 6, 2],
  ],
  skeleton: { shape: 'card', rows: 6, frame: 'layout-sticker' },
  imageLed: true,
  Grid: StickerGrid,
};
