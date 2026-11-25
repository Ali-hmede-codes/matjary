import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps } from '../types';
import { PhotoCard } from '../shared/photo-card';

function CardsGrid({
  products,
  cart,
  shopSlug,
  lbpRate,
  showDescriptions,
}: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-cards">
      {products.map((product) => (
        <PhotoCard
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          showDescriptions={showDescriptions}
        />
      ))}
    </div>
  );
}

/** Square grid: 1:1 card boxes with the name and price inside the box. */
export const cardsGrid: CatalogGrid = {
  key: 'cards',
  wire: [
    [2, 2, 11, 11],
    [15, 2, 11, 11],
    [28, 2, 10, 11],
    [2, 15, 11, 11],
    [15, 15, 11, 11],
    [28, 15, 10, 11],
  ],
  skeleton: { shape: 'card', rows: 6, frame: 'layout-cards' },
  imageLed: true,
  Grid: CardsGrid,
};
