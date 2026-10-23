import { useEffect, useState, type CSSProperties } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  MapPin,
  Package,
  Phone,
  Search,
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
import { StoreAvatar } from './StoreAvatar';

function ShopImage({
  value,
  alt,
  eager = false,
}: {
  value?: string | null;
  alt: string;
  eager?: boolean;
}) {
  const src = assetUrl(storeMediaUrl(value));
  const [failedSrc, setFailedSrc] = useState<string>();
  return src && failedSrc !== src ? (
    <img
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailedSrc(src)}
    />
  ) : (
    <span
      className="shop-image-fallback"
      role="img"
      aria-label={alt || 'Store banner'}
    >
      <Package size={32} />
    </span>
  );
}

function ProductCard({ product }: { product: Product }) {
  return (
    <article className="shop-product">
      <div className="shop-product-image">
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
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
          {product.stockQuantity !== null && product.stockQuantity <= 0 && (
            <span>Unavailable</span>
          )}
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

  return (
    <div
      className={`app storefront ${presentation.restaurant ? 'storefront-restaurant' : 'storefront-retail'}`}
      style={presentation.theme as CSSProperties}
    >
      <a className="skip-link" href="#shop-main">
        Skip to shop
      </a>
      <header className="shop-topbar">
        <a href={home}>
          <ArrowLeft size={17} /> Discover
        </a>
        <a className="shop-platform" href={home}>
          {settings.siteName}
          <span> / shops</span>
        </a>
        {store && (
          <a href="#shop-about">
            About this shop <ArrowUpRight size={15} />
          </a>
        )}
      </header>
      {!store && !missing && !storeQuery.isError && <LoadingBar />}
      <main id="shop-main" className="shop-main">
        {!store ? (
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
            <section className="shop-hero" aria-labelledby="shop-title">
              <div className="shop-banner">
                <ShopImage value={store.bannerKey} alt="" eager />
              </div>
              <div className="shop-profile">
                <div className="shop-logo">
                  <StoreAvatar store={store} large />
                </div>
                <div className="shop-intro">
                  <span className="shop-eyebrow">
                    {presentation.restaurant ? (
                      <Utensils size={14} />
                    ) : (
                      <Package size={14} />
                    )}
                    {presentation.label}
                  </span>
                  <h1 id="shop-title">
                    {store.name}
                    {store.hasVerificationBadge && (
                      <BadgeCheck size={27} aria-label="Verified shop" />
                    )}
                  </h1>
                  {store.description && <p>{store.description}</p>}
                  {(location?.city || location?.country) && (
                    <span className="shop-location">
                      <MapPin size={15} />
                      {[location.city, location.country]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  )}
                </div>
                <a className="primary-button shop-browse" href="#shop-catalog">
                  {presentation.catalogAction}
                  <ArrowRight size={17} />
                </a>
              </div>
            </section>
            <nav className="shop-nav" aria-label="Shop sections">
              <a href="#shop-catalog">
                {presentation.restaurant ? 'Menu' : 'Collection'}
              </a>
              <a href="#shop-stories">Latest stories</a>
              <a href="#shop-about">
                {presentation.restaurant ? 'Visit us' : 'About & contact'}
              </a>
            </nav>
            <section
              id="shop-catalog"
              className="shop-section"
              aria-labelledby="catalog-title"
            >
              <div className="shop-section-heading">
                <div>
                  <span className="shop-eyebrow">
                    {presentation.restaurant
                      ? 'Made to be enjoyed'
                      : 'Find your next favorite'}
                  </span>
                  <h2 id="catalog-title">{presentation.catalogTitle}</h2>
                </div>
                <label className="shop-search">
                  <Search size={18} />
                  <span className="sr-only">
                    Search loaded{' '}
                    {presentation.restaurant ? 'menu items' : 'products'}
                  </span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={
                      presentation.restaurant
                        ? 'Find something delicious…'
                        : 'Search the collection…'
                    }
                    type="search"
                  />
                </label>
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
                    All
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
                <p className="shop-inline-state" role="status">
                  Loading{' '}
                  {presentation.restaurant ? 'the menu' : 'the collection'}…
                </p>
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
                    {productsQuery.isFetchingNextPage
                      ? 'Loading…'
                      : 'Load more items'}
                  </button>
                </div>
              )}
            </section>
            <section
              id="shop-stories"
              className="shop-section"
              aria-labelledby="stories-title"
            >
              <div className="shop-section-heading">
                <div>
                  <span className="shop-eyebrow">A closer look</span>
                  <h2 id="stories-title">Latest stories</h2>
                </div>
              </div>
              {!demo && postsQuery.isPending && (
                <p className="shop-inline-state" role="status">
                  Loading stories…
                </p>
              )}
              {!demo && postsQuery.isError && (
                <StatusBanner
                  action="Retry stories"
                  onAction={() => void postsQuery.refetch()}
                >
                  Stories couldn’t load right now.
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
                  This shop hasn’t shared any stories yet.
                </p>
              )}
              {!demo && postsQuery.hasNextPage && (
                <button
                  className="secondary-button"
                  disabled={postsQuery.isFetching}
                  onClick={() => void postsQuery.fetchNextPage()}
                >
                  {postsQuery.isFetchingNextPage ? 'Loading…' : 'More stories'}
                </button>
              )}
            </section>
            <section
              id="shop-about"
              className="shop-about shop-section"
              aria-labelledby="about-title"
            >
              <div>
                <span className="shop-eyebrow">Get to know us</span>
                <h2 id="about-title">
                  {presentation.restaurant
                    ? 'A place at our table.'
                    : `Hello from ${store.name}.`}
                </h2>
                <p>
                  {store.description ||
                    'Discover our latest products and stories, all in one place.'}
                </p>
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
                          <ArrowUpRight size={15} />
                        </a>
                      ) : null,
                  )}
                </div>
              </div>
              <div className="shop-contact">
                <h3>
                  {presentation.restaurant
                    ? 'Plan your visit'
                    : 'Keep in touch'}
                </h3>
                {[location?.address, location?.city, location?.country].some(
                  Boolean,
                ) && (
                  <p>
                    <MapPin size={17} />
                    {[location?.address, location?.city, location?.country]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                )}
                {phone && (
                  <a href={phone}>
                    <Phone size={17} />
                    {location?.phone}
                  </a>
                )}
                {website && (
                  <a href={website} target="_blank" rel="noopener noreferrer">
                    Visit website
                    <ArrowUpRight size={16} />
                  </a>
                )}
                {map && (
                  <a href={map} target="_blank" rel="noopener noreferrer">
                    Get directions
                    <ArrowUpRight size={16} />
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
                  !hours.length && (
                    <p>Contact details haven’t been added yet.</p>
                  )}
              </div>
            </section>
          </>
        )}
      </main>
      <footer className="shop-footer">
        <span>{store?.name || 'Independent shops'}</span>
        <a href={home}>
          Discover more on {settings.siteName}
          <ArrowUpRight size={15} />
        </a>
      </footer>
    </div>
  );
}
