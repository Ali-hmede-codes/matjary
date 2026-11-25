import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps } from '../types';
import { PriceLine } from '../shared/price-line';

function MenuGrid({
  products,
  cart,
  shopSlug,
  lbpRate,
  showDescriptions,
}: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-menu">
      {products.map((product) => (
        <PriceLine
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          showDescriptions={showDescriptions}
          variant="menu"
        />
      ))}
    </div>
  );
}

/** Menu: dotted prices and a serif line, like a printed card. */
export const menuGrid: CatalogGrid = {
  key: 'menu',
  wire: [
    [2, 4, 18, 2],
    [30, 4, 8, 2],
    [2, 8, 26, 1],
    [2, 13, 20, 2],
    [30, 13, 8, 2],
    [2, 17, 24, 1],
    [2, 22, 16, 2],
    [30, 22, 8, 2],
  ],
  skeleton: { shape: 'line', rows: 4, frame: 'layout-compact' },
  Grid: MenuGrid,
};
