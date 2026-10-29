import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Minus,
  Package,
  Pause,
  Play,
  Plus,
} from 'lucide-react';
import { assetUrl, type Product, type SelectedProductOption } from '../lib/api';
import {
  formatProductPrice,
  productCompareAtPriceCents,
  productDiscountPercent,
  productHasOptions,
  productLbpPriceLabel,
  productPriceLabel,
  selectedOptionsKey,
  storeMediaUrl,
  storeProductPath,
  type CatalogLayout,
} from '../lib/storefront';
import { productCartLimit } from '../lib/cart';
import { enableMouseScrolling } from '../lib/website';
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

// A sale owns the free corner of the photo: the discount is the first thing a
// shopper should notice, so it stays above the stock pill.
function SaleBadge({ product }: { product: Product }) {
  const percent = productDiscountPercent(product);
  if (!percent) return null;
  return (
    <span className="shop-sale-label">
      <span className="sr-only">On sale: </span>
      {percent}% off
    </span>
  );
}

// One price block: the amount the shopper pays, the struck-through old price
// during a sale, and the owner's optional LBP line under it.
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
        <SaleBadge product={product} />
        <StockBadge product={product} cart={cart} />
      </a>
      <div className="shop-product-copy">
        <h3>
          <a className="notranslate" href={href}>
            {product.name}
          </a>
        </h3>
        {showDescriptions && product.description && (
          <p className="notranslate" title={product.description}>
            {product.description}
          </p>
        )}
        <div className="shop-product-bottom">
          <PriceLabels product={product} lbpRate={lbpRate} />
          <AddToCart product={product} cart={cart} chooseHref={href} />
        </div>
      </div>
    </article>
  );
}

// Layout 2: photo cards. The card is the box: "square" is a 1:1 tile,
// "portrait" a 3:4 tile and "wide" a 4:3 landscape card. The photo fills
// whatever room the caption leaves, so the box ratio never drifts.
function PhotoCard({
  product,
  cart,
  href,
  lbpRate,
  showDescriptions = true,
  variant = 'square',
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
  lbpRate?: number | null;
  showDescriptions?: boolean;
  variant?: 'square' | 'portrait' | 'wide';
}) {
  const unavailable = productCartLimit(product) === 0;
  return (
    <article
      className={`shop-product shop-photo-card is-${variant}${unavailable ? ' is-unavailable' : ''}`}
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
      <div className="shop-product-copy">
        <h3>
          <a className="notranslate" href={href}>
            {product.name}
          </a>
        </h3>
        {showDescriptions && product.description && (
          <p className="notranslate" title={product.description}>
            {product.description}
          </p>
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
          <a className="notranslate" href={href}>
            {product.name}
          </a>
        </h3>
        {showDescriptions && product.description && (
          <p className="notranslate" title={product.description}>
            {product.description}
          </p>
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
          <a className="notranslate" href={href}>
            {product.name}
          </a>
        </h3>
        {showDescriptions && product.description && (
          <p className="notranslate" title={product.description}>
            {product.description}
          </p>
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

// A capped stagger keeps a long section from rippling for seconds; the
// stylesheet drops the animation entirely under prefers-reduced-motion.
function tileDelay(delay?: number): CSSProperties | undefined {
  return delay === undefined
    ? undefined
    : ({ '--shop-tile-delay': `${delay}ms` } as CSSProperties);
}

// Photo overlay: the 4:3 photo is the whole card and the name, price and action
// ride a frosted glass bar pinned to its bottom edge, so a dense section stays
// quick to scan without turning each item into a big post.
function OverlayCard({
  product,
  cart,
  href,
  lbpRate,
  delay,
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
  lbpRate?: number | null;
  delay?: number;
}) {
  const unavailable = productCartLimit(product) === 0;
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
          <h3>
            <a className="notranslate" href={href}>
              {product.name}
            </a>
          </h3>
        </div>
        <div className="shop-overlay-bottom">
          <PriceLabels product={product} lbpRate={lbpRate} />
          <AddToCart product={product} cart={cart} chooseHref={href} />
        </div>
      </div>
    </article>
  );
}

// One caption block for the photo-first layouts: the name, then the price and
// the shop action on one line. The layout class decides how much room it gets.
function ItemCaption({
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
      <h3>
        <a className="notranslate" href={href}>
          {product.name}
        </a>
      </h3>
      {showDescriptions && product.description && (
        <p className="notranslate" title={product.description}>
          {product.description}
        </p>
      )}
      <div className="shop-item-bottom">
        <PriceLabels product={product} lbpRate={lbpRate} />
        <AddToCart product={product} cart={cart} chooseHref={href} />
      </div>
    </div>
  );
}

type TileVariant =
  'tiles' | 'bento' | 'stagger' | 'sticker' | 'circles' | 'rail';

// Layouts whose items rise in one after another when a section paints.
const revealLayouts: readonly CatalogLayout[] = [
  'overlay',
  'tiles',
  'bento',
  'stagger',
  'sticker',
  'circles',
  'rail',
  'zigzag',
  'index',
  'rows',
];

// Photo tiles, Bento, Staggered, Sticker, Circles and the Photo rail all share
// this card: a 4:3 photo above a quiet caption. Their layout class alone
// decides the grid, the caption treatment and the motion.
function TileCard({
  product,
  cart,
  href,
  lbpRate,
  delay,
  variant,
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
  lbpRate?: number | null;
  delay?: number;
  variant: TileVariant;
}) {
  const unavailable = productCartLimit(product) === 0;
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

// Photo menu: the menu row with a small 4:3 thumbnail. Denser than the card
// layouts, so a long menu stays quick to read to the price.
function RowCard({
  product,
  cart,
  href,
  lbpRate,
  showDescriptions = true,
  delay,
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
  lbpRate?: number | null;
  showDescriptions?: boolean;
  delay?: number;
}) {
  const unavailable = productCartLimit(product) === 0;
  return (
    <article
      className={`shop-price-row shop-photo-row${unavailable ? ' is-unavailable' : ''}`}
      style={tileDelay(delay)}
    >
      <a
        className="shop-photo-row-thumb"
        href={href}
        aria-label={`Open ${product.name}`}
      >
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
        <SaleBadge product={product} />
      </a>
      <div className="shop-price-row-copy">
        <h3>
          <a className="notranslate" href={href}>
            {product.name}
          </a>
        </h3>
        {showDescriptions && product.description && (
          <p className="notranslate" title={product.description}>
            {product.description}
          </p>
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

// Zigzag: a magazine row. The photo and the copy swap sides on every other
// item, so a short menu reads like a spread instead of a list of cards.
function ZigzagRow({
  product,
  cart,
  href,
  lbpRate,
  showDescriptions = true,
  delay,
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
  lbpRate?: number | null;
  showDescriptions?: boolean;
  delay?: number;
}) {
  const unavailable = productCartLimit(product) === 0;
  return (
    <article
      className={`shop-product shop-zigzag-row${unavailable ? ' is-unavailable' : ''}`}
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
        showDescriptions={showDescriptions}
      />
    </article>
  );
}

// Numbered: an editorial list where the index number is the graphic element.
// The number is decoration for the eye, so assistive tech skips it.
function NumberedRow({
  product,
  cart,
  href,
  lbpRate,
  position,
  showDescriptions = true,
  delay,
}: {
  product: Product;
  cart: ShopCartController;
  href: string;
  lbpRate?: number | null;
  position: number;
  showDescriptions?: boolean;
  delay?: number;
}) {
  const unavailable = productCartLimit(product) === 0;
  return (
    <article
      className={`shop-numbered-row${unavailable ? ' is-unavailable' : ''}`}
      style={tileDelay(delay)}
    >
      <span className="shop-numbered-index" aria-hidden="true">
        {String(position).padStart(2, '0')}
      </span>
      <a
        className="shop-numbered-thumb"
        href={href}
        aria-label={`Open ${product.name}`}
      >
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
      </a>
      <div className="shop-numbered-copy">
        <h3>
          <a className="notranslate" href={href}>
            {product.name}
          </a>
        </h3>
        {showDescriptions && product.description && (
          <p className="notranslate" title={product.description}>
            {product.description}
          </p>
        )}
        {unavailable && (
          <span className="shop-price-row-stock">Out of stock</span>
        )}
      </div>
      <PriceLabels
        product={product}
        lbpRate={lbpRate}
        className="shop-numbered-price"
      />
      <AddToCart product={product} cart={cart} chooseHref={href} />
    </article>
  );
}

// One tile of the Ribbon. The repeated set exists only for the seamless loop,
// so it is plain markup that can never take focus or announce itself twice.
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
    <a
      className="shop-ribbon-tile"
      href={href}
      aria-label={`Open ${product.name}`}
    >
      {body}
    </a>
  );
}

// Ribbon: a 4:3 strip that keeps moving. It is a browsing strip, so a tap
// opens the dish and the product page carries the shop action; the pause
// control keeps motion under the visitor's control.
function CatalogRibbon({
  products,
  cart,
  shopSlug,
  demo,
  lbpRate,
}: {
  products: Product[];
  cart: ShopCartController;
  shopSlug: string;
  demo: boolean;
  lbpRate?: number | null;
}) {
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
                href={storeProductPath(shopSlug, product.slug, demo)}
                lbpRate={lbpRate}
                clone={copy > 0}
              />
            ))}
          </div>
        ))}
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

// The sideways rail scrolls on its own; the arrows give mouse and keyboard
// shoppers the same "next card" a swipe gives touch screens.
function ShelfRail({
  children,
  count,
  variant = 'shelves',
}: {
  children: ReactNode;
  count: number;
  variant?: 'shelves' | 'rail';
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [nav, setNav] = useState({
    scrollable: false,
    atStart: true,
    atEnd: true,
  });

  const measure = () => {
    const node = rail.current;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    // RTL runs scrollLeft from 0 down to -max, so compare the magnitude.
    const offset = Math.abs(node.scrollLeft);
    const next = {
      scrollable: max > 2,
      atStart: offset <= 2,
      atEnd: offset >= max - 2,
    };
    setNav((current) =>
      current.scrollable === next.scrollable &&
      current.atStart === next.atStart &&
      current.atEnd === next.atEnd
        ? current
        : next,
    );
  };

  useEffect(() => {
    const node = rail.current;
    if (!node) return;
    measure();
    // The rail keeps its own box width, so only a card count change (or a
    // breakpoint resize) can make the row overflow or stop overflowing.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [count]);

  const scroll = (direction: 1 | -1) => {
    const node = rail.current;
    if (!node) return;
    const rtl = getComputedStyle(node).direction === 'rtl';
    const step = Math.max(node.clientWidth * 0.8, 180);
    node.scrollBy({
      left: (rtl ? -direction : direction) * step,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  };

  // One ref both measures the rail and gives it the site-wide wheel and drag
  // scrolling, so the rail behaves like every other horizontal strip.
  const attachRail = (node: HTMLDivElement | null) => {
    rail.current = node;
    return enableMouseScrolling(node);
  };

  return (
    <div className="shop-catalog-rail">
      <div
        className={`shop-catalog-items layout-${variant}`}
        ref={attachRail}
        onScroll={measure}
        role="group"
        aria-label="Products"
        tabIndex={0}
      >
        {children}
      </div>
      {nav.scrollable && (
        <div className="shop-rail-nav">
          <button
            type="button"
            className="shop-rail-arrow"
            aria-label="Scroll products backward"
            disabled={nav.atStart}
            onClick={() => scroll(-1)}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="shop-rail-arrow"
            aria-label="Scroll products forward"
            disabled={nav.atEnd}
            onClick={() => scroll(1)}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

// Layout 6: the wide 4:3 card, rendered by PhotoCard.

export function CatalogItem({
  product,
  cart,
  layout,
  shopSlug,
  demo,
  lbpRate,
  showDescriptions = true,
  delay,
  position,
}: {
  product: Product;
  cart: ShopCartController;
  layout: CatalogLayout;
  shopSlug: string;
  demo: boolean;
  lbpRate?: number | null;
  showDescriptions?: boolean;
  delay?: number;
  position?: number;
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
      <PhotoCard
        product={product}
        cart={cart}
        href={href}
        lbpRate={lbpRate}
        showDescriptions={showDescriptions}
        variant="portrait"
      />
    );
  // "shelves" is arranged by CatalogItems as a rail of square cards.
  if (layout === 'featured')
    return (
      <PhotoCard
        product={product}
        cart={cart}
        href={href}
        lbpRate={lbpRate}
        showDescriptions={showDescriptions}
        variant="wide"
      />
    );
  if (layout === 'shelves')
    return (
      <PhotoCard
        product={product}
        cart={cart}
        href={href}
        lbpRate={lbpRate}
        showDescriptions={showDescriptions}
      />
    );
  if (layout === 'overlay')
    return (
      <OverlayCard
        product={product}
        cart={cart}
        href={href}
        lbpRate={lbpRate}
        delay={delay}
      />
    );
  if (
    layout === 'tiles' ||
    layout === 'bento' ||
    layout === 'stagger' ||
    layout === 'sticker' ||
    layout === 'circles' ||
    layout === 'rail'
  )
    return (
      <TileCard
        product={product}
        cart={cart}
        href={href}
        lbpRate={lbpRate}
        delay={delay}
        variant={layout}
      />
    );
  if (layout === 'rows')
    return (
      <RowCard
        product={product}
        cart={cart}
        href={href}
        lbpRate={lbpRate}
        showDescriptions={showDescriptions}
        delay={delay}
      />
    );
  if (layout === 'zigzag')
    return (
      <ZigzagRow
        product={product}
        cart={cart}
        href={href}
        lbpRate={lbpRate}
        showDescriptions={showDescriptions}
        delay={delay}
      />
    );
  if (layout === 'index')
    return (
      <NumberedRow
        product={product}
        cart={cart}
        href={href}
        lbpRate={lbpRate}
        position={position ?? 1}
        showDescriptions={showDescriptions}
        delay={delay}
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
  const item = (product: Product, variant: CatalogLayout, index: number) => (
    <CatalogItem
      key={product.id}
      product={product}
      cart={cart}
      layout={variant}
      shopSlug={shopSlug}
      demo={demo}
      lbpRate={lbpRate}
      showDescriptions={showDescriptions}
      position={index + 1}
      delay={
        revealLayouts.includes(variant) ? Math.min(index, 11) * 40 : undefined
      }
    />
  );
  if (visualLayout === 'featured')
    return (
      <div className="shop-catalog-items layout-featured">
        {products.map((product, index) => item(product, 'featured', index))}
      </div>
    );
  if (visualLayout === 'shelves')
    return (
      <ShelfRail count={products.length}>
        {products.map((product, index) => item(product, 'cards', index))}
      </ShelfRail>
    );
  if (visualLayout === 'rail')
    return (
      <ShelfRail count={products.length} variant="rail">
        {products.map((product, index) => item(product, 'rail', index))}
      </ShelfRail>
    );
  if (visualLayout === 'ribbon')
    return (
      <CatalogRibbon
        products={products}
        cart={cart}
        shopSlug={shopSlug}
        demo={demo}
        lbpRate={lbpRate}
      />
    );
  return (
    <div className={`shop-catalog-items layout-${visualLayout}`}>
      {products.map((product, index) => item(product, visualLayout, index))}
    </div>
  );
}

export function CatalogLoading({ layout }: { layout: CatalogLayout }) {
  // The overlay tiles are one solid 4:3 box each, so their skeleton is a plain
  // frame with no caption row to invent.
  if (layout === 'overlay')
    return (
      <div
        className="shop-catalog-items layout-overlay"
        role="status"
        aria-busy="true"
      >
        <span className="sr-only">Loading items…</span>
        {Array.from({ length: 6 }, (_, index) => (
          <div
            className="shop-overlay-card shop-skeleton"
            key={index}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  // Skeletons mirror the shape of the chosen layout without inventing data.
  const strip = layout === 'rail' || layout === 'ribbon';
  const boxed =
    layout === 'tiles' ||
    layout === 'bento' ||
    layout === 'stagger' ||
    layout === 'sticker' ||
    layout === 'circles';
  const lines =
    layout === 'menu' ||
    layout === 'compact' ||
    layout === 'rows' ||
    layout === 'index' ||
    layout === 'zigzag';
  const skeleton: 'list' | 'cards' | 'compact' = lines
    ? 'compact'
    : layout === 'list'
      ? 'list'
      : 'cards';
  // Portrait and wide tiles keep their box ratio while the data loads, and a
  // rail skeleton stays a row so the page does not jump when the cards arrive.
  const portrait = layout === 'gallery';
  const rail = layout === 'shelves';
  const wide = layout === 'featured';
  const rows = strip ? 5 : skeleton === 'cards' ? (wide ? 4 : 6) : 4;
  const frame = strip
    ? 'layout-rail'
    : boxed
      ? `layout-${layout}`
      : rail
        ? 'layout-shelves'
        : wide
          ? 'layout-featured'
          : portrait
            ? 'layout-cards is-portrait'
            : `layout-${skeleton}`;
  return (
    <div
      className={`shop-catalog-items ${frame}`}
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
