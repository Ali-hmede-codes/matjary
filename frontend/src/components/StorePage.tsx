import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  Expand,
  Images,
  Layers,
  LoaderCircle,
  MapPin,
  Package,
  Play,
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
  type Store,
  type StoreCategoryList,
} from '../lib/api';
import { demoPosts, demoProducts, demoStores } from '../lib/demo';
import {
  categoryIndexGroups,
  categorySlug,
  catalogLayout,
  menuCategoryGroups,
  storeCategoryPath,
  storeMediaUrl,
  storePath,
  storePresentation,
  storeSocialLinks,
} from '../lib/storefront';
import { branchOpenState, primaryBranch, storeBranches } from '../lib/branches';
import { useWebsiteSettings } from '../hooks/useWebsiteSettings';
import { useShopCart } from '../hooks/useShopCart';
import { usePageSeo } from '../hooks/usePageSeo';
import { useShare } from '../hooks/useShare';
import { ShopCart } from './ShopCart';
import { ShopCartDock, ShopToast } from './ShopCartDock';
import { ShopImage } from './StoreCatalog';
import { ShopBranches } from './ShopBranches';
import { SocialIcon } from './SocialIcon';
import { LoadingBar, StatusBanner } from './Feedback';
import { MediaView } from './MediaView';
import { PostDialog } from './PostDialog';
import { StoreAvatar, StoreVerifiedBadge } from './StoreAvatar';
import { absoluteMediaUrl, catalogLayoutLabel } from './StoreDetail';

function ShopCardsLoading({ label = 'Loading posts…' }: { label?: string }) {
  return (
    <div role="status">
      <span className="sr-only">{label}</span>
      <div className="shop-post-grid" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div className="shop-post-skeleton shop-skeleton" key={index} />
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
        <ShopCardsLoading label="Loading posts…" />
      </div>
    </section>
  );
}

export function StorePage({ slug }: { slug: string | null }) {
  const demo = new URLSearchParams(window.location.search).get('demo') === '1';
  const { settings } = useWebsiteSettings(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'posts' | 'catalog'>('posts');
  const [focusSearch, setFocusSearch] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [focusContact, setFocusContact] = useState(false);
  const contactDetails = useRef<HTMLElement>(null);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const viewedPosts = useRef(new Set<string>());
  // A restaurant opens on its menu; the choice only sticks once the shopper
  // switches tabs themselves, so a late store response cannot steal the tab.
  const tabChosen = useRef(false);
  const selectTab = (tab: 'posts' | 'catalog') => {
    tabChosen.current = true;
    setActiveTab(tab);
  };

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
    // Restaurants open on the menu, so their feed is fetched only when the
    // Posts tab is actually opened.
    enabled: Boolean(store) && !demo && activeTab === 'posts',
  });
  const presentation = storePresentation(store ?? { brandColor: null });
  const missing = notFound || (demo && !store);
  const loadingShop = !store && !missing && !storeQuery.isError;
  const share = useShare();
  useEffect(() => {
    if (tabChosen.current || !store) return;
    if (store.storeType === 'restaurant_menu') setActiveTab('catalog');
  }, [store]);
  useEffect(() => {
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
  }, [store, settings, presentation.theme['--brand-primary']]);
  usePageSeo(
    store
      ? {
          title: `${store.name} — ${settings.siteName}`,
          description:
            store.description ||
            `Explore ${store.name} on ${settings.siteName}.`,
          image:
            absoluteMediaUrl(store.bannerKey || store.logoKey) ??
            assetUrl(settings.logoUrl),
          canonical: storePath(store.slug, demo),
          siteName: settings.siteName,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type':
              store.storeType === 'restaurant_menu' ? 'Restaurant' : 'Store',
            name: store.name,
            description: store.description ?? undefined,
            image:
              absoluteMediaUrl(store.bannerKey || store.logoKey) ??
              assetUrl(settings.logoUrl),
            url: `${window.location.origin}${storePath(store.slug, demo)}`,
          },
        }
      : null,
  );

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
  const posts = demo
    ? demoPosts.filter((item) => item.store?.id === store?.id)
    : (postsQuery.data?.pages.flatMap((page) => page.items) ?? []);
  // The shop page lists sections only; each section opens its own URL with a
  // filtered request, so no shop ever downloads its whole catalogue to browse.
  const groups = demo
    ? menuCategoryGroups(
        demoProducts.filter((item) => item.storeId === store?.id),
      )
    : categoryIndexGroups(
        categoriesQuery.data?.items ?? [],
        categoriesQuery.data?.uncategorized ?? 0,
      );
  const catalogTotal = groups.reduce((sum, group) => sum + group.count, 0);
  const searchTerm = search.trim().toLowerCase();
  const visibleGroups = searchTerm
    ? groups.filter((group) => group.name.toLowerCase().includes(searchTerm))
    : groups;
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

  const cartItems = cart.cart?.itemCount ?? 0;

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
              aria-label="Search shop categories"
              title="Search shop categories"
              onClick={() => {
                selectTab('catalog');
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
              disabled={share.sharing}
              onClick={() =>
                void share.share({
                  title: store.name,
                  text: store.description ?? undefined,
                  url: `${window.location.origin}${storePath(store.slug, demo)}`,
                })
              }
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
                  {presentation.restaurant && groups.length > 0 && (
                    <p className="shop-menu-summary">
                      <Utensils size={15} aria-hidden="true" />
                      {catalogTotal} {catalogTotal === 1 ? 'item' : 'items'}{' '}
                      across {groups.length} menu{' '}
                      {groups.length === 1 ? 'section' : 'sections'}
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
                      <ShopCardsLoading label="Loading posts…" />
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
                <div className="shop-catalog-head">
                  <div className="shop-catalog-title">
                    <h2 id="catalog-title">
                      {presentation.restaurant ? 'Our menu' : 'Our products'}
                    </h2>
                    <p className="shop-results" role="status">
                      {visibleGroups.length}{' '}
                      {visibleGroups.length === 1 ? 'section' : 'sections'}
                      {search ? ' found' : ''}
                    </p>
                  </div>
                  <div className="shop-catalog-tools">
                    <label className="shop-search">
                      <Search size={18} aria-hidden="true" />
                      <span className="sr-only">Search shop categories</span>
                      <input
                        ref={searchInput}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search sections…"
                        type="search"
                      />
                    </label>
                    {search && (
                      <button
                        type="button"
                        className="shop-clear-filters"
                        onClick={() => setSearch('')}
                      >
                        Clear search
                      </button>
                    )}
                  </div>
                </div>
                {!demo && categoriesQuery.isPending && (
                  <div className="shop-category-index" aria-hidden="true">
                    {[0, 1, 2, 3].map((index) => (
                      <div
                        className="shop-category-tile shop-skeleton"
                        key={index}
                      />
                    ))}
                  </div>
                )}
                {!demo && categoriesQuery.isError && (
                  <StatusBanner
                    action="Try again"
                    onAction={() => void categoriesQuery.refetch()}
                  >
                    The shop sections couldn’t load. Please try again.
                  </StatusBanner>
                )}
                {visibleGroups.length > 0 && (
                  <div className="shop-category-index">
                    {visibleGroups.map((group) => {
                      const position = groups.findIndex(
                        (entry) => entry.key === group.key,
                      );
                      const layout = catalogLayout(position);
                      return (
                        <a
                          key={group.key}
                          className={`shop-category-tile layout-${layout}`}
                          href={storeCategoryPath(
                            store.slug,
                            categorySlug(group.name),
                            demo,
                          )}
                        >
                          <span
                            className="shop-category-tile-number"
                            aria-hidden="true"
                          >
                            {String(position + 1).padStart(2, '0')}
                          </span>
                          <span className="shop-category-tile-copy">
                            <strong>{group.name}</strong>
                            <small>
                              {group.count}{' '}
                              {group.count === 1 ? 'item' : 'items'} ·{' '}
                              {catalogLayoutLabel(layout)}
                            </small>
                          </span>
                          <span
                            className="shop-category-tile-arrow"
                            aria-hidden="true"
                          >
                            <ArrowUpRight size={18} />
                          </span>
                        </a>
                      );
                    })}
                  </div>
                )}
                {!visibleGroups.length &&
                  (demo || categoriesQuery.isSuccess) && (
                    <div className="shop-inline-state">
                      <h3>
                        {search
                          ? 'No matching sections.'
                          : presentation.restaurant
                            ? 'The menu is coming soon.'
                            : 'New finds are on their way.'}
                      </h3>
                      <p>
                        {search
                          ? 'Try another search, or browse the sections below.'
                          : 'Check back soon for the latest from this shop.'}
                      </p>
                      {search && (
                        <button
                          className="secondary-button"
                          onClick={() => setSearch('')}
                        >
                          Clear search
                        </button>
                      )}
                    </div>
                  )}
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
      <ShopCartDock cart={cart} />
      {cart.open && store && (
        <ShopCart
          store={store}
          products={[]}
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
      <ShopToast cart={cart} notice={share.notice} />
    </div>
  );
}
