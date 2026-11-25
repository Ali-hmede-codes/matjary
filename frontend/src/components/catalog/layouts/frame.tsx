import { ArrowUp, Handbag } from 'lucide-react';
import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps, CatalogItemProps } from '../types';
import {
  AddToCart,
  PriceLabels,
  SaleBadge,
  ShopImage,
  StockBadge,
  isUnavailable,
  revealDelay,
  tileDelay,
} from '../primitives';

/**
 * The reference's bag-with-an-up-arrow: lucide's handbag outline carries a small
 * arrow inside its body, so the mark stays legible at button size.
 */
function BagAddIcon() {
  return (
    <span className="shop-frame-bag" aria-hidden="true">
      <Handbag size={26} strokeWidth={1.8} />
      <ArrowUp
        className="shop-frame-bag-arrow"
        size={12}
        strokeWidth={2.6}
        aria-hidden="true"
      />
    </span>
  );
}

function FrameCard({ product, cart, href, lbpRate, delay }: CatalogItemProps) {
  const unavailable = isUnavailable(product);
  return (
    <article
      className={`shop-frame-card${unavailable ? ' is-unavailable' : ''}`}
      style={tileDelay(delay)}
    >
      <div className="shop-frame-art">
        <a
          className="shop-frame-art-link"
          href={href}
          aria-label={`Open ${product.name}`}
        >
          <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
        </a>
        <SaleBadge product={product} />
        <StockBadge product={product} cart={cart} />
      </div>
      <div className="shop-frame-copy">
        <h3 className="notranslate">
          <a href={href}>{product.name}</a>
        </h3>
        <p className="shop-frame-meta">
          {product.categoryName || product.category}
        </p>
        <div className="shop-frame-bottom">
          <PriceLabels
            product={product}
            lbpRate={lbpRate}
            className="shop-frame-price"
          />
          <div className="shop-frame-action">
            <AddToCart
              product={product}
              cart={cart}
              chooseHref={href}
              iconOnly
              icon={<BagAddIcon />}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function FrameGrid({ products, cart, shopSlug, lbpRate }: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-frame">
      {products.map((product, index) => (
        <FrameCard
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

/**
 * Frame card: a dark frame tinted with the shop's brand colour, a light photo
 * window, the name and category above a large price and a square buy button.
 */
export const frameGrid: CatalogGrid = {
  key: 'frame',
  wire: [
    [3, 2, 14, 11],
    [19, 2, 14, 11],
    [3, 15, 14, 11],
    [19, 15, 14, 11],
  ],
  skeleton: { shape: 'card', rows: 6, frame: 'layout-frame' },
  imageLed: true,
  Grid: FrameGrid,
};
