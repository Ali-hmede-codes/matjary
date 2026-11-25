import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps } from '../types';
import { revealDelay } from '../primitives';
import { BannerCard } from '../shared/banner-card';
import { ShelfRail } from '../shared/shelf-rail';

function CoverGrid({
  products,
  cart,
  shopSlug,
  lbpRate,
  showDescriptions,
}: CatalogGridProps) {
  return (
    <ShelfRail count={products.length} variant="cover">
      {products.map((product, index) => (
        <BannerCard
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          variant="cover"
          showDescriptions={showDescriptions}
          delay={revealDelay(index)}
        />
      ))}
    </ShelfRail>
  );
}

/** Cover card: the banner card without the floating tile. */
export const coverGrid: CatalogGrid = {
  key: 'cover',
  wire: [
    [1, 2, 12, 20],
    [15, 2, 12, 20],
    [29, 2, 10, 20],
    [2, 24, 9, 1],
    [16, 24, 9, 1],
    [30, 24, 8, 1],
  ],
  skeleton: { shape: 'card', rows: 5, frame: 'layout-cover' },
  imageLed: true,
  Grid: CoverGrid,
};
