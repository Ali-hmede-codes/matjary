import type { CatalogItemProps } from '../types';
import {
  AddToCart,
  PriceLabels,
  ProductName,
  SaleBadge,
  ShopImage,
  StockBadge,
  isUnavailable,
} from '../primitives';

export type PhotoCardVariant = 'square' | 'portrait' | 'wide';

/**
 * The photo card family: the card *is* the box the owner picked — a 1:1 tile,
 * a 3:4 tile or a 4:3 landscape card. The photo fills whatever room the caption
 * leaves, so the box ratio never drifts. Shared by every grid that wears a box
 * (square grid, portrait grid, wide feature, sideways rail).
 */
export function PhotoCard({
  product,
  cart,
  href,
  lbpRate,
  showDescriptions = true,
  variant = 'square',
}: CatalogItemProps & { variant?: PhotoCardVariant }) {
  const unavailable = isUnavailable(product);
  return (
    <article
      className={`shop-product shop-photo-card is-${variant}${unavailable ? ' is-unavailable' : ''}`}
    >
      <a
        className="shop-product-image shop-product-image-link"
        href={href}
        aria-label={`Open ${product.name}`}
      >
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
        <SaleBadge product={product} />
        <StockBadge product={product} cart={cart} />
      </a>
      <div className="shop-product-copy">
        <ProductName product={product} href={href} />
        {/* The element stays even without a description: the reserved two-line
            slot keeps every portrait card's photo the same height. */}
        {showDescriptions && (
          <p className="notranslate" title={product.description ?? undefined}>
            {product.description}
          </p>
        )}
        <div className="shop-product-bottom">
          <PriceLabels product={product} lbpRate={lbpRate} />
          <AddToCart product={product} cart={cart} chooseHref={href} />
        </div>
      </div>
    </article>
  );
}
