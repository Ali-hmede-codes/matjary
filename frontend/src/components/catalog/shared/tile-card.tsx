import type { CatalogItemProps } from '../types';
import {
  ItemCaption,
  ProductLink,
  SaleBadge,
  ShopImage,
  StockBadge,
  isUnavailable,
  tileDelay,
} from '../primitives';

export type TileVariant = 'tiles' | 'bento' | 'sticker' | 'circles' | 'rail';

/**
 * The photo-first card: a 4:3 photo above a quiet caption. Photo tiles, Bento,
 * Sticker, Circles and the Photo rail all wear it; their grid class alone
 * decides the arrangement, the caption treatment and the motion.
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
      />
    </article>
  );
}
