import type { CSSProperties } from 'react';
import { assetUrl, type Product } from '../../../lib/api';
import { storeMediaUrl, storeProductPath } from '../../../lib/storefront';
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

/** The first photo doubles as the card's ambient colour, blurred behind glass. */
function ambientPhoto(product: Product): string | undefined {
  const url = assetUrl(storeMediaUrl(product.imageKeys?.[0]));
  // A quote in a URL would end the CSS url() token early.
  return url?.replace(/["\\]/g, '');
}

function GlassCard({ product, cart, href, lbpRate, delay }: CatalogItemProps) {
  const photo = ambientPhoto(product);
  const unavailable = isUnavailable(product);
  const style = {
    '--glass-photo': photo ? `url("${photo}")` : 'none',
    ...tileDelay(delay),
  } as CSSProperties;
  return (
    <article
      className={`shop-glass-card${unavailable ? ' is-unavailable' : ''}`}
      style={style}
    >
      <a
        className="shop-glass-art"
        href={href}
        aria-label={`Open ${product.name}`}
      >
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
        <SaleBadge product={product} />
        <StockBadge product={product} cart={cart} />
      </a>
      <div className="shop-glass-copy">
        <ProductName product={product} href={href} />
        <p className="shop-glass-meta">
          {product.categoryName || product.category}
        </p>
        <PriceLabels
          product={product}
          lbpRate={lbpRate}
          className="shop-glass-price"
        />
      </div>
      <div className="shop-glass-action">
        <AddToCart
          product={product}
          cart={cart}
          chooseHref={href}
          label="Add to cart"
          icon="cart"
        />
      </div>
    </article>
  );
}

function GlassGrid({ products, cart, shopSlug, lbpRate }: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-glass">
      {products.map((product, index) => (
        <GlassCard
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

/** Glass card: a dark glass tile whose colour comes from the photo behind it. */
export const glassGrid: CatalogGrid = {
  key: 'glass',
  wire: [
    [2, 2, 11, 10],
    [15, 2, 11, 10],
    [28, 2, 10, 10],
    [2, 16, 11, 10],
    [15, 16, 11, 10],
    [28, 16, 10, 10],
  ],
  skeleton: { shape: 'card', rows: 6, frame: 'layout-glass' },
  imageLed: true,
  Grid: GlassGrid,
};
