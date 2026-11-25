import type { CatalogItemProps } from '../types';
import {
  ItemCaption,
  SaleBadge,
  ShopImage,
  StockBadge,
  isUnavailable,
  tileDelay,
} from '../primitives';

export type TileVariant =
  'tiles' | 'bento' | 'stagger' | 'sticker' | 'circles' | 'rail';

/**
 * The photo-first card: a 4:3 photo above a quiet caption. Photo tiles, Bento,
 * Staggered, Sticker, Circles and the Photo rail all wear it; their grid class
 * alone decides the arrangement, the caption treatment and the motion.
 */
export function TileCard({
  product,
  cart,
  href,
  lbpRate,
  delay,
  variant,
}: CatalogItemProps & { variant: TileVariant }) {
  const unavailable = isUnavailable(product);
  return (
    <article
      className={`shop-product shop-tile-card is-${variant}${unavailable ? ' is-unavailable' : ''}`}
      style={tileDelay(delay)}
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
      <ItemCaption
        product={product}
        cart={cart}
        href={href}
        lbpRate={lbpRate}
      />
    </article>
  );
}
