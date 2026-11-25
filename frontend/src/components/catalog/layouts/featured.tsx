import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps } from '../types';
import { PhotoCard } from '../shared/photo-card';

function FeaturedGrid({
  products,
  cart,
  shopSlug,
  lbpRate,
  showDescriptions,
}: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-featured">
      {products.map((product) => (
        <PhotoCard
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          showDescriptions={showDescriptions}
          variant="wide"
        />
      ))}
    </div>
  );
}

/** Wide feature: 4:3 landscape card boxes, two per row on desktop. */
export const featuredGrid: CatalogGrid = {
  key: 'featured',
  wire: [
    [2, 6, 17, 13],
    [21, 6, 17, 13],
  ],
  skeleton: { shape: 'card', rows: 4, frame: 'layout-featured' },
  imageLed: true,
  Grid: FeaturedGrid,
};
