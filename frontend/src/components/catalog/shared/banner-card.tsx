import { productHasOptions } from '../../../lib/storefront';
import type { CatalogItemProps } from '../types';
import {
  AddToCart,
  PriceLabels,
  ProductDescription,
  ProductName,
  SaleBadge,
  ShopImage,
  StockBadge,
  isUnavailable,
  tileDelay,
} from '../primitives';

/**
 * The cover card: a 4:3 photo fills the whole art box. The `banner` variant
 * floats a rounded tile over that image; the `cover` variant leaves the photo
 * alone. The corner plus is the same AddToCart the other layouts use, shown
 * only while a plain add is possible; once the item sits in the cart (or needs
 * options) the control moves into the caption.
 */
export function BannerCard({
  product,
  cart,
  href,
  lbpRate,
  variant,
  showDescriptions = true,
  delay,
}: CatalogItemProps & { variant: 'banner' | 'cover' }) {
  const unavailable = isUnavailable(product);
  const inCart =
    cart.cart?.items.some((entry) => entry.productId === product.id) ?? false;
  const quickAdd = !productHasOptions(product) && !unavailable && !inCart;
  const images = product.imageKeys ?? [];
  return (
    <article
      className={`shop-product shop-app-card is-${variant}${unavailable ? ' is-unavailable' : ''}`}
      style={tileDelay(delay)}
    >
      <div className="shop-app-art">
        <a
          className="shop-app-art-link"
          href={href}
          aria-label={`Open ${product.name}`}
        >
          <span className="shop-app-banner">
            <ShopImage value={images[0]} alt={product.name} />
            <SaleBadge product={product} />
            <StockBadge product={product} cart={cart} />
          </span>
        </a>
        {variant === 'banner' && (
          <span className="shop-app-tile" aria-hidden="true">
            <ShopImage value={images[1] ?? images[0]} alt="" />
          </span>
        )}
        {quickAdd && (
          <div className="shop-app-quick">
            <AddToCart product={product} cart={cart} chooseHref={href} />
          </div>
        )}
      </div>
      <div className="shop-app-copy">
        <ProductName product={product} href={href} />
        <ProductDescription product={product} visible={showDescriptions} />
        <div className="shop-app-bottom">
          <PriceLabels product={product} lbpRate={lbpRate} />
          {!quickAdd && (
            <AddToCart product={product} cart={cart} chooseHref={href} />
          )}
        </div>
      </div>
    </article>
  );
}
