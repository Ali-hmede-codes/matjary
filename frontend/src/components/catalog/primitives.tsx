import {
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from 'react';
import {
  ArrowUpRight,
  Ban,
  Check,
  Minus,
  Package,
  Plus,
  ShoppingCart,
  SlidersHorizontal,
} from 'lucide-react';
import {
  assetUrl,
  type Product,
  type SelectedProductOption,
} from '../../lib/api';
import {
  formatProductPrice,
  productCompareAtPriceCents,
  productDiscountPercent,
  productHasOptions,
  productLbpPriceLabel,
  productPriceLabel,
  selectedOptionsKey,
  storeMediaUrl,
  storeMenuItemPath,
} from '../../lib/storefront';
import { productCartLimit } from '../../lib/cart';
import type { ShopCartController } from '../../hooks/useShopCart';
import { useProductOptions } from '../options/context';

// ---------------------------------------------------------------------------
// Shared catalog primitives
// ---------------------------------------------------------------------------
// The pieces every grid composes: the photo, the cart control, the sale and
// stock pills, the price block and the small name/description slots. A grid
// file only decides the arrangement; nothing here knows what a grid looks like.

/** A product photo with a loading skeleton and an initials fallback. */
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
              <strong className="notranslate">{fallbackName}</strong>
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

/**
 * The one product link. Shops in menu mode have no item detail page, so a tap
 * opens the option sheet in place; a retail shop keeps the real link (including
 * middle-click and new-tab behaviour) and only its Choose control opens the
 * sheet. `quickView` comes from the storefront provider, never from the card.
 */
export function ProductLink({
  product,
  href,
  className,
  ariaLabel,
  onClick,
  children,
}: {
  product: Product;
  href: string;
  className?: string;
  ariaLabel?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  children: ReactNode;
}) {
  const options = useProductOptions();
  const quickView = options?.quickView === true;
  // Menu cards still render a real link for middle-click and no-JS crawlers:
  // it points at the shop menu with the item selected, never at the removed
  // detail path that would answer with a redirect.
  const menuHref =
    quickView && options?.shopSlug
      ? storeMenuItemPath(options.shopSlug, product.slug)
      : undefined;
  return (
    <a
      className={className}
      href={menuHref ?? href}
      aria-label={ariaLabel}
      aria-haspopup={quickView ? 'dialog' : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!quickView || event.defaultPrevented) return;
        // Modified clicks still open the real address in a new tab.
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        options?.open(product);
      }}
    >
      {children}
    </a>
  );
}

/** Add, or a quantity stepper once the item already sits in the cart. */
export function AddToCart({
  product,
  cart,
  selectedOptions = null,
  chooseHref,
  label = 'Add',
  icon = 'plus',
  iconOnly = false,
}: {
  product: Product;
  cart: ShopCartController;
  selectedOptions?: SelectedProductOption[] | null;
  chooseHref?: string;
  /** The word after the icon; the glass grid asks for "Add to cart". */
  label?: string;
  /** A built-in icon, or a custom one for a card with its own action mark. */
  icon?: 'plus' | 'cart' | ReactNode;
  /**
   * A square, icon-only control for compact cards (the frame grid). The
   * accessible name stays on the control, so nothing is lost without the word.
   */
  iconOnly?: boolean;
}) {
  const quickOptions = useProductOptions();
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
    return iconOnly ? (
      <button
        type="button"
        className="shop-add-to-cart is-sold-out is-icon"
        disabled
        aria-label={`${product.name} is out of stock`}
        title={`${product.name} is out of stock`}
      >
        <Ban size={18} aria-hidden="true" />
      </button>
    ) : (
      <button
        type="button"
        className="shop-add-to-cart is-sold-out"
        disabled
        title={`${product.name} is out of stock`}
      >
        Out of stock
      </button>
    );
  // Products with choices never add their base row: the shopper picks a size
  // or colour first. On a catalogue card that picker is the in-place sheet;
  // without a provider (the design preview) the old details link stays.
  if (productHasOptions(product) && !selectedOptions?.length) {
    const chooseLabel =
      productQuantity > 0
        ? `Choose options for ${product.name}, ${productQuantity} in cart`
        : `Choose options for ${product.name}`;
    const chooseCount =
      productQuantity > 0 ? (
        <span className="shop-choose-count" aria-hidden="true">
          {productQuantity > 99 ? '99+' : productQuantity}
        </span>
      ) : null;
    if (quickOptions && chooseHref)
      return (
        <button
          type="button"
          className={`shop-add-to-cart is-choose${iconOnly ? ' is-icon' : ''}`}
          aria-label={chooseLabel}
          aria-haspopup="dialog"
          title={chooseLabel}
          onClick={() => quickOptions.open(product)}
        >
          <SlidersHorizontal size={iconOnly ? 18 : 15} aria-hidden="true" />
          {!iconOnly && 'Choose'}
          {chooseCount}
        </button>
      );
    if (chooseHref)
      return iconOnly ? (
        <a
          className="shop-add-to-cart is-icon"
          href={chooseHref}
          aria-label={chooseLabel}
        >
          <ArrowUpRight size={18} aria-hidden="true" />
        </a>
      ) : (
        <a
          className="shop-add-to-cart"
          href={chooseHref}
          aria-label={chooseLabel}
        >
          Choose
        </a>
      );
    return iconOnly ? (
      <button
        type="button"
        className="shop-add-to-cart is-icon is-choose"
        disabled
        aria-label={chooseLabel}
        title="Choose a value for each option first"
      >
        <SlidersHorizontal size={18} aria-hidden="true" />
      </button>
    ) : (
      <button
        type="button"
        className="shop-add-to-cart is-choose"
        disabled
        title="Choose a value for each option first"
      >
        Choose options
      </button>
    );
  }
  // The cart never opens on add; the quantity control and toast confirm it.
  if (!item)
    return (
      <button
        type="button"
        className={`shop-add-to-cart${iconOnly ? ' is-icon' : ''}`}
        disabled={blocked}
        aria-label={`Add ${product.name} to cart`}
        title={`Add ${product.name} to cart`}
        onClick={() => void cart.add(product, selectedOptions)}
      >
        {icon === 'cart' ? (
          <ShoppingCart size={17} aria-hidden="true" />
        ) : icon === 'plus' ? (
          <Plus size={17} aria-hidden="true" />
        ) : (
          icon
        )}
        {!iconOnly && label}
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

/** One badge per item: availability first, then the shopper's own cart line. */
export function StockBadge({
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
  // Every option combination is its own cart line; the badge counts them all.
  const quantity =
    cart.cart?.items
      .filter((item) => item.productId === product.id)
      .reduce((sum, item) => sum + item.quantity, 0) ?? 0;
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

// A sale owns the free corner of the photo: the discount is the first thing a
// shopper should notice, so it stays above the stock pill.
export function SaleBadge({ product }: { product: Product }) {
  const percent = productDiscountPercent(product);
  if (!percent) return null;
  return (
    <span className="shop-sale-label">
      <span className="sr-only">On sale: </span>
      {percent}% off
    </span>
  );
}

/**
 * One price block: the amount the shopper pays, the struck-through old price
 * during a sale, and the owner's optional LBP line under it.
 */
export function PriceLabels({
  product,
  lbpRate,
  className,
}: {
  product: Product;
  lbpRate?: number | null;
  className?: string;
}) {
  const lbp = productLbpPriceLabel(product, lbpRate ?? null);
  const compareAt = productCompareAtPriceCents(product);
  return (
    <span className={`price-stack${className ? ` ${className}` : ''}`}>
      <strong>
        {productPriceLabel(product)}
        {compareAt && (
          <s className="price-was">
            {formatProductPrice(compareAt, product.currency)}
          </s>
        )}
      </strong>
      {lbp && <small className="price-lbp">{lbp}</small>}
    </span>
  );
}

/** The product name as the one heading a card carries. */
export function ProductName({
  product,
  href,
}: {
  product: Product;
  href: string;
}) {
  return (
    <h3>
      <ProductLink product={product} href={href} className="notranslate">
        {product.name}
      </ProductLink>
    </h3>
  );
}

/** The optional description line; the single-line ellipsis is CSS-owned. */
export function ProductDescription({
  product,
  visible = true,
}: {
  product: Product;
  visible?: boolean;
}) {
  if (!visible || !product.description) return null;
  return (
    <p className="notranslate" title={product.description}>
      {product.description}
    </p>
  );
}

/** True when the shop has sold out the item for now. */
export function isUnavailable(product: Product): boolean {
  return productCartLimit(product) === 0;
}

/**
 * A capped stagger keeps a long section from rippling for seconds; the
 * stylesheet drops the animation entirely under prefers-reduced-motion.
 */
export function tileDelay(delay?: number): CSSProperties | undefined {
  return delay === undefined
    ? undefined
    : ({ '--shop-tile-delay': `${delay}ms` } as CSSProperties);
}

/** The capped reveal delay for the `index`-th item of a rising grid. */
export function revealDelay(index: number): number {
  return Math.min(index, 11) * 40;
}

/**
 * One caption block for the photo-first layouts: the name, then the price and
 * the shop action on one line. The layout class decides how much room it gets.
 */
export function ItemCaption({
  product,
  cart,
  href,
  lbpRate,
  showDescriptions = false,
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
  lbpRate?: number | null;
  showDescriptions?: boolean;
}) {
  return (
    <div className="shop-item-caption">
      <ProductName product={product} href={href} />
      <ProductDescription product={product} visible={showDescriptions} />
      <div className="shop-item-bottom">
        <PriceLabels product={product} lbpRate={lbpRate} />
        <AddToCart product={product} cart={cart} chooseHref={href} />
      </div>
    </div>
  );
}
