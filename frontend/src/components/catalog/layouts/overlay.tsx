import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps, CatalogItemProps } from '../types';
import {
  AddToCart,
  PriceLabels,
  ProductName,
  SaleBadge,
  ShopImage,
  StockBadge,
  isUnavailable,
  revealDelay,
  tileDelay,
} from '../primitives';

/**
 * Photo overlay: the 4:3 photo is the whole card and the name, price and action
 * ride a frosted glass bar pinned to its bottom edge, so a dense section stays
 * quick to scan without turning each item into a big post.
 */
function OverlayCard({
  product,
  cart,
  href,
  lbpRate,
  delay,
}: CatalogItemProps) {
  const unavailable = isUnavailable(product);
  return (
    <article
      className={`shop-product shop-overlay-card${unavailable ? ' is-unavailable' : ''}`}
      style={tileDelay(delay)}
    >
      <a
        className="shop-product-image shop-product-image-link"
        href={href}
        aria-label={`Open ${product.name}`}
      >
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
      </a>
      <SaleBadge product={product} />
      <StockBadge product={product} cart={cart} />
      <div className="shop-overlay-bar">
        <div className="shop-overlay-copy">
          <ProductName product={product} href={href} />
        </div>
        <div className="shop-overlay-bottom">
          <PriceLabels product={product} lbpRate={lbpRate} />
          <AddToCart product={product} cart={cart} chooseHref={href} />
        </div>
      </div>
    </article>
  );
}

function OverlayGrid({ products, cart, shopSlug, lbpRate }: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-overlay">
      {products.map((product, index) => (
        <OverlayCard
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          delay={revealDelay(index)}
        />
      ))}
    </div>
  );
}

/** Photo overlay: full 4:3 photos with a glass name and price. */
export const overlayGrid: CatalogGrid = {
  key: 'overlay',
  wire: [
    [2, 3, 18, 10],
    [21, 3, 17, 10],
    [2, 15, 18, 10],
    [21, 15, 17, 10],
  ],
  skeleton: { shape: 'overlay', rows: 6, frame: 'layout-overlay' },
  imageLed: true,
  Grid: OverlayGrid,
};
