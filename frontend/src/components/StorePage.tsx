import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Expand,
  Images,
  Info,
  Layers,
  LoaderCircle,
  MapPin,
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
} from '../lib/api';
import { demoPosts, demoProducts, demoStores } from '../lib/demo';
import {
  formatProductPrice,
  productCategoryLabel,
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

const productCategoryKey = (product: Product) =>
  product.categoryId ?? product.category;
const productCategoryName = (product: Product) =>
  product.categoryName ?? productCategoryLabel(product.category);

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
        <div className="shop-actions shop-skeleton shop-skeleton-button" />
      </div>
      <div className="shop-loading-content">
        <ShopCardsLoading posts label="Loading posts…" />
      </div>
    </section>
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
  const atLimit = quantity >= productCartLimit(product);
  const actionLabel = unavailable
    ? `${product.name} is unavailable`
    : atLimit
      ? `Maximum quantity of ${product.name} in cart`
      : `Add ${product.name} to cart`;
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
          <button
            type="button"
            className="shop-add-to-cart"
            disabled={unavailable || atLimit || cart.busy || cart.loading}
            aria-label={actionLabel}
            title={actionLabel}
            aria-haspopup="dialog"
            onClick={() => cart.add(product)}
          >
            {unavailable ? (
              <Package size={20} aria-hidden="true" />
            ) : atLimit ? (
              <Check size={20} aria-hidden="true" />
            ) : (
              <Plus size={22} aria-hidden="true" />
            )}
          </button>
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
  const categoryNames = new Map<string, string>();
  for (const item of uniqueProducts) {
    categoryNames.set(productCategoryKey(item), productCategoryName(item));
  }
  const categories = [...categoryNames.keys()];
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

  return (
    <div
      className={`app storefront ${store ? 'has-store' : ''} ${presentation.restaurant ? 'storefront-restaurant' : 'storefront-retail'}`}
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
                <div className="shop-actions">
                  <button
                    type="button"
                    className="secondary-button shop-glass"
                    aria-expanded={contactOpen}
                    aria-controls="shop-contact-details"
                    onClick={() =>
                      contactOpen ? setContactOpen(false) : openContactDetails()
                    }
                  >
                    {presentation.restaurant ? (
                      <MapPin size={16} aria-hidden="true" />
                    ) : (
                      <Info size={16} aria-hidden="true" />
                    )}
                    {presentation.restaurant
                      ? 'Plan your visit'
                      : 'Visit & contact'}
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
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
            <div className="shop-nav" role="tablist" aria-label="Shop content">
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
                  onClick={() => setActiveTab(id)}
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
                    setActiveTab(next);
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
                      ...new Map(posts.map((post) => [post.id, post])).values(),
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
                          <MediaView media={post.media[0]} title={post.title} />
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
              <div className="shop-section-heading">
                <h2 id="catalog-title">
                  {presentation.restaurant ? 'Our menu' : 'Our products'}
                </h2>
                <label className="shop-search">
                  <Search size={18} />
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
              </div>
              <div className="shop-filter-summary">
                {(demo || productsQuery.isSuccess) && (
                  <p className="shop-results" role="status">
                    {visible.length} {visible.length === 1 ? 'item' : 'items'}
                    {search || category ? ' found' : ''}
                    {!demo && productsQuery.hasNextPage
                      ? ' in the loaded collection'
                      : ''}
                  </p>
                )}
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
              {categories.length > 1 && (
                <div
                  className="shop-categories"
                  role="group"
                  aria-label="Categories in loaded items"
                >
                  <button
                    aria-pressed={!category}
                    onClick={() => setCategory('')}
                  >
                    All items
                  </button>
                  {categories.map((item) => (
                    <button
                      key={item}
                      aria-pressed={category === item}
                      onClick={() => setCategory(item)}
                    >
                      {categoryNames.get(item) ?? productCategoryLabel(item)}
                    </button>
                  ))}
                </div>
              )}
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
                  The {presentation.restaurant ? 'menu' : 'collection'} couldn’t
                  load. Please try again.
                </StatusBanner>
              )}
              {visible.length > 0 &&
                (presentation.restaurant ? (
                  <div className="shop-menu">
                    {categories
                      .filter((item) =>
                        visible.some(
                          (product) => productCategoryKey(product) === item,
                        ),
                      )
                      .map((item) => (
                        <section className="shop-menu-group" key={item}>
                          <h3>
                            {categoryNames.get(item) ??
                              productCategoryLabel(item)}
                          </h3>
                          <div className="shop-products">
                            {visible
                              .filter(
                                (product) =>
                                  productCategoryKey(product) === item,
                              )
                              .map((product) => (
                                <ProductCard
                                  key={product.id}
                                  product={product}
                                  cart={cart}
                                />
                              ))}
                          </div>
                        </section>
                      ))}
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
                    Showing {uniqueProducts.length} loaded items. Search and
                    categories apply to these items.
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
            </section>
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
      {cart.open && store && (
        <ShopCart
          store={store}
          products={uniqueProducts}
          controller={cart}
          demo={demo}
          onBrowse={() => {
            cart.setOpen(false);
            setActiveTab('catalog');
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
      {notice && (
        <div className="toast shop-notice" role="status">
          <Share2 size={16} aria-hidden="true" />
          {notice}
        </div>
      )}
    </div>
  );
}
