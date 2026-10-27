import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  Images,
  Layers,
  LayoutGrid,
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
  type Feed,
  type Post,
  type Product,
  type ProductList,
  type Store,
  type StoreCategoryList,
} from '../lib/api';
import { demoPosts, demoProducts, demoStores } from '../lib/demo';
import {
  categoryIndexGroups,
  categorySlug,
  catalogLayout,
  menuCategoryGroups,
  productCategoryKey,
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
import { usePostEngagement } from '../hooks/usePostEngagement';
import { useShare } from '../hooks/useShare';
import { ShopCart } from './ShopCart';
import { ShopCartDock, ShopToast } from './ShopCartDock';
import { CatalogItems, CatalogLoading, ShopImage } from './StoreCatalog';
import { ShopBranches } from './ShopBranches';
import { SocialIcon } from './SocialIcon';
import { LoadingBar, StatusBanner } from './Feedback';
import { MediaView } from './MediaView';
import { PostDialog } from './PostDialog';
import { StoreAvatar, StoreVerifiedBadge } from './StoreAvatar';
import { absoluteMediaUrl } from './StoreDetail';

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
  const { settings } = useWebsiteSettings(false, !demo);
  const [search, setSearch] = useState('');
  // "All items" links ask this page to open on the catalogue; a restaurant
  // lands there by default once its store details arrive.
  const initialView = new URLSearchParams(window.location.search).get('view');
  const [activeTab, setActiveTab] = useState<'posts' | 'catalog'>(() =>
    initialView === 'catalog' ? 'catalog' : 'posts',
  );
  const [menuFilter, setMenuFilter] = useState('all');
  const [focusSearch, setFocusSearch] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [focusContact, setFocusContact] = useState(false);
  const contactDetails = useRef<HTMLElement>(null);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [postNotice, setPostNotice] = useState('');
  const { saved, liking, likePost, savePost, registerView, withLikes } =
    usePostEngagement({ demo, onNotice: setPostNotice });
  useEffect(() => {
    if (!postNotice) return;
    const timer = window.setTimeout(() => setPostNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [postNotice]);
  // A restaurant opens on its menu; the choice only sticks once the shopper
  // switches tabs themselves, so a late store response cannot steal the tab.
  const tabChosen = useRef(initialView === 'catalog');
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
  // A shop's own posts are only the start: opening one continues into the
  // site-wide feed so the viewer never dead-ends on the same shop.
  const explorePostsQuery = useInfiniteQuery({
    queryKey: ['storefront-post-explore'],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ limit: '12', algorithm: 'mixed' });
      if (pageParam) params.set('cursor', pageParam);
      return getJson<Feed>(`feed/explore?${params}`, signal);
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    enabled: Boolean(selectedPost) && !demo,
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
  // The grid and the viewer page through one de-duplicated list, so the tile a
  // shopper taps is exactly the post the viewer opens.
  const shopPosts = [...new Map(posts.map((post) => [post.id, post])).values()];
  const explorePosts = demo
    ? demoPosts
    : (explorePostsQuery.data?.pages.flatMap((page) => page.items) ?? []);
  // The tapped post opens the reel; scrolling then continues through the mixed
  // site feed instead of stopping at the same shop.
  const viewerPosts = [
    ...new Map(
      (selectedPost ? [selectedPost, ...explorePosts] : explorePosts).map(
        (post) => [post.id, post],
      ),
    ).values(),
  ];
  // The menu loads its items inline so every section is browsable without a
  // detour. One request covers a typical menu; long catalogues append another
  // page on request, and a section chip filters server-side.
  const groups = demo
    ? menuCategoryGroups(
        demoProducts.filter((item) => item.storeId === store?.id),
      )
    : categoryIndexGroups(
        categoriesQuery.data?.items ?? [],
        categoriesQuery.data?.uncategorized ?? 0,
      );
  // A chosen chip can outlive its section if the owner renames or removes it.
  const menuFilterKey = groups.some((group) => group.key === menuFilter)
    ? menuFilter
    : 'all';
  const activeGroup =
    menuFilterKey === 'all'
      ? undefined
      : groups.find((group) => group.key === menuFilterKey);
  const menuQuery = useInfiniteQuery({
    queryKey: ['storefront-menu', slug, menuFilterKey],
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({
        limit: '60',
        offset: String(pageParam),
      });
      if (menuFilterKey !== 'all') params.set('categoryId', menuFilterKey);
      return getJson<ProductList>(
        `stores/${encodeURIComponent(slug!)}/products?${params}`,
        signal,
      );
    },
    getNextPageParam: (page, _pages, offset) =>
      page.items.length && offset + page.items.length < page.total
        ? offset + page.items.length
        : undefined,
    enabled: Boolean(store) && !demo && activeTab === 'catalog',
  });
  const catalogTotal = groups.reduce((sum, group) => sum + group.count, 0);
  const searchTerm = search.trim().toLowerCase();
  const menuItems = demo
    ? demoProducts.filter(
        (item) =>
          item.storeId === store?.id &&
          (menuFilterKey === 'all' ||
            productCategoryKey(item) === menuFilterKey),
      )
    : (menuQuery.data?.pages.flatMap((page) => page.items) ?? []);
  // Categories with an owner row arrive as ids; older products without one
  // stay reachable through the "More items" group.
  const menuKeyOf = (item: Product) =>
    demo ? productCategoryKey(item) : (item.categoryId ?? 'uncategorized');
  const matchingItems = searchTerm
    ? menuItems.filter((item) =>
        `${item.name} ${item.description ?? ''}`
          .toLowerCase()
          .includes(searchTerm),
      )
    : menuItems;
  const menuSections = groups
    .map((group, position) => ({
      group,
      layout: catalogLayout(position),
      items: matchingItems.filter((item) => menuKeyOf(item) === group.key),
    }))
    .filter((section) => section.items.length > 0);
  const menuTotal = demo
    ? menuItems.length
    : Number(menuQuery.data?.pages[0]?.total ?? 0);
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
                  {store.businessCategoryLabel && (
                    <span className="shop-category">
                      {store.businessCategoryLabel}
                    </span>
                  )}
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
                          <span className="shop-state-dot" aria-hidden="true" />
                          <span className="shop-hero-open-copy">
                            <strong>
                              {mainOpenState.open ? 'Open now' : 'Closed'}
                            </strong>
                            {mainOpenState.detail && (
                              <small>{mainOpenState.detail}</small>
                            )}
                          </span>
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
                      {shopPosts.map((post) => (
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
                      {searchTerm
                        ? `${matchingItems.length} ${matchingItems.length === 1 ? 'match' : 'matches'}`
                        : activeGroup
                          ? `${activeGroup.count} ${activeGroup.count === 1 ? 'item' : 'items'} in ${activeGroup.name}`
                          : `${catalogTotal} ${catalogTotal === 1 ? 'item' : 'items'} across ${groups.length} ${groups.length === 1 ? 'section' : 'sections'}`}
                    </p>
                  </div>
                  <div className="shop-catalog-tools">
                    <label className="shop-search">
                      <Search size={18} aria-hidden="true" />
                      <span className="sr-only">
                        Search the menu by item name
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
                  <div className="shop-menu-chips" aria-hidden="true">
                    {[0, 1, 2, 3].map((index) => (
                      <span
                        className="shop-chip-skeleton shop-skeleton"
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
                {groups.length > 1 && (
                  <div
                    className="shop-menu-chips"
                    role="group"
                    aria-label="Shop sections"
                  >
                    <button
                      type="button"
                      className={
                        menuFilterKey === 'all' ? 'is-active' : undefined
                      }
                      aria-pressed={menuFilterKey === 'all'}
                      onClick={() => setMenuFilter('all')}
                    >
                      <LayoutGrid size={15} aria-hidden="true" />
                      All items
                      <span>{catalogTotal}</span>
                    </button>
                    {groups.map((group) => (
                      <button
                        key={group.key}
                        type="button"
                        className={
                          menuFilterKey === group.key ? 'is-active' : undefined
                        }
                        aria-pressed={menuFilterKey === group.key}
                        onClick={() => setMenuFilter(group.key)}
                      >
                        {group.name}
                        <span>{group.count}</span>
                      </button>
                    ))}
                  </div>
                )}
                {!demo && menuQuery.isError && (
                  <StatusBanner
                    action="Try again"
                    onAction={() => void menuQuery.refetch()}
                  >
                    The menu couldn’t load. Please try again.
                  </StatusBanner>
                )}
                {!demo && menuQuery.isPending ? (
                  <CatalogLoading layout="list" />
                ) : menuSections.length ? (
                  <div className="shop-menu-sections">
                    {menuSections.map(({ group, layout, items }) => {
                      // While searching, the visible count is the honest one.
                      const count = searchTerm ? items.length : group.count;
                      return (
                        <section
                          className="shop-menu-section"
                          key={group.key}
                          aria-labelledby={`menu-${group.key}`}
                        >
                          <div className="shop-menu-section-head">
                            <h3 id={`menu-${group.key}`}>
                              {group.name}
                              <span>
                                {count} {count === 1 ? 'item' : 'items'}
                              </span>
                            </h3>
                            <a
                              className="shop-menu-section-link"
                              href={storeCategoryPath(
                                store.slug,
                                categorySlug(group.name),
                                demo,
                              )}
                            >
                              View section
                              <ArrowUpRight size={15} aria-hidden="true" />
                            </a>
                          </div>
                          <CatalogItems
                            products={items}
                            cart={cart}
                            layout={layout}
                            shopSlug={store.slug}
                            demo={demo}
                          />
                        </section>
                      );
                    })}
                  </div>
                ) : !menuQuery.isError ? (
                  (demo || categoriesQuery.isSuccess) && (
                    <div className="shop-inline-state">
                      <h3>
                        {searchTerm
                          ? 'No matching items.'
                          : menuFilterKey !== 'all'
                            ? 'Nothing in this section yet.'
                            : presentation.restaurant
                              ? 'The menu is coming soon.'
                              : 'New finds are on their way.'}
                      </h3>
                      <p>
                        {searchTerm
                          ? 'Try another search, or browse every section.'
                          : 'Check back soon for the latest from this shop.'}
                      </p>
                      {searchTerm ? (
                        <button
                          className="secondary-button"
                          onClick={() => setSearch('')}
                        >
                          Clear search
                        </button>
                      ) : (
                        menuFilterKey !== 'all' && (
                          <button
                            className="secondary-button"
                            onClick={() => setMenuFilter('all')}
                          >
                            Show all items
                          </button>
                        )
                      )}
                    </div>
                  )
                ) : null}
                {!demo && menuQuery.hasNextPage && (
                  <div className="shop-pagination">
                    <p>
                      Showing {menuItems.length} of {menuTotal} items.
                    </p>
                    <button
                      className="secondary-button"
                      disabled={menuQuery.isFetching}
                      onClick={() => void menuQuery.fetchNextPage()}
                    >
                      {menuQuery.isFetchingNextPage
                        ? 'Loading…'
                        : 'Load more items'}
                    </button>
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
          posts={viewerPosts.map((post) =>
            withLikes({ ...post, store: post.store ?? store }),
          )}
          initialPostId={selectedPost.id}
          demo={demo}
          notice={postNotice}
          saved={saved}
          liking={liking}
          onLike={(post) => void likePost(post)}
          onSave={savePost}
          onNotice={setPostNotice}
          onActivePost={(post) => void registerView(post)}
          onNearEnd={() => {
            // The reel continues into the site feed; keep its next page warm
            // as the shopper approaches the last loaded post.
            if (
              explorePostsQuery.hasNextPage &&
              !explorePostsQuery.isFetchingNextPage
            )
              void explorePostsQuery.fetchNextPage();
          }}
          onClose={() => setSelectedPost(null)}
        />
      )}
      <ShopToast cart={cart} notice={share.notice} />
    </div>
  );
}
