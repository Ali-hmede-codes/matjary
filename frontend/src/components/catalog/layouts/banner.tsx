import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps } from '../types';
import { revealDelay } from '../primitives';
import { BannerCard } from '../shared/banner-card';
import { ShelfRail } from '../shared/shelf-rail';

function BannerGrid({
  products,
  cart,
  shopSlug,
  lbpRate,
  showDescriptions,
}: CatalogGridProps) {
  return (
    <ShelfRail count={products.length} variant="banner">
      {products.map((product, index) => (
        <BannerCard
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          variant="banner"
          showDescriptions={showDescriptions}
          delay={revealDelay(index)}
        />
      ))}
    </ShelfRail>
  );
}

/** Banner card: a wide cover with a floating tile, scrolled sideways. */
export const bannerGrid: CatalogGrid = {
  key: 'banner',
  wire: [
    [1, 2, 12, 18],
    [15, 2, 12, 18],
    [29, 2, 10, 18],
    [4, 4, 6, 6],
    [18, 4, 6, 6],
    [31, 4, 6, 6],
    [2, 22, 9, 1],
    [16, 22, 9, 1],
    [30, 22, 8, 1],
    [2, 25, 6, 1],
    [16, 25, 6, 1],
    [30, 25, 5, 1],
  ],
  skeleton: { shape: 'card', rows: 5, frame: 'layout-banner' },
  imageLed: true,
  Grid: BannerGrid,
};
