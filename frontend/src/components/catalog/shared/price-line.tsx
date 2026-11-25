import type { CatalogItemProps } from '../types';
import {
  AddToCart,
  PriceLabels,
  ProductDescription,
  ProductName,
  isUnavailable,
} from '../primitives';

/**
 * The plain price line: name, description, dotted leader and price on one row.
 * Shared by the compact price list and the editorial menu, which only adds a
 * typography class; neither shows a photo.
 */
export function PriceLine({
  product,
  cart,
  href,
  lbpRate,
  showDescriptions = true,
  variant = 'compact',
}: CatalogItemProps & { variant?: 'compact' | 'menu' }) {
  const unavailable = isUnavailable(product);
  return (
    <article
      className={`shop-price-row${variant === 'menu' ? ' shop-menu-row' : ''}${
        unavailable ? ' is-unavailable' : ''
      }`}
    >
      <div className="shop-price-row-copy">
        <ProductName product={product} href={href} />
        <ProductDescription product={product} visible={showDescriptions} />
        {unavailable && (
          <span className="shop-price-row-stock">Out of stock</span>
        )}
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
