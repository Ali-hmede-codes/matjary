import { useState } from 'react';
import { Check, Minus, Package, Plus } from 'lucide-react';
import { assetUrl, type Product } from '../lib/api';
import {
  formatProductPrice,
  storeMediaUrl,
  storeProductPath,
  type CatalogLayout,
} from '../lib/storefront';
import { productCartLimit } from '../lib/cart';
import type { ShopCartController } from '../hooks/useShopCart';

export function ShopImage({
  value,
  alt,
  eager = false,
  fallbackName,
  fallbackLabel,
}: {
  value?: string | null;
  alt: string;
  eager?: boolean;
  fallbackName?: string;
  fallbackLabel?: string;
}) {
  const src = assetUrl(storeMediaUrl(value));
  const [failedSrc, setFailedSrc] = useState<string>();
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const loading = Boolean(src && src !== failedSrc && src !== loadedSrc);
  return (
    <span
      className={`shop-image ${loading ? 'is-loading' : ''}`}
      aria-busy={loading}
    >
      {src && failedSrc !== src ? (
        <img
          key={src}
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          ref={(image) => {
            if (image?.complete && image.naturalWidth > 0) setLoadedSrc(src);
          }}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span
          className="shop-image-fallback"
          role={alt ? 'img' : undefined}
          aria-label={alt || undefined}
          aria-hidden={!alt}
        >
          {fallbackName ? (
            <span className="shop-fallback-brand">
              <span className="shop-fallback-monogram">
                {fallbackName
                  .trim()
                  .split(/\s+/u)
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join('')}
              </span>
              <strong>{fallbackName}</strong>
              <small>{fallbackLabel}</small>
            </span>
          ) : (
            <Package size={32} />
          )}
        </span>
      )}
      {loading && (
        <span className="shop-skeleton shop-image-loading" aria-hidden="true" />
      )}
    </span>
  );
}

export function AddToCart({
  product,
  cart,
}: {
  product: Product;
  cart: ShopCartController;
}) {
  const item = cart.cart?.items.find((entry) => entry.productId === product.id);
  const quantity = item?.quantity ?? 0;
  const limit = productCartLimit(product);
  const blocked = cart.busy || cart.loading;
  if (limit === 0)
    return (
      <button
        type="button"
        className="shop-add-to-cart"
        disabled
        title={`${product.name} is sold out`}
      >
        Sold out
      </button>
    );
  // The cart never opens on add; the quantity control and toast confirm it.
  if (!item)
    return (
      <button
        type="button"
        className="shop-add-to-cart"
        disabled={blocked}
        aria-label={`Add ${product.name} to cart`}
        title={`Add ${product.name} to cart`}
        onClick={() => cart.add(product)}
      >
        <Plus size={17} aria-hidden="true" />
        Add
      </button>
    );
  return (
    <div
      className="shop-qty-stepper"
      role="group"
      aria-label={`Quantity of ${product.name} in cart`}
    >
      <button
        type="button"
        disabled={blocked}
        aria-label={
          quantity === 1
            ? `Remove ${product.name} from cart`
            : `Remove one ${product.name} from cart`
        }
        onClick={() => cart.update(item, quantity - 1)}
      >
        <Minus size={15} aria-hidden="true" />
      </button>
      <output aria-live="polite">{quantity}</output>
      <button
        type="button"
        disabled={blocked || quantity >= limit}
        aria-label={`Add another ${product.name} to cart`}
        onClick={() => cart.update(item, quantity + 1)}
      >
        <Plus size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

function InCartBadge({
  product,
  cart,
}: {
  product: Product;
  cart: ShopCartController;
}) {
  const quantity =
    cart.cart?.items.find((item) => item.productId === product.id)?.quantity ??
    0;
  if (!quantity) return null;
  return (
    <span className="shop-stock-label shop-glass">
      <Check size={13} aria-hidden="true" />
      {quantity} in cart
    </span>
  );
}

// Layout 1: image-first menu row. Best for dishes with descriptions.
function ListItem({
  product,
  cart,
  href,
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
}) {
  const unavailable = productCartLimit(product) === 0;
  return (
    <article
      className={`shop-product shop-menu-item${unavailable ? ' is-unavailable' : ''}`}
    >
      <a
        className="shop-product-image shop-product-image-link"
        href={href}
        aria-label={`Open ${product.name}`}
      >
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
        <InCartBadge product={product} cart={cart} />
      </a>
      <div className="shop-product-copy">
        <h3>
          <a href={href}>{product.name}</a>
        </h3>
        {product.description && (
          <p title={product.description}>{product.description}</p>
        )}
        <div className="shop-product-bottom">
          <strong>
            {formatProductPrice(product.priceCents, product.currency)}
          </strong>
          <AddToCart product={product} cart={cart} />
        </div>
      </div>
    </article>
  );
}

// Layout 2: photo cards. Best for visual merchandise and signature dishes.
function PhotoCard({
  product,
  cart,
  href,
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
}) {
  const unavailable = productCartLimit(product) === 0;
  return (
    <article
      className={`shop-product shop-menu-item shop-photo-card${unavailable ? ' is-unavailable' : ''}`}
    >
      <a
        className="shop-product-image shop-product-image-link"
        href={href}
        aria-label={`Open ${product.name}`}
      >
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
        <InCartBadge product={product} cart={cart} />
      </a>
      <div className="shop-product-copy">
        <h3>
          <a href={href}>{product.name}</a>
        </h3>
        {product.description && (
          <p title={product.description}>{product.description}</p>
        )}
        <div className="shop-product-bottom">
          <strong>
            {formatProductPrice(product.priceCents, product.currency)}
          </strong>
          <AddToCart product={product} cart={cart} />
        </div>
      </div>
    </article>
  );
}

// Layout 3: compact price list without images. Fastest to scan and to load.
function PriceRow({
  product,
  cart,
  href,
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
}) {
  const unavailable = productCartLimit(product) === 0;
  return (
    <article
      className={`shop-price-row${unavailable ? ' is-unavailable' : ''}`}
    >
      <div className="shop-price-row-copy">
        <h3>
          <a href={href}>{product.name}</a>
        </h3>
        {product.description && (
          <p title={product.description}>{product.description}</p>
        )}
      </div>
      <span className="shop-price-leader" aria-hidden="true" />
      <strong className="shop-price-row-price">
        {formatProductPrice(product.priceCents, product.currency)}
      </strong>
      <AddToCart product={product} cart={cart} />
    </article>
  );
}

export function CatalogItem({
  product,
  cart,
  layout,
  shopSlug,
  demo,
}: {
  product: Product;
  cart: ShopCartController;
  layout: CatalogLayout;
  shopSlug: string;
  demo: boolean;
}) {
  const href = storeProductPath(shopSlug, product.slug, demo);
  if (layout === 'cards')
    return <PhotoCard product={product} cart={cart} href={href} />;
  if (layout === 'compact')
    return <PriceRow product={product} cart={cart} href={href} />;
  return <ListItem product={product} cart={cart} href={href} />;
}

export function CatalogItems({
  products,
  cart,
  layout,
  shopSlug,
  demo,
}: {
  products: Product[];
  cart: ShopCartController;
  layout: CatalogLayout;
  shopSlug: string;
  demo: boolean;
}) {
  return (
    <div className={`shop-catalog-items layout-${layout}`}>
      {products.map((product) => (
        <CatalogItem
          key={product.id}
          product={product}
          cart={cart}
          layout={layout}
          shopSlug={shopSlug}
          demo={demo}
        />
      ))}
    </div>
  );
}

export function CatalogLoading({ layout }: { layout: CatalogLayout }) {
  const rows = layout === 'cards' ? 6 : 4;
  return (
    <div
      className={`shop-catalog-items layout-${layout}`}
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading items…</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          className={
            layout === 'compact'
              ? 'shop-price-row shop-skeleton'
              : 'shop-product shop-skeleton'
          }
          key={index}
          aria-hidden="true"
        >
          {layout !== 'compact' && (
            <div className="shop-product-image shop-skeleton" />
          )}
          <div className="shop-product-copy">
            <div className="shop-skeleton shop-skeleton-title" />
            <div className="shop-skeleton shop-skeleton-short" />
          </div>
        </div>
      ))}
    </div>
  );
}
