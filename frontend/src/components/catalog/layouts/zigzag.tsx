import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps, CatalogItemProps } from '../types';
import {
  ItemCaption,
  ProductLink,
  SaleBadge,
  ShopImage,
  StockBadge,
  isUnavailable,
  revealDelay,
  tileDelay,
} from '../primitives';

/**
 * Zigzag: a magazine row. The photo and the copy swap sides on every other
 * item, so a short menu reads like a spread instead of a list of cards.
 */
function ZigzagRow({
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
      className={`shop-product shop-zigzag-row${unavailable ? ' is-unavailable' : ''}`}
      style={tileDelay(delay)}
    >
      <ProductLink
        product={product}
        href={href}
        className="shop-product-image shop-product-image-link"
        ariaLabel={`Open ${product.name}`}
      >
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
        <SaleBadge product={product} />
        <StockBadge product={product} cart={cart} />
      </ProductLink>
      <ItemCaption
        product={product}
        cart={cart}
        href={href}
        lbpRate={lbpRate}
        showDescriptions={showDescriptions}
      />
    </article>
  );
}

function ZigzagGrid({
  products,
  cart,
  shopSlug,
  lbpRate,
  showDescriptions,
}: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-zigzag">
      {products.map((product, index) => (
        <ZigzagRow
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

/** Zigzag: photo and text rows that alternate sides. */
export const zigzagGrid: CatalogGrid = {
  key: 'zigzag',
  wire: [
    [2, 3, 11, 8],
    [15, 5, 22, 2],
    [15, 9, 14, 2],
    [27, 16, 11, 8],
    [2, 18, 22, 2],
    [2, 22, 14, 2],
  ],
  skeleton: { shape: 'line', rows: 4, frame: 'layout-compact' },
  imageLed: true,
  Grid: ZigzagGrid,
};
