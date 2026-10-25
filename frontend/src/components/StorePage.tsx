import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Expand,
  Images,
  Layers,
  LoaderCircle,
  MapPin,
  Minus,
  Package,
  Play,
  Plus,
  Search,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Utensils,
} from 'lucide-react';
import {
  ApiError,
  assetUrl,
  getJson,
  registerPostView,
  type Feed,
  type Post,
  type Product,
  type ProductList,
  type Store,
  type StoreCategoryList,
} from '../lib/api';
import { demoPosts, demoProducts, demoStores } from '../lib/demo';
import {
  formatProductPrice,
  menuCategoryGroups,
  productCategoryKey,
  productCategoryName,
  storeMediaUrl,
  storePresentation,
  storeSocialLinks,
} from '../lib/storefront';
import { branchOpenState, primaryBranch, storeBranches } from '../lib/branches';
import { useWebsiteSettings } from '../hooks/useWebsiteSettings';
import { useShopCart, type ShopCartController } from '../hooks/useShopCart';
import { productCartLimit } from '../lib/cart';
import { ShopCart } from './ShopCart';
import { ShopBranches } from './ShopBranches';
import { SocialIcon } from './SocialIcon';
import { LoadingBar, StatusBanner } from './Feedback';
import { MediaView } from './MediaView';
import { PostDialog } from './PostDialog';
import { StoreAvatar, StoreVerifiedBadge } from './StoreAvatar';

function ShopImage({
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

function ShopCardsLoading({
  posts = false,
  label = 'Loading the collection…',
}: {
  posts?: boolean;
  label?: string;
}) {
  return (
    <div role="status">
      <span className="sr-only">{label}</span>
      <div
        className={posts ? 'shop-post-grid' : 'shop-products'}
        aria-hidden="true"
      >
        {(posts ? [0, 1, 2, 3, 4, 5] : [0, 1, 2]).map((index) => (
          <div
            className={
              posts ? 'shop-post-skeleton shop-skeleton' : 'shop-product'
            }
            key={index}
          >
            {!posts && (
              <>
                <div className="shop-product-image shop-skeleton" />
                <div className="shop-product-copy">
                  <div className="shop-skeleton shop-skeleton-title" />
                  <div className="shop-skeleton shop-skeleton-line" />
                  <div className="shop-skeleton shop-skeleton-short" />
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ShopPageLoading() {
  return (
    <section className="shop-loading" aria-label="Loading shop">
      <div className="shop-banner shop-skeleton" aria-hidden="true" />
      <div className="shop-loading-message" role="status">
        <LoaderCircle className="spin" size={22} />
        <span>Opening the shop…</span>
      </div>
      <div className="shop-profile" aria-hidden="true">
        <div className="shop-logo">
          <span className="store-avatar large shop-skeleton" />
        </div>
        <div className="shop-intro">
          <div className="shop-skeleton shop-skeleton-title" />
          <div className="shop-skeleton shop-skeleton-line" />
          <div className="shop-skeleton shop-skeleton-short" />
        </div>
      </div>
      <div className="shop-loading-content">
        <ShopCardsLoading posts label="Loading posts…" />
      </div>
    </section>
  );
}

function AddToCart({
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

function ProductCard({
  product,
  cart,
}: {
  product: Product;
  cart: ShopCartController;
}) {
  const quantity =
    cart.cart?.items.find((item) => item.productId === product.id)?.quantity ??
    0;
  const unavailable = productCartLimit(product) === 0;
  return (
    <article className={`shop-product${unavailable ? ' is-unavailable' : ''}`}>
      <div className="shop-product-image">
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
        <span className="shop-product-category shop-glass">
          {productCategoryName(product)}
        </span>
        {(unavailable || quantity > 0) && (
          <span className="shop-stock-label shop-glass">
            {!unavailable && <Check size={13} aria-hidden="true" />}
            {unavailable ? 'Unavailable' : `${quantity} in cart`}
          </span>
        )}
      </div>
      <div className="shop-product-copy">
        <h3>{product.name}</h3>
        {product.description && <p>{product.description}</p>}
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

// Menu rows are image-first and compact, so a full page of dishes stays scannable.
function MenuItem({
  product,
  cart,
}: {
  product: Product;
  cart: ShopCartController;
}) {
  const unavailable = productCartLimit(product) === 0;
  return (
    <article
      className={`shop-product shop-menu-item${unavailable ? ' is-unavailable' : ''}`}
    >
      <div className="shop-product-image">
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
      </div>
      <div className="shop-product-copy">
        <h3>{product.name}</h3>
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

export function StorePage({ slug }: { slug: string | null }) {
  const demo = new URLSearchParams(window.location.search).get('demo') === '1';
  const { settings } = useWebsiteSettings(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [activeTab, setActiveTab] = useState<'posts' | 'catalog'>('posts');
  const [focusSearch, setFocusSearch] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [focusContact, setFocusContact] = useState(false);
  const contactDetails = useRef<HTMLElement>(null);
  const [notice, setNotice] = useState('');
  const [sharing, setSharing] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const viewedPosts = useRef(new Set<string>());
  // A restaurant opens on its menu; the choice only sticks once the shopper
  // switches tabs themselves, so a late store response cannot steal the tab.
  const tabChosen = useRef(false);
  const selectTab = (tab: 'posts' | 'catalog') => {
    tabChosen.current = true;
    setActiveTab(tab);
  };

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  const storeQuery = useQuery({
    queryKey: ['storefront', slug],
    queryFn: ({ signal }) =>
      getJson<Store>(`stores/${encodeURIComponent(slug!)}`, signal),
    enabled: Boolean(slug) && !demo,
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 404) && count < 1,
  });
  const notFound =
    !slug ||
    (!demo &&
      storeQuery.error instanceof ApiError &&
      storeQuery.error.status === 404);
  const store = notFound
    ? undefined
    : demo
      ? demoStores.find((item) => item.slug === slug)
      : storeQuery.data;
  const cart = useShopCart(store, demo);
  const productsQuery = useInfiniteQuery({
    queryKey: ['storefront-products', slug],
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      getJson<ProductList>(
        `stores/${encodeURIComponent(slug!)}/products?limit=24&offset=${pageParam}`,
        signal,
      ),
    getNextPageParam: (page, _pages, offset) =>
      page.items.length && offset + page.items.length < page.total
        ? offset + page.items.length
        : undefined,
    enabled: Boolean(store) && !demo,
  });
  const categoriesQuery = useQuery({
    queryKey: ['storefront-categories', slug],
    queryFn: ({ signal }) =>
      getJson<StoreCategoryList>(
        `stores/${encodeURIComponent(slug!)}/categories`,
        signal,
      ),
    enabled: Boolean(store) && !demo,
    staleTime: 5 * 60_000,
  });
  const postsQuery = useInfiniteQuery({
    queryKey: ['storefront-posts', slug],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ limit: '6', algorithm: 'recent' });
      if (pageParam) params.set('cursor', pageParam);
      return getJson<Feed>(
        `feed/store/${encodeURIComponent(slug!)}?${params}`,
        signal,
      );
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    enabled: Boolean(store) && !demo,
  });
  const presentation = storePresentation(store ?? { brandColor: null });
  const missing = notFound || (demo && !store);
  const loadingShop = !store && !missing && !storeQuery.isError;
  useEffect(() => {
    if (tabChosen.current || !store) return;
    if (store.storeType === 'restaurant_menu') setActiveTab('catalog');
  }, [store]);
  useEffect(() => {
    document.title = `${store?.name ?? (missing ? 'Shop not found' : 'Shop')} — ${settings.siteName}`;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        store?.description ||
          `Explore ${store?.name || 'independent shops'} on ${settings.siteName}.`,
      );
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', presentation.theme['--brand-primary']);
    document
      .getElementById('site-favicon')
      ?.setAttribute(
        'href',
        assetUrl(storeMediaUrl(store?.logoKey)) ||
          assetUrl(settings.faviconUrl) ||
          '/favicon.svg',
      );
  }, [store, missing, settings, presentation.theme['--brand-primary']]);

  useEffect(() => {
    if (!focusSearch || activeTab !== 'catalog') return;
    document.getElementById('shop-catalog')?.scrollIntoView();
    searchInput.current?.focus({ preventScroll: true });
    setFocusSearch(false);
  }, [activeTab, focusSearch]);

  useEffect(() => {
    if (!focusContact || !contactOpen) return;
    contactDetails.current?.scrollIntoView({ block: 'nearest' });
    contactDetails.current?.focus({ preventScroll: true });
    setFocusContact(false);
  }, [contactOpen, focusContact]);

  const home = demo ? '/?demo=1' : '/';
  const products = demo
    ? demoProducts.filter((item) => item.storeId === store?.id)
    : (productsQuery.data?.pages.flatMap((page) => page.items) ?? []);
  const posts = demo
    ? demoPosts.filter((item) => item.store?.id === store?.id)
    : (postsQuery.data?.pages.flatMap((page) => page.items) ?? []);
  const uniqueProducts = [
    ...new Map(products.map((item) => [item.id, item])).values(),
  ];
  // Owner-defined categories keep the shop's order; product-only categories
  // (older products without a category row) are appended by the helper.
  const menuGroups = menuCategoryGroups(
    uniqueProducts,
    demo ? [] : (categoriesQuery.data?.items ?? []),
  );
  const showCategoryCounts = demo || !productsQuery.hasNextPage;
  const catalogTotal = demo
    ? uniqueProducts.length
    : (productsQuery.data?.pages[0]?.total ?? uniqueProducts.length);
  const visible = uniqueProducts.filter(
    (item) =>
      (!category || productCategoryKey(item) === category) &&
      `${item.name} ${item.description ?? ''}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const branches = storeBranches(store);
  const mainBranch = primaryBranch(branches);
  const branchOpenStates = branches
    .map((branch) => branchOpenState(branch.openingHours))
    .filter((state): state is NonNullable<typeof state> => Boolean(state));
  const mainOpenState =
    branchOpenStates.find((state) => state.open) ?? branchOpenStates[0] ?? null;
  const socials = storeSocialLinks(store);
  const locationLabel =
    branches.length > 1
      ? `${branches.length} branches`
      : [mainBranch?.city, mainBranch?.country]
          .filter((value) => value?.trim())
          .join(', ') ||
        mainBranch?.name ||
        'Shop location';

  function openContactDetails() {
    setContactOpen(true);
    setFocusContact(true);
  }

  function openStorePost(post: Post) {
    setSelectedPost(post);
    if (demo || viewedPosts.current.has(post.id)) return;
    // Opening a post is the view; refresh the dialog counter in place.
    viewedPosts.current.add(post.id);
    void registerPostView(post.id)
      .then(({ views }) =>
        setSelectedPost((current) =>
          current?.id === post.id
            ? {
                ...current,
                engagement: { ...current.engagement, views },
              }
            : current,
        ),
      )
      .catch(() => {
        /* Views never block opening a post. */
      });
  }

  async function shareShop() {
    if (!store || sharing) return;
    const url = `${window.location.origin}${window.location.pathname}${demo ? '?demo=1' : ''}`;
    setNotice('');
    setSharing(true);
    try {
      if (navigator.share) {
        await navigator.share({ title: store.name, url });
      } else {
        await navigator.clipboard.writeText(url);
        setNotice('Shop link copied.');
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        setNotice(
          'Couldn’t share the link. You can copy it from the address bar.',
        );
      }
    } finally {
      setSharing(false);
    }
  }

  const cartItems = cart.cart?.itemCount ?? 0;
  const toast = cart.flash
    ? {
        tone: cart.flash.tone,
        text: cart.flash.text,
        key: `cart-${cart.flash.key}`,
      }
    : notice
      ? { tone: 'info' as const, text: notice, key: 'notice' }
      : null;

  return (
    <div
      className={`app storefront ${store ? 'has-store' : ''} ${presentation.restaurant ? 'storefront-restaurant' : 'storefront-retail'}${cartItems > 0 && !cart.open ? ' has-cart' : ''}`}
      style={presentation.theme as CSSProperties}
    >
      <a className="skip-link" href="#shop-main">
        Skip to shop
      </a>
      <header id="shop-top" className="shop-topbar">
        <a className="shop-back shop-glass" href={home}>
          <ArrowLeft size={17} aria-hidden="true" /> Back to home
        </a>
        {store ? (
          <div
            className="shop-tools"
            role="group"
            aria-label="Shop quick actions"
          >
            <button
              type="button"
              className="shop-glass"
              aria-label="Search this shop"
              title="Search this shop"
              onClick={() => {
                setActiveTab('catalog');
                setFocusSearch(true);
              }}
            >
              <Search size={21} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="shop-glass"
              aria-label="Share this shop"
              title="Share this shop"
              disabled={sharing}
              onClick={() => void shareShop()}
            >
              <Share2 size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="shop-glass"
              onClick={() => cart.setOpen(true)}
              aria-label={`Open cart${cart.cart?.itemCount ? `, ${cart.cart.itemCount} items` : ''}`}
              aria-haspopup="dialog"
              aria-expanded={cart.open}
              title="Shopping cart"
            >
              <ShoppingCart size={21} aria-hidden="true" />
              {cart.cart && cart.cart.itemCount > 0 && (
                <span className="shop-cart-count" aria-hidden="true">
                  {cart.cart.itemCount > 99 ? '99+' : cart.cart.itemCount}
                </span>
              )}
            </button>
          </div>
        ) : (
          <a className="shop-platform" href={home}>
            <ShoppingBag size={18} aria-hidden="true" />
            {settings.siteName}
          </a>
        )}
      </header>
      {loadingShop && <LoadingBar />}
      <main id="shop-main" className="shop-main" aria-busy={loadingShop}>
        {loadingShop ? (
          <ShopPageLoading />
        ) : !store ? (
          <section className="shop-state" role="status">
            <Package size={36} />
            <h1>
              {missing
                ? 'This shop couldn’t be found.'
                : storeQuery.isError
                  ? 'This shop is temporarily unavailable.'
                  : 'Opening the shop…'}
            </h1>
            <p>
              {missing
                ? 'Check the address, or discover another independent shop.'
                : storeQuery.isError
                  ? 'Please try again in a moment.'
                  : 'Getting its latest collection and details ready.'}
            </p>
            {storeQuery.isError && !missing && (
              <button
                className="primary-button"
                onClick={() => void storeQuery.refetch()}
                disabled={storeQuery.isFetching}
              >
                Try again
              </button>
            )}
            <a className="secondary-button" href={home}>
              Back to discoveries
            </a>
          </section>
        ) : (
          <>
            <section className="shop-hero" aria-labelledby="shop-title">
              <div className="shop-banner">
                <ShopImage
                  value={store.bannerKey || store.logoKey}
                  alt=""
                  eager
                  fallbackName={store.name}
                />
              </div>
              <div className="shop-profile">
                <div className="shop-logo">
                  <StoreAvatar store={store} large />
                </div>
                <div className="shop-intro">
                  <h1 id="shop-title">
                    <span>{store.name}</span>
                    <StoreVerifiedBadge store={store} size={26} />
                  </h1>
                  {store.description?.trim() && (
                    <p className="shop-description">{store.description}</p>
                  )}
                  {presentation.restaurant && catalogTotal > 0 && (
                    <p className="shop-menu-summary">
                      <Utensils size={15} aria-hidden="true" />
                      {catalogTotal} {catalogTotal === 1 ? 'item' : 'items'}
                      {menuGroups.length > 0
                        ? ` across ${menuGroups.length} menu ${menuGroups.length === 1 ? 'section' : 'sections'}`
                        : ' on the menu'}
                    </p>
                  )}
                  {(socials.length > 0 || branches.length > 0) && (
                    <div className="shop-meta">
                      {socials.length > 0 && (
                        <nav
                          className="shop-socials"
                          aria-label="Shop social links"
                        >
                          {socials.map(({ network, label, href }) => (
                            <a
                              key={network}
                              className="shop-glass"
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`${store.name} on ${label} (opens in a new tab)`}
                              title={label}
                            >
                              <SocialIcon network={network} size={19} />
                            </a>
                          ))}
                        </nav>
                      )}
                      {branches.length > 0 && (
                        <button
                          type="button"
                          className="shop-location shop-location-toggle shop-glass"
                          aria-expanded={contactOpen}
                          aria-controls="shop-contact-details"
                          onClick={() =>
                            contactOpen
                              ? setContactOpen(false)
                              : openContactDetails()
                          }
                        >
                          <MapPin size={16} aria-hidden="true" />
                          <span>{locationLabel}</span>
                          <span className="shop-map-label">
                            {contactOpen
                              ? 'Hide details'
                              : branches.length > 1
                                ? 'View branches'
                                : 'View details'}
                          </span>
                          <ChevronDown
                            className="shop-map-chevron"
                            size={15}
                            aria-hidden="true"
                          />
                        </button>
                      )}
                      {mainOpenState && (
                        <span
                          className={`shop-hero-open ${mainOpenState.open ? 'is-open' : ''}`}
                          title={mainOpenState.label}
                        >
                          <span aria-hidden="true" />
                          {mainOpenState.open ? 'Open now' : 'Closed'}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <ShopBranches
                  store={store}
                  open={contactOpen}
                  onClose={() => setContactOpen(false)}
                  panelRef={contactDetails}
                />
              </div>
            </section>
            {demo && (
              <StatusBanner
                demo
                action="View live discoveries"
                onAction={() => window.location.assign('/')}
              >
                Design preview · Sample shop and products, not live content.
              </StatusBanner>
            )}
            {!demo && storeQuery.isError && (
              <StatusBanner
                action="Retry shop details"
                onAction={() => void storeQuery.refetch()}
              >
                Shop details couldn’t refresh. The last loaded details are
                shown.
              </StatusBanner>
            )}
            <div className="shop-content">
              <div
                className="shop-nav"
                role="tablist"
                aria-label="Shop content"
              >
                {(
                  [
                    { id: 'posts', label: 'Posts', Icon: Images },
                    {
                      id: 'catalog',
                      label: presentation.catalogTabLabel,
                      Icon: presentation.restaurant ? Utensils : ShoppingBag,
                    },
                  ] as const
                ).map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    id={`shop-tab-${id}`}
                    type="button"
                    role="tab"
                    aria-controls={`shop-${id}`}
                    aria-selected={activeTab === id}
                    tabIndex={activeTab === id ? 0 : -1}
                    onClick={() => selectTab(id)}
                    onKeyDown={(event) => {
                      let next: 'posts' | 'catalog';
                      if (event.key === 'Home') next = 'posts';
                      else if (event.key === 'End') next = 'catalog';
                      else if (
                        event.key === 'ArrowLeft' ||
                        event.key === 'ArrowRight'
                      )
                        next = id === 'posts' ? 'catalog' : 'posts';
                      else return;
                      event.preventDefault();
                      selectTab(next);
                      document.getElementById(`shop-tab-${next}`)?.focus();
                    }}
                  >
                    <Icon size={18} aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>
              <section
                id="shop-posts"
                className="shop-section shop-tabpanel shop-posts-panel"
                role="tabpanel"
                aria-labelledby="shop-tab-posts"
                tabIndex={0}
                hidden={activeTab !== 'posts'}
              >
                {activeTab === 'posts' && (
                  <>
                    <h2 className="sr-only">Posts</h2>
                    {!demo && postsQuery.isPending && (
                      <ShopCardsLoading posts label="Loading posts…" />
                    )}
                    {!demo && postsQuery.isError && (
                      <StatusBanner
                        action="Retry posts"
                        onAction={() => void postsQuery.refetch()}
                      >
                        Posts couldn’t load right now.
                      </StatusBanner>
                    )}
                    <div className="shop-post-grid">
                      {[
                        ...new Map(
                          posts.map((post) => [post.id, post]),
                        ).values(),
                      ].map((post) => (
                        <button
                          className="shop-post-tile"
                          key={post.id}
                          type="button"
                          aria-label={`Open post: ${post.title}`}
                          aria-haspopup="dialog"
                          onClick={() => openStorePost(post)}
                        >
                          <span
                            className="shop-post-thumbnail"
                            aria-hidden="true"
                          >
                            <MediaView
                              media={post.media[0]}
                              title={post.title}
                            />
                          </span>
                          <span
                            className="shop-post-indicators"
                            aria-hidden="true"
                          >
                            {post.media.some(
                              (media) => media.kind === 'video',
                            ) && <Play size={19} fill="currentColor" />}
                            {post.media.length > 1 && <Layers size={19} />}
                          </span>
                          <span className="shop-post-open" aria-hidden="true">
                            <Expand size={25} />
                          </span>
                        </button>
                      ))}
                    </div>
                    {!posts.length && (demo || postsQuery.isSuccess) && (
                      <p className="shop-inline-state">
                        This shop hasn’t shared any posts yet.
                      </p>
                    )}
                    {!demo && postsQuery.hasNextPage && (
                      <button
                        className="secondary-button"
                        disabled={postsQuery.isFetching}
                        onClick={() => void postsQuery.fetchNextPage()}
                      >
                        {postsQuery.isFetchingNextPage && (
                          <LoaderCircle
                            className="spin"
                            size={16}
                            aria-hidden="true"
                          />
                        )}
                        {postsQuery.isFetchingNextPage
                          ? 'Loading…'
                          : 'More posts'}
                      </button>
                    )}
                  </>
                )}
              </section>
              <section
                id="shop-catalog"
                className="shop-section shop-tabpanel"
                role="tabpanel"
                aria-labelledby="shop-tab-catalog"
                tabIndex={0}
                hidden={activeTab !== 'catalog'}
              >
                <div
                  className={`shop-catalog-layout${menuGroups.length > 0 ? ' has-categories' : ''}`}
                >
                  <div className="shop-catalog-head">
                    <div className="shop-catalog-title">
                      <h2 id="catalog-title">
                        {presentation.restaurant ? 'Our menu' : 'Our products'}
                      </h2>
                      {(demo || productsQuery.isSuccess) && (
                        <p className="shop-results" role="status">
                          {visible.length}{' '}
                          {visible.length === 1 ? 'item' : 'items'}
                          {search || category ? ' found' : ''}
                          {!demo && productsQuery.hasNextPage
                            ? ' in the loaded collection'
                            : ''}
                        </p>
                      )}
                    </div>
                    <div className="shop-catalog-tools">
                      <label className="shop-search">
                        <Search size={18} aria-hidden="true" />
                        <span className="sr-only">
                          Search loaded{' '}
                          {presentation.restaurant ? 'menu items' : 'products'}
                        </span>
                        <input
                          ref={searchInput}
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder={
                            presentation.restaurant
                              ? 'Search the menu…'
                              : 'Search products…'
                          }
                          type="search"
                        />
                      </label>
                      {(search || category) && (
                        <button
                          type="button"
                          className="shop-clear-filters"
                          onClick={() => {
                            setSearch('');
                            setCategory('');
                          }}
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  </div>
                  {menuGroups.length > 0 && (
                    <nav
                      className="shop-catalog-rail"
                      aria-label={
                        presentation.restaurant
                          ? 'Menu categories'
                          : 'Product categories'
                      }
                    >
                      <p className="shop-rail-title" aria-hidden="true">
                        {presentation.restaurant ? 'Menu' : 'Categories'}
                      </p>
                      <div
                        className="shop-category-list"
                        role="group"
                        aria-label="Filter by category"
                      >
                        <button
                          type="button"
                          aria-pressed={!category}
                          onClick={() => setCategory('')}
                        >
                          <span>All items</span>
                          {showCategoryCounts && (
                            <span className="shop-category-count">
                              {uniqueProducts.length}
                            </span>
                          )}
                        </button>
                        {menuGroups.map((group) => (
                          <button
                            key={group.key}
                            type="button"
                            aria-pressed={category === group.key}
                            onClick={() => setCategory(group.key)}
                          >
                            <span>{group.name}</span>
                            {showCategoryCounts && (
                              <span className="shop-category-count">
                                {group.count}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </nav>
                  )}
                  <div className="shop-catalog-body">
                    {!demo && productsQuery.isPending && (
                      <ShopCardsLoading
                        label={
                          presentation.restaurant
                            ? 'Loading the menu…'
                            : 'Loading the collection…'
                        }
                      />
                    )}
                    {!demo && productsQuery.isError && (
                      <StatusBanner
                        action="Try again"
                        onAction={() => void productsQuery.refetch()}
                      >
                        The {presentation.restaurant ? 'menu' : 'collection'}{' '}
                        couldn’t load. Please try again.
                      </StatusBanner>
                    )}
                    {visible.length > 0 &&
                      (presentation.restaurant ? (
                        <div className="shop-menu">
                          {menuGroups.map((group, index) => {
                            const items = visible.filter(
                              (product) =>
                                productCategoryKey(product) === group.key,
                            );
                            if (!items.length) return null;
                            return (
                              <section
                                className="shop-menu-group"
                                key={group.key}
                                aria-labelledby={`shop-menu-${index}`}
                              >
                                <header className="shop-menu-heading">
                                  <h3 id={`shop-menu-${index}`}>
                                    {group.name}
                                  </h3>
                                  <span>
                                    {items.length}{' '}
                                    {items.length === 1 ? 'item' : 'items'}
                                  </span>
                                </header>
                                <div className="shop-products">
                                  {items.map((product) => (
                                    <MenuItem
                                      key={product.id}
                                      product={product}
                                      cart={cart}
                                    />
                                  ))}
                                </div>
                              </section>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="shop-products">
                          {visible.map((product) => (
                            <ProductCard
                              key={product.id}
                              product={product}
                              cart={cart}
                            />
                          ))}
                        </div>
                      ))}
                    {!visible.length && (demo || productsQuery.isSuccess) && (
                      <div className="shop-inline-state">
                        <h3>
                          {search || category
                            ? 'No matching items in this selection.'
                            : presentation.restaurant
                              ? 'The menu is coming soon.'
                              : 'New finds are on their way.'}
                        </h3>
                        <p>
                          {search || category
                            ? 'Try another search or category, or load more items below.'
                            : 'Check back soon for the latest from this shop.'}
                        </p>
                        {(search || category) && (
                          <button
                            className="secondary-button"
                            onClick={() => {
                              setSearch('');
                              setCategory('');
                            }}
                          >
                            Clear filters
                          </button>
                        )}
                      </div>
                    )}
                    {!demo && productsQuery.hasNextPage && (
                      <div className="shop-pagination">
                        <p>
                          Showing {uniqueProducts.length} loaded items. Search
                          and categories apply to these items.
                        </p>
                        <button
                          className="secondary-button"
                          disabled={productsQuery.isFetching}
                          onClick={() => void productsQuery.fetchNextPage()}
                        >
                          {productsQuery.isFetchingNextPage && (
                            <LoaderCircle
                              className="spin"
                              size={16}
                              aria-hidden="true"
                            />
                          )}
                          {productsQuery.isFetchingNextPage
                            ? 'Loading…'
                            : 'Load more items'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
      </main>
      <footer className="shop-footer">
        <div className="shop-footer-main">
          <div className="shop-footer-brand">
            <StoreAvatar store={store} />
            <div>
              <strong>{store?.name || 'Independent shops'}</strong>
              <p>A little discovery. Something special.</p>
            </div>
          </div>
          <a className="shop-footer-platform shop-glass" href={home}>
            <ShoppingBag size={20} aria-hidden="true" />
            <span>
              <small>Powered by</small>
              <strong>{settings.siteName}</strong>
            </span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </div>
        <div className="shop-footer-bottom">
          <p>
            © {new Date().getFullYear()} {store?.name || settings.siteName}
          </p>
          <a className="shop-footer-top" href="#shop-top">
            Back to top
            <span className="shop-glass">
              <ArrowUp size={16} aria-hidden="true" />
            </span>
          </a>
        </div>
      </footer>
      {cartItems > 0 && !cart.open && store && (
        <div className="shop-cart-dock">
          <button
            type="button"
            className="shop-cart-dock-button"
            onClick={() => cart.setOpen(true)}
            aria-haspopup="dialog"
            aria-label={`View cart, ${cartItems} ${cartItems === 1 ? 'item' : 'items'}, subtotal ${formatProductPrice(cart.cart?.subtotalCents ?? '0', cart.cart?.currency ?? 'USD')}`}
          >
            <span className="shop-cart-dock-count" aria-hidden="true">
              <ShoppingCart size={21} />
              <strong>{cartItems > 99 ? '99+' : cartItems}</strong>
            </span>
            <span className="shop-cart-dock-copy">
              <small>
                {cartItems} {cartItems === 1 ? 'item' : 'items'} in cart
              </small>
              <strong>
                {formatProductPrice(
                  cart.cart?.subtotalCents ?? '0',
                  cart.cart?.currency ?? 'USD',
                )}
              </strong>
            </span>
            <span className="shop-cart-dock-action" aria-hidden="true">
              View cart
              <ArrowUpRight size={15} />
            </span>
          </button>
        </div>
      )}
      {cart.open && store && (
        <ShopCart
          store={store}
          products={uniqueProducts}
          controller={cart}
          demo={demo}
          onBrowse={() => {
            cart.setOpen(false);
            selectTab('catalog');
            setFocusSearch(true);
          }}
          onContact={() => {
            cart.setOpen(false);
            openContactDetails();
          }}
        />
      )}
      {selectedPost && store && activeTab === 'posts' && (
        <PostDialog
          key={selectedPost.id}
          post={{ ...selectedPost, store: selectedPost.store ?? store }}
          initialIndex={0}
          viewOnly
          demo={demo}
          onClose={() => setSelectedPost(null)}
        />
      )}
      {toast && (
        <div
          key={toast.key}
          className={`toast shop-notice is-${toast.tone}`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
        >
          {toast.tone === 'success' ? (
            <Check size={16} aria-hidden="true" />
          ) : toast.tone === 'error' ? (
            <AlertCircle size={16} aria-hidden="true" />
          ) : (
            <Share2 size={16} aria-hidden="true" />
          )}
          {toast.text}
        </div>
      )}
    </div>
  );
}
