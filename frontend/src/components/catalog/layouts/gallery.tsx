import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps } from '../types';
import { PhotoCard } from '../shared/photo-card';

function GalleryGrid({
  products,
  cart,
  shopSlug,
  lbpRate,
  showDescriptions,
}: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-gallery">
      {products.map((product) => (
        <PhotoCard
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          showDescriptions={showDescriptions}
          variant="portrait"
        />
      ))}
    </div>
  );
}

/** Portrait grid: 3:4 card boxes, copy inside the box. */
export const galleryGrid: CatalogGrid = {
  key: 'gallery',
  wire: [
    [2, 2, 11, 24],
    [15, 2, 11, 24],
    [28, 2, 10, 24],
  ],
  skeleton: { shape: 'card', rows: 6, frame: 'layout-cards is-portrait' },
  imageLed: true,
  Grid: GalleryGrid,
};
