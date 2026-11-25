import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps } from '../types';
import { PriceLine } from '../shared/price-line';

function CompactGrid({
  products,
  cart,
  shopSlug,
  lbpRate,
  showDescriptions,
}: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-compact">
      {products.map((product) => (
        <PriceLine
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

/** Price list: fast to scan, no photos. */
export const compactGrid: CatalogGrid = {
  key: 'compact',
  wire: [
    [2, 4, 26, 2],
    [32, 4, 6, 2],
    [2, 10, 30, 2],
    [34, 10, 4, 2],
    [2, 16, 22, 2],
    [32, 16, 6, 2],
    [2, 22, 28, 2],
    [32, 22, 6, 2],
  ],
  skeleton: { shape: 'line', rows: 4, frame: 'layout-compact' },
  Grid: CompactGrid,
};
