import { useState, type CSSProperties } from 'react';
import { Pause, Play } from 'lucide-react';
import type { Product } from '../../../lib/api';
import { storeProductPath } from '../../../lib/storefront';
import type { ShopCartController } from '../../../hooks/useShopCart';
import type { CatalogGrid, CatalogGridProps } from '../types';
import {
  PriceLabels,
  ProductLink,
  SaleBadge,
  ShopImage,
  StockBadge,
} from '../primitives';

/**
 * One tile of the Ribbon. The repeated set exists only for the seamless loop,
 * so it is plain markup that can never take focus or announce itself twice.
 */
function RibbonTile({
  product,
  cart,
  href,
  lbpRate,
  clone,
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
  lbpRate?: number | null;
  clone: boolean;
}) {
  const body = (
    <>
      <span className="shop-product-image">
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
        <SaleBadge product={product} />
        <StockBadge product={product} cart={cart} />
      </span>
      <div className="shop-ribbon-caption">
        <h3 className="notranslate">{product.name}</h3>
        <PriceLabels product={product} lbpRate={lbpRate} />
      </div>
    </>
  );
  if (clone)
    return (
      <div className="shop-ribbon-tile" aria-hidden="true">
        {body}
      </div>
    );
  return (
    <ProductLink
      product={product}
      href={href}
      className="shop-ribbon-tile"
      ariaLabel={`Open ${product.name}`}
    >
      {body}
    </ProductLink>
  );
}

/**
 * Ribbon: a 4:3 strip that keeps moving. It is a browsing strip, so a tap
 * opens the dish and the product page carries the shop action; the pause
 * control keeps motion under the visitor's control.
 */
function RibbonGrid({ products, cart, shopSlug, lbpRate }: CatalogGridProps) {
  const [stopped, setStopped] = useState(false);
  if (!products.length) return null;
  // The track needs a full set beyond the visible column or the loop exposes a
  // gap at its seam; short sections repeat their tiles.
  const copies = products.length <= 2 ? 3 : 2;
  // A longer menu drifts for longer instead of faster, so the pace stays calm.
  const duration = Math.min(72, Math.max(24, products.length * 7));
  const shift = `${100 / copies}%`;
  return (
    <div className={`shop-catalog-ribbon${stopped ? ' is-stopped' : ''}`}>
      <div className="shop-catalog-ribbon-window">
        <div
          className="shop-catalog-ribbon-track"
          style={
            {
              '--ribbon-duration': `${duration}s`,
              '--ribbon-shift': shift,
            } as CSSProperties
          }
        >
          {Array.from({ length: copies }, (_, copy) => (
            <div
              className="shop-catalog-ribbon-set"
              key={copy}
              aria-hidden={copy > 0 || undefined}
            >
              {products.map((product) => (
                <RibbonTile
                  key={product.id}
                  product={product}
                  cart={cart}
                  href={storeProductPath(shopSlug, product.slug)}
                  lbpRate={lbpRate}
                  clone={copy > 0}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="shop-ribbon-toggle shop-glass"
        aria-label={
          stopped ? 'Resume the drifting menu' : 'Pause the drifting menu'
        }
        onClick={() => setStopped((current) => !current)}
      >
        {stopped ? (
          <Play size={14} aria-hidden="true" />
        ) : (
          <Pause size={14} aria-hidden="true" />
        )}
        {stopped ? 'Play' : 'Pause'}
      </button>
    </div>
  );
}

/** Ribbon: a 4:3 strip that drifts on its own. */
export const ribbonGrid: CatalogGrid = {
  key: 'ribbon',
  wire: [
    [0, 5, 12, 9],
    [13, 5, 12, 9],
    [26, 5, 13, 9],
    [0, 17, 12, 9],
    [13, 17, 12, 9],
    [26, 17, 13, 9],
  ],
  skeleton: { shape: 'card', rows: 5, frame: 'layout-rail' },
  imageLed: true,
  Grid: RibbonGrid,
};
