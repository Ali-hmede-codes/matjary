import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps, CatalogItemProps } from '../types';
import {
  AddToCart,
  PriceLabels,
  ProductDescription,
  ProductLink,
  ProductName,
  SaleBadge,
  ShopImage,
  isUnavailable,
  revealDelay,
  tileDelay,
} from '../primitives';

/**
 * The photo menu row: the menu row with a small 4:3 thumbnail. Denser than the
 * card layouts, so a long menu stays quick to read to the price.
 */
function PhotoRow({
  product,
  cart,
  href,
  lbpRate,
  showDescriptions = true,
  delay,
}: CatalogItemProps) {
  const unavailable = isUnavailable(product);
  return (
    <article
      className={`shop-price-row shop-photo-row${unavailable ? ' is-unavailable' : ''}`}
      style={tileDelay(delay)}
    >
      <ProductLink
        product={product}
        href={href}
        className="shop-photo-row-thumb"
        ariaLabel={`Open ${product.name}`}
      >
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
        <SaleBadge product={product} />
      </ProductLink>
      <div className="shop-price-row-copy">
        <ProductName product={product} href={href} />
        <ProductDescription product={product} visible={showDescriptions} />
      </div>
      <span className="shop-price-leader" aria-hidden="true" />
      <PriceLabels
        product={product}
        lbpRate={lbpRate}
        className="shop-price-row-price"
      />
      <AddToCart product={product} cart={cart} chooseHref={href} />
    </article>
  );
}

function RowsGrid({
  products,
  cart,
  shopSlug,
  lbpRate,
  showDescriptions,
}: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-rows">
      {products.map((product, index) => (
        <PhotoRow
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          showDescriptions={showDescriptions}
          delay={revealDelay(index)}
        />
      ))}
    </div>
  );
}

/** Photo menu: thin rows with a small 4:3 photo and dotted prices. */
export const rowsGrid: CatalogGrid = {
  key: 'rows',
  wire: [
    [2, 3, 9, 7],
    [13, 4, 21, 2],
    [13, 8, 12, 1],
    [30, 4, 8, 2],
    [2, 13, 9, 7],
    [13, 14, 21, 2],
    [13, 18, 12, 1],
    [30, 14, 8, 2],
    [2, 23, 9, 3],
    [13, 23, 21, 2],
  ],
  skeleton: { shape: 'line', rows: 4, frame: 'layout-compact' },
  imageLed: true,
  Grid: RowsGrid,
};
