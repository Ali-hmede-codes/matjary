import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUpRight,
  Images,
  Info,
  LoaderCircle,
  MapPin,
  Package,
  Phone,
  Search,
  Share2,
  ShoppingBag,
  Utensils,
} from 'lucide-react';
import {
  ApiError,
  assetUrl,
  getJson,
  type Feed,
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
} from '../lib/storefront';
import { safeUrl } from '../lib/website';
import { useWebsiteSettings } from '../hooks/useWebsiteSettings';
import { LoadingBar, StatusBanner } from './Feedback';
import { MediaView } from './MediaView';
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
  stories = false,
  label = 'Loading the collection…',
}: {
  stories?: boolean;
  label?: string;
}) {
  return (
    <div role="status">
      <span className="sr-only">{label}</span>
      <div
        className={stories ? 'shop-stories' : 'shop-products'}
        aria-hidden="true"
      >
        {[0, 1, 2].map((index) => (
          <div className={stories ? 'shop-story' : 'shop-product'} key={index}>
            <div
              className={`${stories ? 'shop-story-media' : 'shop-product-image'} shop-skeleton`}
            />
            <div className="shop-product-copy">
              <div className="shop-skeleton shop-skeleton-title" />
              <div className="shop-skeleton shop-skeleton-line" />
              <div className="shop-skeleton shop-skeleton-short" />
            </div>
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
        <ShopCardsLoading stories label="Loading posts…" />
      </div>
    </section>
  );
}

function ProductCard({ product }: { product: Product }) {
  return (
    <article className="shop-product">
      <div className="shop-product-image">
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
        {product.stockQuantity !== null && product.stockQuantity <= 0 && (
          <span className="shop-stock-label">Unavailable</span>
        )}
      </div>
      <div className="shop-product-copy">
        <span className="shop-eyebrow">
          {productCategoryLabel(product.category)}
        </span>
        <h3>{product.name}</h3>
        {product.description && <p>{product.description}</p>}
        <div className="shop-product-bottom">
          <strong>
            {formatProductPrice(product.priceCents, product.currency)}
          </strong>
        </div>
      </div>
    </article>
  );
}

const socialLabels: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'X',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  website: 'Website',
};

export function StorePage({ slug }: { slug: string | null }) {
  const demo = new URLSearchParams(window.location.search).get('demo') === '1';
  const { settings } = useWebsiteSettings(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [activeTab, setActiveTab] = useState<'posts' | 'catalog'>('posts');
  const [focusSearch, setFocusSearch] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const contactDetails = useRef<HTMLDetailsElement>(null);
  const [notice, setNotice] = useState('');
  const [sharing, setSharing] = useState(false);

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
  const categories = [...new Set(uniqueProducts.map((item) => item.category))];
  const visible = uniqueProducts.filter(
    (item) =>
      (!category || item.category === category) &&
      `${item.name} ${item.description ?? ''}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const location = store?.location;
  const phone =
    location?.phone && /^[+\d\s().-]+$/u.test(location.phone)
      ? `tel:${location.phone.replace(/[^+\d]/gu, '')}`
      : undefined;
  const website = safeUrl(
    location?.website || store?.socialMediaLinks?.website,
  );
  const map = safeUrl(location?.mapUrl);
  const hours = Object.entries(location?.openingHours ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );

  function openContactDetails() {
    if (contactDetails.current) contactDetails.current.open = true;
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
      <header className="shop-topbar">
        <a className="shop-back" href={home}>
          <ArrowLeft size={17} aria-hidden="true" /> All shops
        </a>
        {store ? (
          <div
            className="shop-tools"
            role="group"
            aria-label="Shop quick actions"
          >
            <button
              type="button"
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
              aria-label="Share this shop"
              title="Share this shop"
              disabled={sharing}
              onClick={() => void shareShop()}
            >
              <Share2 size={20} aria-hidden="true" />
            </button>
            <a
              href="#shop-about"
              onClick={openContactDetails}
              aria-label="Shop information"
              title="Shop information"
            >
              <Info size={21} aria-hidden="true" />
            </a>
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
                  fallbackLabel={presentation.label}
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
                  <div className="shop-meta">
                    <span>{presentation.label}</span>
                    {(location?.city || location?.country) && (
                      <span className="shop-location">
                        <MapPin size={14} aria-hidden="true" />
                        {[location.city, location.country]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="shop-actions">
                  <a
                    className="secondary-button"
                    href="#shop-about"
                    onClick={openContactDetails}
                  >
                    {presentation.restaurant ? (
                      <MapPin size={16} />
                    ) : (
                      <Info size={16} />
                    )}
                    {presentation.restaurant
                      ? 'Plan your visit'
                      : 'Contact shop'}
                  </a>
                </div>
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
              className="shop-section shop-tabpanel"
              role="tabpanel"
              aria-labelledby="shop-tab-posts"
              tabIndex={0}
              hidden={activeTab !== 'posts'}
            >
              {activeTab === 'posts' && (
                <>
                  <h2 className="sr-only">Posts</h2>
                  {!demo && postsQuery.isPending && (
                    <ShopCardsLoading stories label="Loading posts…" />
                  )}
                  {!demo && postsQuery.isError && (
                    <StatusBanner
                      action="Retry posts"
                      onAction={() => void postsQuery.refetch()}
                    >
                      Posts couldn’t load right now.
                    </StatusBanner>
                  )}
                  <div className="shop-stories">
                    {[
                      ...new Map(posts.map((post) => [post.id, post])).values(),
                    ].map((post) => (
                      <article className="shop-story" key={post.id}>
                        <div
                          className="shop-story-gallery"
                          tabIndex={0}
                          aria-label={`${post.title} photos and videos`}
                        >
                          {post.media.length ? (
                            post.media.map((media) => (
                              <div className="shop-story-media" key={media.id}>
                                {media.kind === 'video' ? (
                                  <video
                                    controls
                                    playsInline
                                    preload="none"
                                    src={assetUrl(media.primaryUrl)}
                                    poster={assetUrl(media.posterUrl)}
                                    aria-label={post.title}
                                  />
                                ) : (
                                  <MediaView media={media} title={post.title} />
                                )}
                              </div>
                            ))
                          ) : (
                            <MediaView title={post.title} />
                          )}
                        </div>
                        <h3>{post.title}</h3>
                        {post.description && <p>{post.description}</p>}
                      </article>
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
                      {productCategoryLabel(item)}
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
                        visible.some((product) => product.category === item),
                      )
                      .map((item) => (
                        <section className="shop-menu-group" key={item}>
                          <h3>{productCategoryLabel(item)}</h3>
                          <div className="shop-products">
                            {visible
                              .filter((product) => product.category === item)
                              .map((product) => (
                                <ProductCard
                                  key={product.id}
                                  product={product}
                                />
                              ))}
                          </div>
                        </section>
                      ))}
                  </div>
                ) : (
                  <div className="shop-products">
                    {visible.map((product) => (
                      <ProductCard key={product.id} product={product} />
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
      <footer id="shop-about" className="shop-footer">
        <div className="shop-footer-brand">
          <strong>{store?.name || 'Independent shops'}</strong>
          {store?.description?.trim() && <p>{store.description}</p>}
        </div>
        <a href={home}>
          Powered by {settings.siteName}
          <ArrowUpRight size={15} aria-hidden="true" />
        </a>
        {store && (
          <details className="shop-footer-details" ref={contactDetails}>
            <summary>Contact & details</summary>
            <div className="shop-contact">
              {[location?.address, location?.city, location?.country].some(
                Boolean,
              ) && (
                <p>
                  <MapPin size={17} aria-hidden="true" />
                  {[location?.address, location?.city, location?.country]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              )}
              {phone && (
                <a href={phone}>
                  <Phone size={17} aria-hidden="true" />
                  {location?.phone}
                </a>
              )}
              {website && (
                <a href={website} target="_blank" rel="noopener noreferrer">
                  Visit website
                  <ArrowUpRight size={16} aria-hidden="true" />
                </a>
              )}
              {map && (
                <a href={map} target="_blank" rel="noopener noreferrer">
                  Get directions
                  <ArrowUpRight size={16} aria-hidden="true" />
                </a>
              )}
              {hours.length > 0 && (
                <dl className="shop-hours">
                  {hours.map(([day, time]) => (
                    <div key={day}>
                      <dt>{day}</dt>
                      <dd>{time}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {!phone &&
                !website &&
                !map &&
                !location?.address &&
                !location?.city &&
                !location?.country &&
                !hours.length && <p>Contact details haven’t been added yet.</p>}
              <div className="shop-socials">
                {Object.entries(store.socialMediaLinks ?? {}).map(
                  ([key, value]) =>
                    Object.hasOwn(socialLabels, key) && safeUrl(value) ? (
                      <a
                        key={key}
                        href={safeUrl(value)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {socialLabels[key]}
                        <ArrowUpRight size={15} aria-hidden="true" />
                      </a>
                    ) : null,
                )}
              </div>
            </div>
          </details>
        )}
      </footer>
      {notice && (
        <div className="toast shop-notice" role="status">
          <Share2 size={16} aria-hidden="true" />
          {notice}
        </div>
      )}
    </div>
  );
}
