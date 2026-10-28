import { useState } from 'react';
import { Ban, Check, Minus, Package, Plus } from 'lucide-react';
import { assetUrl, type Product, type SelectedProductOption } from '../lib/api';
import {
  productHasOptions,
  productLbpPriceLabel,
  productPriceLabel,
  selectedOptionsKey,
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
  selectedOptions = null,
  chooseHref,
}: {
  product: Product;
  cart: ShopCartController;
  selectedOptions?: SelectedProductOption[] | null;
  chooseHref?: string;
}) {
  const optionKey = selectedOptionsKey(selectedOptions);
  const item = cart.cart?.items.find(
    (entry) =>
      entry.productId === product.id &&
      selectedOptionsKey(entry.selectedOptions) === optionKey,
  );
  const quantity = item?.quantity ?? 0;
  const productQuantity =
    cart.cart?.items
      .filter((entry) => entry.productId === product.id)
      .reduce((sum, entry) => sum + entry.quantity, 0) ?? 0;
  const limit = productCartLimit(product);
  const blocked = cart.busy || cart.loading;
  if (limit === 0)
    return (
      <button
        type="button"
        className="shop-add-to-cart"
        disabled
        title={`${product.name} is out of stock`}
      >
        Out of stock
      </button>
    );
  // Products with choices open their page first: adding the base product
  // without a size or color would create an order the shop cannot fulfill.
  if (productHasOptions(product) && chooseHref)
    return (
      <a
        className="shop-add-to-cart"
        href={chooseHref}
        aria-label={`Choose options for ${product.name}`}
      >
        Choose
      </a>
    );
  if (productHasOptions(product) && !selectedOptions?.length)
    return (
      <button
        type="button"
        className="shop-add-to-cart"
        disabled
        title="Choose a value for each option first"
      >
        Choose options
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
        onClick={() => cart.add(product, selectedOptions)}
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
        disabled={blocked || productQuantity >= limit}
        aria-label={`Add another ${product.name} to cart`}
        onClick={() => cart.update(item, quantity + 1)}
      >
        <Plus size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

// One badge per item: availability first, then the shopper's own cart line.
function StockBadge({
  product,
  cart,
}: {
  product: Product;
  cart: ShopCartController;
}) {
  if (productCartLimit(product) === 0)
    return (
      <span className="shop-stock-label shop-out-of-stock">
        <Ban size={13} aria-hidden="true" />
        Out of stock
      </span>
    );
  const quantity =
    cart.cart?.items.find((item) => item.productId === product.id)?.quantity ??
    0;
  if (quantity)
    return (
      <span className="shop-stock-label shop-glass">
        <Check size={13} aria-hidden="true" />
        {quantity} in cart
      </span>
    );
  // Tracked stock below the low-stock threshold is worth a heads-up.
  if (
    product.stockQuantity !== null &&
    product.stockQuantity > 0 &&
    product.stockQuantity <= 5
  )
    return (
      <span className="shop-stock-label shop-glass">
        Only {product.stockQuantity} left
      </span>
    );
  return null;
}

// One price block: the USD amount with the owner's optional LBP line under it.
function PriceLabels({
  product,
  lbpRate,
  className,
}: {
  product: Product;
  lbpRate?: number | null;
  className?: string;
}) {
  const lbp = productLbpPriceLabel(product, lbpRate ?? null);
  return (
    <span className={`price-stack${className ? ` ${className}` : ''}`}>
      <strong>{productPriceLabel(product)}</strong>
      {lbp && <small className="price-lbp">{lbp}</small>}
    </span>
  );
}

// Layout 1: image-first menu row. Best for dishes with descriptions.
function ListItem({
  product,
  cart,
  href,
  lbpRate,
  showDescriptions = true,
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
  lbpRate?: number | null;
  showDescriptions?: boolean;
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
        <StockBadge product={product} cart={cart} />
      </a>
      <div className="shop-product-copy">
        <h3>
          <a href={href}>{product.name}</a>
        </h3>
        {showDescriptions && product.description && (
          <p title={product.description}>{product.description}</p>
        )}
        <div className="shop-product-bottom">
          <PriceLabels product={product} lbpRate={lbpRate} />
          <AddToCart product={product} cart={cart} chooseHref={href} />
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
  lbpRate,
  showDescriptions = true,
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
  lbpRate?: number | null;
  showDescriptions?: boolean;
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
        <StockBadge product={product} cart={cart} />
      </a>
      <div className="shop-product-copy">
        <h3>
          <a href={href}>{product.name}</a>
        </h3>
        {showDescriptions && product.description && (
          <p title={product.description}>{product.description}</p>
        )}
        <div className="shop-product-bottom">
          <PriceLabels product={product} lbpRate={lbpRate} />
          <AddToCart product={product} cart={cart} chooseHref={href} />
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
  lbpRate,
  showDescriptions = true,
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
  lbpRate?: number | null;
  showDescriptions?: boolean;
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
        {showDescriptions && product.description && (
          <p title={product.description}>{product.description}</p>
        )}
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

// Layout 4: an editorial menu line — dotted leader, serif name, price on the
// right. The restaurant template's signature section style.
function MenuRow({
  product,
  cart,
  href,
  lbpRate,
  showDescriptions = true,
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
  lbpRate?: number | null;
  showDescriptions?: boolean;
}) {
  const unavailable = productCartLimit(product) === 0;
  return (
    <article
      className={`shop-price-row shop-menu-row${unavailable ? ' is-unavailable' : ''}`}
    >
      <div className="shop-price-row-copy">
        <h3>
          <a href={href}>{product.name}</a>
        </h3>
        {showDescriptions && product.description && (
          <p title={product.description}>{product.description}</p>
        )}
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

// Layout 5: image-first tiles. The name and price sit on the photo, so a
// gallery reads as one continuous wall.
function GalleryTile({
  product,
  cart,
  href,
  lbpRate,
  showDescriptions = true,
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
  lbpRate?: number | null;
  showDescriptions?: boolean;
}) {
  const unavailable = productCartLimit(product) === 0;
  return (
    <article
      className={`shop-product shop-gallery-tile${unavailable ? ' is-unavailable' : ''}`}
    >
      <a
        className="shop-gallery-media"
        href={href}
        aria-label={`Open ${product.name}`}
      >
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
        <StockBadge product={product} cart={cart} />
      </a>
      <div className="shop-gallery-copy">
        <h3>
          <a href={href}>{product.name}</a>
        </h3>
        {showDescriptions && product.description && (
          <p title={product.description}>{product.description}</p>
        )}
        <div className="shop-product-bottom">
          <PriceLabels product={product} lbpRate={lbpRate} />
          <AddToCart product={product} cart={cart} chooseHref={href} />
        </div>
      </div>
    </article>
  );
}

// Layout 6: one hero item followed by regular cards.
function FeaturedItem({
  product,
  cart,
  href,
  lbpRate,
  showDescriptions = true,
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
  lbpRate?: number | null;
  showDescriptions?: boolean;
}) {
  const unavailable = productCartLimit(product) === 0;
  return (
    <article
      className={`shop-product shop-featured-item${unavailable ? ' is-unavailable' : ''}`}
    >
      <a
        className="shop-product-image shop-product-image-link"
        href={href}
        aria-label={`Open ${product.name}`}
      >
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} eager />
        <StockBadge product={product} cart={cart} />
      </a>
      <div className="shop-product-copy">
        <span className="shop-featured-eyebrow">Featured</span>
        <h3>
          <a href={href}>{product.name}</a>
        </h3>
        {showDescriptions && product.description && (
          <p title={product.description}>{product.description}</p>
        )}
        <div className="shop-product-bottom">
          <PriceLabels product={product} lbpRate={lbpRate} />
          <AddToCart product={product} cart={cart} chooseHref={href} />
        </div>
      </div>
    </article>
  );
}

export function CatalogItem({
  product,
  cart,
  layout,
  shopSlug,
  demo,
  lbpRate,
  showDescriptions = true,
}: {
  product: Product;
  cart: ShopCartController;
  layout: CatalogLayout;
  shopSlug: string;
  demo: boolean;
  lbpRate?: number | null;
  showDescriptions?: boolean;
}) {
  const href = storeProductPath(shopSlug, product.slug, demo);
  if (layout === 'cards')
    return (
      <PhotoCard
        product={product}
        cart={cart}
        href={href}
        lbpRate={lbpRate}
        showDescriptions={showDescriptions}
      />
    );
  if (layout === 'compact')
    return (
      <PriceRow
        product={product}
        cart={cart}
        href={href}
        lbpRate={lbpRate}
        showDescriptions={showDescriptions}
      />
    );
  if (layout === 'menu')
    return (
      <MenuRow
        product={product}
        cart={cart}
        href={href}
        lbpRate={lbpRate}
        showDescriptions={showDescriptions}
      />
    );
  if (layout === 'gallery')
    return (
      <GalleryTile
        product={product}
        cart={cart}
        href={href}
        lbpRate={lbpRate}
        showDescriptions={showDescriptions}
      />
    );
  // "featured" and "shelves" are arranged by CatalogItems; a stray item in
  // one of those modes still renders as a normal card.
  if (layout === 'featured' || layout === 'shelves')
    return (
      <PhotoCard
        product={product}
        cart={cart}
        href={href}
        lbpRate={lbpRate}
        showDescriptions={showDescriptions}
      />
    );
  return (
    <ListItem
      product={product}
      cart={cart}
      href={href}
      lbpRate={lbpRate}
      showDescriptions={showDescriptions}
    />
  );
}

export function CatalogItems({
  products,
  cart,
  layout,
  shopSlug,
  demo,
  lbpRate,
  showImages = true,
  showDescriptions = true,
}: {
  products: Product[];
  cart: ShopCartController;
  layout: CatalogLayout;
  shopSlug: string;
  demo: boolean;
  lbpRate?: number | null;
  showImages?: boolean;
  showDescriptions?: boolean;
}) {
  // Without photos, image-led layouts would show empty frames; the compact
  // price list is the honest fallback (a menu keeps its own text-only style).
  const visualLayout: CatalogLayout = showImages
    ? layout
    : layout === 'menu'
      ? 'menu'
      : 'compact';
  const item = (product: Product, variant: CatalogLayout) => (
    <CatalogItem
      key={product.id}
      product={product}
      cart={cart}
      layout={variant}
      shopSlug={shopSlug}
      demo={demo}
      lbpRate={lbpRate}
      showDescriptions={showDescriptions}
    />
  );
  if (visualLayout === 'featured' && products.length > 0) {
    const [first, ...rest] = products;
    return (
      <div className="shop-catalog-items layout-featured">
        <FeaturedItem
          product={first!}
          cart={cart}
          href={storeProductPath(shopSlug, first!.slug, demo)}
          lbpRate={lbpRate}
          showDescriptions={showDescriptions}
        />
        <div className="shop-featured-grid">
          {rest.map((product) => item(product, 'cards'))}
        </div>
      </div>
    );
  }
  if (visualLayout === 'shelves')
    return (
      <div className="shop-catalog-items layout-shelves">
        {products.map((product) => item(product, 'cards'))}
      </div>
    );
  return (
    <div className={`shop-catalog-items layout-${visualLayout}`}>
      {products.map((product) => item(product, visualLayout))}
    </div>
  );
}

export function CatalogLoading({ layout }: { layout: CatalogLayout }) {
  // Skeletons mirror the shape of the chosen layout without inventing data.
  const skeleton: 'list' | 'cards' | 'compact' =
    layout === 'menu' || layout === 'compact'
      ? 'compact'
      : layout === 'list'
        ? 'list'
        : 'cards';
  const rows = skeleton === 'cards' ? 6 : 4;
  return (
    <div
      className={`shop-catalog-items layout-${skeleton}`}
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading items…</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          className={
            skeleton === 'compact'
              ? 'shop-price-row shop-skeleton'
              : 'shop-product shop-skeleton'
          }
          key={index}
          aria-hidden="true"
        >
          {skeleton !== 'compact' && (
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
