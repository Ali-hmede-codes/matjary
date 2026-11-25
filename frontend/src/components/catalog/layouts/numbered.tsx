import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps, CatalogItemProps } from '../types';
import {
  AddToCart,
  PriceLabels,
  ProductDescription,
  ProductName,
  ShopImage,
  isUnavailable,
  revealDelay,
  tileDelay,
} from '../primitives';

/**
 * Numbered: an editorial list where the index number is the graphic element.
 * The number is decoration for the eye, so assistive tech skips it.
 */
function NumberedRow({
  product,
  cart,
  href,
  lbpRate,
  position = 1,
  showDescriptions = true,
  delay,
}: CatalogItemProps) {
  const unavailable = isUnavailable(product);
  return (
    <article
      className={`shop-numbered-row${unavailable ? ' is-unavailable' : ''}`}
      style={tileDelay(delay)}
    >
      <span className="shop-numbered-index" aria-hidden="true">
        {String(position).padStart(2, '0')}
      </span>
      <a
        className="shop-numbered-thumb"
        href={href}
        aria-label={`Open ${product.name}`}
      >
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
      </a>
      <div className="shop-numbered-copy">
        <ProductName product={product} href={href} />
        <ProductDescription product={product} visible={showDescriptions} />
      </div>
      <PriceLabels
        product={product}
        lbpRate={lbpRate}
        className="shop-numbered-price"
      />
      <AddToCart product={product} cart={cart} chooseHref={href} />
    </article>
  );
}

function NumberedGrid({
  products,
  cart,
  shopSlug,
  lbpRate,
  showDescriptions,
}: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-index">
      {products.map((product, index) => (
        <NumberedRow
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          showDescriptions={showDescriptions}
          position={index + 1}
          delay={revealDelay(index)}
        />
      ))}
    </div>
  );
}

/** Numbered: an editorial list with big index numbers. */
export const numberedGrid: CatalogGrid = {
  key: 'index',
  wire: [
    [2, 4, 5, 4],
    [9, 4, 20, 2],
    [9, 8, 13, 1],
    [32, 4, 6, 2],
    [2, 13, 5, 4],
    [9, 13, 20, 2],
    [9, 17, 13, 1],
    [32, 13, 6, 2],
    [2, 22, 5, 4],
    [9, 22, 20, 2],
    [9, 26, 13, 1],
    [32, 22, 6, 2],
  ],
  skeleton: { shape: 'line', rows: 4, frame: 'layout-compact' },
  imageLed: true,
  Grid: NumberedGrid,
};
