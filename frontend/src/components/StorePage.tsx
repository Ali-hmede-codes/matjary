import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  Heart,
  Images,
  LayoutGrid,
  LoaderCircle,
  MapPin,
  Package,
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
  deleteStory,
  getJson,
  type Feed,
  type Post,
  type Product,
  type ProductList,
  type Store,
  type StoreCategoryList,
} from '../lib/api';
import { resolveCategoryLayout } from '../lib/design.ts';
import {
  categoryIndexGroups,
  categorySlug,
  catalogLayout,
  menuShareDescription,
  lbpRateFor,
  storeCategoryPath,
  storeMediaUrl,
  storePath,
  storePresentation,
  storeSocialLinks,
} from '../lib/storefront';
import { branchOpenState, primaryBranch, storeBranches } from '../lib/branches';
import { brandingUrl } from '../lib/website';
import { useWebsiteSettings } from '../hooks/useWebsiteSettings';
import { useShopCart } from '../hooks/useShopCart';
import { usePageSeo } from '../hooks/usePageSeo';
import { usePostEngagement } from '../hooks/usePostEngagement';
import { useShare } from '../hooks/useShare';
import { useShopFavorites } from '../hooks/useShopFavorites';
import { ShopCart } from './ShopCart';
import { ShopCartDock, ShopToast } from './ShopCartDock';
import { CatalogItems, CatalogLoading, ShopImage } from './StoreCatalog';
import { StorePostWall } from './StorePostWall';
import { ShopBranches } from './ShopBranches';
import { SocialIcon } from './SocialIcon';
import { LoadingBar, StatusBanner } from './Feedback';
import { PostDialog } from './PostDialog';
import { StoreAvatar, StoreVerifiedBadge } from './StoreAvatar';
import { StoryAvatar } from './stories/StoryAvatar';
import { StoryComposer } from './stories/StoryComposer';
import { StoryViewer } from './stories/StoryViewer';
import { ContentEditor } from '../features/shared/ContentEditor';
import {
  useSeenStories,
  useMyStories,
  useStoryGroups,
} from '../hooks/useStories';
import { liveStories, storyGroupUnseen } from '../lib/stories';
import { absoluteMediaUrl } from './StoreDetail';

// Catalog sections preview a fixed number of items; "View all" expands the
// rest in place so the shop page stays scannable instead of becoming a wall.
const CATALOG_SECTION_PREVIEW = 10;

// A long shop name must stay whole beside its category and opening pill, so the
// heading steps down to this floor; anything longer still wraps instead of
// ending in an ellipsis.
const SHOP_TITLE_MIN_FONT_PX = 15;

function useFittedShopTitle(name: string | undefined) {
  const heading = useRef<HTMLHeadingElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const headingElement = heading.current;
    const labelElement = label.current;
    if (!name || !headingElement || !labelElement) return;
    const fit = () => {
      if (!headingElement.isConnected) return;
      // Measure from the stylesheet size every time so a resize can also grow
      // the title back after a narrow window shrank it.
      headingElement.style.removeProperty('font-size');
      labelElement.style.removeProperty('white-space');
      const base = Number.parseFloat(getComputedStyle(headingElement).fontSize);
      if (!Number.isFinite(base)) return;
      let size = base;
      while (
        size > SHOP_TITLE_MIN_FONT_PX &&
        labelElement.scrollWidth > labelElement.clientWidth + 1
      ) {
        size -= 1;
        headingElement.style.fontSize = `${size}px`;
      }
      // Below the floor the name wraps onto another line rather than being
      // cut, which keeps the row's category and open pill in place.
      if (labelElement.scrollWidth > labelElement.clientWidth + 1)
        labelElement.style.whiteSpace = 'normal';
    };
    fit();
    // The available width changes with the viewport, and the web font can
    // land after the first paint and change every measured width.
    window.addEventListener('resize', fit);
    void document.fonts.ready.then(fit);
    return () => window.removeEventListener('resize', fit);
  }, [name]);

  return { heading, label };
}

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
  const { settings } = useWebsiteSettings(false, true);
  const [search, setSearch] = useState('');
  // "All items" links ask this page to open on the catalogue; a restaurant
  // lands there by default once its store details arrive.
  const initialView = new URLSearchParams(window.location.search).get('view');
  const [preferredTab, setPreferredTab] = useState<'posts' | 'catalog'>(() =>
    initialView === 'catalog' ? 'catalog' : 'posts',
  );
  const [menuFilter, setMenuFilter] = useState('all');
  // Sections the shopper asked to see in full, keyed by catalog group.
  const [expandedSections, setExpandedSections] = useState<string[]>([]);
  const [focusSearch, setFocusSearch] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [focusContact, setFocusContact] = useState(false);
  const contactDetails = useRef<HTMLElement>(null);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [postNotice, setPostNotice] = useState('');
  const [favoriteNotice, setFavoriteNotice] = useState('');
  const [storyNotice, setStoryNotice] = useState('');
  const [storyOpen, setStoryOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  // The shop tabs carry an owner-only "+" that opens the same editor the
  // dashboard uses, so adding an item or a post never changes shape.
  const [quickKind, setQuickKind] = useState<'post' | 'product' | null>(null);
  const [quickNotice, setQuickNotice] = useState('');
  const client = useQueryClient();
  // Stories are public and short-lived; the owner view adds the remaining slots.
  const storyGroups = useStoryGroups(slug ? [slug] : undefined, Boolean(slug));
  const { seen, markSeen } = useSeenStories();
  const shopFavorites = useShopFavorites(setFavoriteNotice);
  const { saved, liking, likePost, savePost, registerView, withLikes } =
    usePostEngagement({ onNotice: setPostNotice });
  useEffect(() => {
    if (!postNotice) return;
    const timer = window.setTimeout(() => setPostNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [postNotice]);
  useEffect(() => {
    if (!favoriteNotice) return;
    const timer = window.setTimeout(() => setFavoriteNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [favoriteNotice]);
  useEffect(() => {
    if (!storyNotice) return;
    const timer = window.setTimeout(() => setStoryNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [storyNotice]);
  useEffect(() => {
    if (!quickNotice) return;
    const timer = window.setTimeout(() => setQuickNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [quickNotice]);
  // A restaurant opens on its menu; the choice only sticks once the shopper
  // switches tabs themselves, so a late store response cannot steal the tab.
  const tabChosen = useRef(initialView === 'catalog');
  const selectTab = (tab: 'posts' | 'catalog') => {
    tabChosen.current = true;
    setPreferredTab(tab);
  };

  const storeQuery = useQuery({
    queryKey: ['storefront', slug],
    queryFn: ({ signal }) =>
      getJson<Store>(`stores/${encodeURIComponent(slug!)}`, signal),
    enabled: Boolean(slug),
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 404) && count < 1,
  });
  const notFound =
    !slug ||
    (storeQuery.error instanceof ApiError && storeQuery.error.status === 404);
  const store = notFound ? undefined : storeQuery.data;
  const viewerIsOwner = Boolean(store?.viewerIsOwner);
  const myStories = useMyStories(store?.slug ?? null, viewerIsOwner);
  const shopStoryGroup = storyGroups.data?.groups.find(
    (group) => group.store.id === store?.id,
  );
  // Stories arrive oldest first, so the last live one is the newest; the feed
  // tile previews it, and the ring quiets once this device watched it all.
  const liveShopStories = shopStoryGroup ? liveStories(shopStoryGroup) : [];
  const newestShopStory = liveShopStories[liveShopStories.length - 1];
  const shopStorySeen = shopStoryGroup
    ? !storyGroupUnseen(shopStoryGroup, seen)
    : false;
  const hasLiveStory = liveShopStories.length > 0;
  useEffect(() => {
    // Deleting or losing the last story closes the reel instead of leaving a
    // stale open flag behind for the next story.
    if (!hasLiveStory) setStoryOpen(false);
  }, [hasLiveStory]);
  const { heading: shopTitle, label: shopTitleLabel } = useFittedShopTitle(
    store?.name,
  );
  const refreshStories = () => {
    void client.invalidateQueries({ queryKey: ['stories'] });
    if (store)
      void client.invalidateQueries({ queryKey: ['my-stories', store.slug] });
  };
  // A section the owner turned off is not part of the shop page: its tab and
  // queries disappear, and the enabled section takes over the view.
  const postsSectionEnabled = store ? store.enablePostsSection !== false : true;
  const productsSectionEnabled = store
    ? store.enableProductsSection !== false
    : true;
  const activeTab: 'posts' | 'catalog' =
    preferredTab === 'posts' && !postsSectionEnabled && productsSectionEnabled
      ? 'catalog'
      : preferredTab === 'catalog' &&
          !productsSectionEnabled &&
          postsSectionEnabled
        ? 'posts'
        : preferredTab;
  const cart = useShopCart(store);
  const categoriesQuery = useQuery({
    queryKey: ['storefront-categories', slug],
    queryFn: ({ signal }) =>
      getJson<StoreCategoryList>(
        `stores/${encodeURIComponent(slug!)}/categories`,
        signal,
      ),
    enabled: Boolean(store) && productsSectionEnabled,
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
    // Posts tab is actually opened. A turned-off section never fetches.
    enabled: Boolean(store) && postsSectionEnabled && activeTab === 'posts',
  });
  const presentation = storePresentation(store ?? { brandColor: null });
  // Only sections that are on get a tab; the same flags gate their queries and
  // panels, so a direct ?view= link cannot reopen a turned-off section.
  const tabs = [
    ...(postsSectionEnabled
      ? [{ id: 'posts' as const, label: 'Posts', Icon: Images }]
      : []),
    ...(productsSectionEnabled
      ? [
          {
            id: 'catalog' as const,
            label: presentation.catalogTabLabel,
            Icon: presentation.restaurant ? Utensils : ShoppingBag,
          },
        ]
      : []),
  ];
  // Prices stay in USD; this rate only adds the small LBP line the owner opted into.
  const lbpRate = lbpRateFor(settings.lbpExchangeRate, store);
  const missing = notFound;
  const loadingShop = !store && !missing && !storeQuery.isError;
  const share = useShare();
  useEffect(() => {
    if (tabChosen.current || !store) return;
    if (store.storeType === 'restaurant_menu' && productsSectionEnabled)
      setPreferredTab('catalog');
  }, [store, productsSectionEnabled]);
  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        'content',
        presentation.theme['--brand-primary'] ?? '#254e40',
      );
    document
      .getElementById('site-favicon')
      ?.setAttribute(
        'href',
        assetUrl(storeMediaUrl(store?.logoKey)) ||
          brandingUrl(assetUrl(settings.faviconUrl)) ||
          brandingUrl('/favicon.svg') ||
          '/favicon.svg',
      );
  }, [store, settings, presentation.theme['--brand-primary']]);
  usePageSeo(
    store
      ? {
          title: presentation.restaurant
            ? `${store.name} — Menu — ${settings.siteName}`
            : `${store.name} — ${settings.siteName}`,
          description: presentation.restaurant
            ? menuShareDescription(
                store.description,
                `Browse the menu at ${store.name} — dishes, prices, and photos.`,
              )
            : store.description ||
              `Explore ${store.name} on ${settings.siteName}.`,
          image:
            absoluteMediaUrl(store.bannerKey || store.logoKey) ??
            brandingUrl(assetUrl(settings.logoUrl)),
          canonical: storePath(store.slug),
          siteName: settings.siteName,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type':
              store.storeType === 'restaurant_menu' ? 'Restaurant' : 'Store',
            name: store.name,
            description: store.description ?? undefined,
            image:
              absoluteMediaUrl(store.bannerKey || store.logoKey) ??
              brandingUrl(assetUrl(settings.logoUrl)),
            url: `${window.location.origin}${storePath(store.slug)}`,
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

  const home = '/';
  const posts = postsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  // The grid and the viewer page through one de-duplicated list, so the tile a
  // shopper taps is exactly the post the viewer opens.
  const shopPosts = [...new Map(posts.map((post) => [post.id, post])).values()];
  // The viewer pages through this shop's own posts only, newest first — like
  // scrolling a profile grid — instead of continuing into the site-wide feed.
  const viewerPosts =
    selectedPost && !shopPosts.some((post) => post.id === selectedPost.id)
      ? [...shopPosts, selectedPost]
      : shopPosts;
  // The menu loads its items inline so every section is browsable without a
  // detour. One request covers a typical menu; long catalogues append another
  // page on request, and a section chip filters server-side.
  const groups = categoryIndexGroups(
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
    enabled:
      Boolean(store) && productsSectionEnabled && activeTab === 'catalog',
  });
  const catalogTotal = groups.reduce((sum, group) => sum + group.count, 0);
  const searchTerm = search.trim().toLowerCase();
  const menuItems = menuQuery.data?.pages.flatMap((page) => page.items) ?? [];
  // Categories with an owner row arrive as ids; older products without one
  // stay reachable through the "More items" group.
  const menuKeyOf = (item: Product) => item.categoryId ?? 'uncategorized';
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
      // A saved design controls the section rhythm (and per-section overrides);
      // shops without one keep the familiar rotating layouts.
      layout: presentation.design
        ? resolveCategoryLayout(presentation.design, position, group.key)
        : catalogLayout(position),
      items: matchingItems.filter((item) => menuKeyOf(item) === group.key),
    }))
    .filter((section) => section.items.length > 0);
  const menuTotal = Number(menuQuery.data?.pages[0]?.total ?? 0);
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

  function toggleSection(key: string) {
    setExpandedSections((current) =>
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [...current, key],
    );
  }

  const cartItems = cart.cart?.itemCount ?? 0;

  return (
    <div
      className={`app storefront ${store ? 'has-store' : ''} ${presentation.restaurant ? 'storefront-restaurant' : 'storefront-retail'}${cartItems > 0 && !cart.open ? ' has-cart' : ''}${presentation.design ? ` shop-design-${presentation.design.template}` : ''}`}
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
              aria-pressed={shopFavorites.isFavorite(store.id)}
              aria-label={
                shopFavorites.isFavorite(store.id)
                  ? `Remove ${store.name} from favorite shops`
                  : `Add ${store.name} to favorite shops`
              }
              title={
                shopFavorites.isFavorite(store.id)
                  ? 'Remove from favorites'
                  : 'Add to favorites'
              }
              onClick={() => shopFavorites.toggleFavorite(store.id, store.name)}
            >
              <Heart
                size={21}
                aria-hidden="true"
                fill={
                  shopFavorites.isFavorite(store.id) ? 'currentColor' : 'none'
                }
              />
            </button>
            {productsSectionEnabled && (
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
            )}
            <button
              type="button"
              className="shop-glass"
              aria-label="Share this shop"
              title="Share this shop"
              disabled={share.sharing}
              onClick={() =>
                void share.share({
                  title: presentation.restaurant
                    ? `${store.name} — Menu`
                    : store.name,
                  text: presentation.restaurant
                    ? menuShareDescription(
                        store.description,
                        `Browse the menu at ${store.name} — dishes, prices, and photos.`,
                      )
                    : (store.description ?? undefined),
                  url: `${window.location.origin}${storePath(store.slug)}`,
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
            <section
              className={`shop-hero hero-${presentation.design?.hero ?? 'classic'}`}
              aria-labelledby="shop-title"
            >
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
                  {hasLiveStory && shopStoryGroup ? (
                    <button
                      type="button"
                      className="shop-story-trigger"
                      aria-label={`Watch ${store.name} story`}
                      onClick={() => setStoryOpen(true)}
                    >
                      <StoryAvatar
                        store={store}
                        large
                        expandable
                        state={
                          storyGroupUnseen(shopStoryGroup, seen)
                            ? 'unseen'
                            : 'seen'
                        }
                      />
                    </button>
                  ) : (
                    // The owner sees the plain circular portrait plus the "+"
                    // button; no dashed placeholder frame around the logo.
                    <StoreAvatar store={store} large expandable />
                  )}
                  {viewerIsOwner && (
                    <button
                      type="button"
                      className="shop-story-add"
                      aria-label="Add a story"
                      title="Add a story"
                      onClick={() => setComposerOpen(true)}
                    >
                      <Plus size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className="shop-intro">
                  {/* Name, category and today's hours share one line so the
                      shop's identity and whether it is open read at a glance. */}
                  <div className="shop-title-row">
                    <h1 id="shop-title" ref={shopTitle}>
                      <span
                        className="notranslate"
                        ref={shopTitleLabel}
                        dir="auto"
                      >
                        {store.name}
                      </span>
                      <StoreVerifiedBadge store={store} size={26} />
                    </h1>
                    {store.businessCategoryLabel && (
                      <span className="shop-category">
                        {store.businessCategoryLabel}
                      </span>
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
                  {store.description?.trim() && (
                    <p className="shop-description notranslate" dir="auto">
                      {store.description}
                    </p>
                  )}
                  {presentation.restaurant &&
                    productsSectionEnabled &&
                    groups.length > 0 && (
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
                          <span className="notranslate" dir="auto">
                            {locationLabel}
                          </span>
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
            {storeQuery.isError && (
              <StatusBanner
                action="Retry shop details"
                onAction={() => void storeQuery.refetch()}
              >
                Shop details couldn’t refresh. The last loaded details are
                shown.
              </StatusBanner>
            )}
            <div className="shop-content">
              {tabs.length === 0 && (
                <div className="shop-inline-state" role="status">
                  <h2>This shop is getting ready.</h2>
                  <p>Check back soon for the latest from this shop.</p>
                </div>
              )}
              {tabs.length > 0 && (
                <div
                  className="shop-nav"
                  role="tablist"
                  aria-label="Shop content"
                >
                  {tabs.map(({ id, label, Icon }) => (
                    <div
                      className="shop-tab-group"
                      key={id}
                      role="presentation"
                    >
                      <button
                        id={`shop-tab-${id}`}
                        type="button"
                        role="tab"
                        aria-controls={`shop-${id}`}
                        aria-selected={activeTab === id}
                        tabIndex={activeTab === id ? 0 : -1}
                        onClick={() => selectTab(id)}
                        onKeyDown={(event) => {
                          const index = tabs.findIndex((tab) => tab.id === id);
                          let nextIndex = index;
                          if (event.key === 'Home') nextIndex = 0;
                          else if (event.key === 'End')
                            nextIndex = tabs.length - 1;
                          else if (event.key === 'ArrowLeft')
                            nextIndex = (index - 1 + tabs.length) % tabs.length;
                          else if (event.key === 'ArrowRight')
                            nextIndex = (index + 1) % tabs.length;
                          else return;
                          event.preventDefault();
                          const next = tabs[nextIndex]?.id;
                          if (next) {
                            selectTab(next);
                            document
                              .getElementById(`shop-tab-${next}`)
                              ?.focus();
                          }
                        }}
                      >
                        <Icon size={18} aria-hidden="true" />
                        {label}
                      </button>
                      {/* The owner's shortcut belongs to the same tab it
                          publishes into; shoppers never see these buttons. */}
                      {viewerIsOwner && (
                        <button
                          type="button"
                          className="shop-tab-add"
                          aria-haspopup="dialog"
                          aria-label={
                            id === 'posts'
                              ? 'Add a post'
                              : presentation.restaurant
                                ? 'Add a menu item'
                                : 'Add a product'
                          }
                          title={
                            id === 'posts'
                              ? 'Add a post'
                              : presentation.restaurant
                                ? 'Add a menu item'
                                : 'Add a product'
                          }
                          onClick={() =>
                            setQuickKind(id === 'posts' ? 'post' : 'product')
                          }
                        >
                          <Plus size={16} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {postsSectionEnabled && (
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
                      {postsQuery.isPending && (
                        <ShopCardsLoading label="Loading posts…" />
                      )}
                      {postsQuery.isError && (
                        <StatusBanner
                          action="Retry posts"
                          onAction={() => void postsQuery.refetch()}
                        >
                          Posts couldn’t load right now.
                        </StatusBanner>
                      )}
                      <StorePostWall
                        posts={shopPosts}
                        layout={presentation.design?.postsLayout ?? 'grid'}
                        story={newestShopStory}
                        storySeen={shopStorySeen}
                        onOpenStory={
                          hasLiveStory ? () => setStoryOpen(true) : undefined
                        }
                        onOpen={openStorePost}
                      />
                      {!posts.length && postsQuery.isSuccess && (
                        <div className="shop-inline-state">
                          <p>
                            {viewerIsOwner
                              ? 'Your shop is ready for its first post.'
                              : 'This shop hasn’t shared any posts yet.'}
                          </p>
                          {viewerIsOwner && (
                            <button
                              className="secondary-button"
                              aria-haspopup="dialog"
                              onClick={() => setQuickKind('post')}
                            >
                              <Plus size={16} aria-hidden="true" />
                              Add your first post
                            </button>
                          )}
                        </div>
                      )}
                      {postsQuery.hasNextPage && (
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
              )}
              {productsSectionEnabled && (
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
                        {searchTerm ? (
                          `${matchingItems.length} ${matchingItems.length === 1 ? 'match' : 'matches'}`
                        ) : activeGroup ? (
                          <>
                            {activeGroup.count}{' '}
                            {activeGroup.count === 1 ? 'item' : 'items'} in{' '}
                            <span className="notranslate">
                              {activeGroup.name}
                            </span>
                          </>
                        ) : (
                          `${catalogTotal} ${catalogTotal === 1 ? 'item' : 'items'} across ${groups.length} ${groups.length === 1 ? 'section' : 'sections'}`
                        )}
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
                  {categoriesQuery.isPending && (
                    <div className="shop-menu-chips" aria-hidden="true">
                      {[0, 1, 2, 3].map((index) => (
                        <span
                          className="shop-chip-skeleton shop-skeleton"
                          key={index}
                        />
                      ))}
                    </div>
                  )}
                  {categoriesQuery.isError && (
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
                        <span className="shop-chip-count">{catalogTotal}</span>
                      </button>
                      {groups.map((group) => (
                        <button
                          key={group.key}
                          type="button"
                          className={
                            menuFilterKey === group.key
                              ? 'is-active'
                              : undefined
                          }
                          aria-pressed={menuFilterKey === group.key}
                          onClick={() => setMenuFilter(group.key)}
                        >
                          <span className="notranslate">{group.name}</span>
                          <span className="shop-chip-count">{group.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {menuQuery.isError && (
                    <StatusBanner
                      action="Try again"
                      onAction={() => void menuQuery.refetch()}
                    >
                      The menu couldn’t load. Please try again.
                    </StatusBanner>
                  )}
                  {menuQuery.isPending ? (
                    <CatalogLoading layout="list" />
                  ) : menuSections.length ? (
                    <div className="shop-menu-sections">
                      {menuSections.map(({ group, layout, items }) => {
                        // While searching, the visible count is the honest one.
                        const count = searchTerm ? items.length : group.count;
                        const expanded = expandedSections.includes(group.key);
                        const visible = expanded
                          ? items
                          : items.slice(0, CATALOG_SECTION_PREVIEW);
                        return (
                          <section
                            className="shop-menu-section"
                            key={group.key}
                            aria-labelledby={`menu-${group.key}`}
                          >
                            <div className="shop-menu-section-head">
                              <h3 id={`menu-${group.key}`}>
                                <span className="notranslate">
                                  {group.name}
                                </span>
                                <span className="shop-menu-count">
                                  {count} {count === 1 ? 'item' : 'items'}
                                </span>
                              </h3>
                              <a
                                className="shop-menu-section-link"
                                href={storeCategoryPath(
                                  store.slug,
                                  categorySlug(group.name),
                                )}
                              >
                                View section
                                <ArrowUpRight size={15} aria-hidden="true" />
                              </a>
                            </div>
                            <div id={`menu-${group.key}-items`}>
                              <CatalogItems
                                products={visible}
                                cart={cart}
                                layout={layout}
                                shopSlug={store.slug}
                                lbpRate={lbpRate}
                                showImages={
                                  presentation.design?.showProductImages
                                }
                                showDescriptions={
                                  presentation.design?.showProductDescriptions
                                }
                              />
                            </div>
                            {items.length > CATALOG_SECTION_PREVIEW && (
                              <button
                                type="button"
                                className="shop-menu-more"
                                aria-expanded={expanded}
                                aria-controls={`menu-${group.key}-items`}
                                onClick={() => toggleSection(group.key)}
                              >
                                {expanded
                                  ? 'Show less'
                                  : `View all ${items.length} items`}
                                <ChevronDown
                                  size={16}
                                  className={expanded ? 'is-open' : ''}
                                  aria-hidden="true"
                                />
                              </button>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  ) : !menuQuery.isError ? (
                    categoriesQuery.isSuccess && (
                      <div className="shop-inline-state">
                        <h3>
                          {searchTerm
                            ? 'No matching items.'
                            : menuFilterKey !== 'all'
                              ? 'Nothing in this section yet.'
                              : viewerIsOwner
                                ? presentation.restaurant
                                  ? 'Your menu is ready for its first item.'
                                  : 'Your shop is ready for its first product.'
                                : presentation.restaurant
                                  ? 'The menu is coming soon.'
                                  : 'New finds are on their way.'}
                        </h3>
                        <p>
                          {searchTerm
                            ? 'Try another search, or browse every section.'
                            : viewerIsOwner && menuFilterKey === 'all'
                              ? 'Add it right here — it appears on your shop as soon as you publish.'
                              : 'Check back soon for the latest from this shop.'}
                        </p>
                        {searchTerm ? (
                          <button
                            className="secondary-button"
                            onClick={() => setSearch('')}
                          >
                            Clear search
                          </button>
                        ) : menuFilterKey !== 'all' ? (
                          <button
                            className="secondary-button"
                            onClick={() => setMenuFilter('all')}
                          >
                            Show all items
                          </button>
                        ) : (
                          viewerIsOwner && (
                            <button
                              className="secondary-button"
                              aria-haspopup="dialog"
                              onClick={() => setQuickKind('product')}
                            >
                              <Plus size={16} aria-hidden="true" />
                              Add{' '}
                              {presentation.restaurant
                                ? 'a menu item'
                                : 'a product'}
                            </button>
                          )
                        )}
                      </div>
                    )
                  ) : null}
                  {menuQuery.hasNextPage && (
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
              )}
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
      <ShopCartDock cart={cart} lbpRate={lbpRate} />
      {cart.open && store && (
        <ShopCart
          store={store}
          products={[]}
          controller={cart}
          lbpRate={lbpRate}
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
          notice={postNotice}
          saved={saved}
          liking={liking}
          onLike={(post) => void likePost(post)}
          onSave={savePost}
          onNotice={setPostNotice}
          onActivePost={(post) => void registerView(post)}
          onNearEnd={() => {
            // Keep the shop's next page warm as the shopper approaches its
            // last loaded post, so the reel never dead-ends mid-shop.
            if (postsQuery.hasNextPage && !postsQuery.isFetchingNextPage)
              void postsQuery.fetchNextPage();
          }}
          onClose={() => setSelectedPost(null)}
        />
      )}
      <ShopToast
        cart={cart}
        notice={share.notice || favoriteNotice || storyNotice || quickNotice}
        noticeIcon={
          !share.notice && favoriteNotice ? (
            <Heart size={16} aria-hidden="true" />
          ) : undefined
        }
      />
      {storyOpen && shopStoryGroup && (
        <StoryViewer
          key={shopStoryGroup.store.id}
          groups={storyGroups.data?.groups ?? []}
          initialStoreId={store?.id ?? ''}
          canManage={viewerIsOwner}
          onSeen={markSeen}
          onDelete={
            viewerIsOwner
              ? async (story) => {
                  await deleteStory(story.id);
                  refreshStories();
                  setStoryNotice('Story deleted · the slot is free again.');
                }
              : undefined
          }
          onClose={() => setStoryOpen(false)}
        />
      )}
      {composerOpen && store && (
        <StoryComposer
          store={store}
          myStories={myStories.data}
          onClose={() => setComposerOpen(false)}
          onShared={() => {
            setComposerOpen(false);
            refreshStories();
            setStoryNotice('Story shared · live for 24 hours.');
          }}
        />
      )}
      {quickKind && store && viewerIsOwner && (
        // The panel look is scoped to .panel-app; the dialog renders in the
        // top layer itself, so this wrapper must not paint or reserve space.
        <div className="panel-app panel-embed">
          <ContentEditor
            key={`${quickKind}-${store.id}`}
            store={store}
            kind={quickKind === 'product' ? 'products' : 'posts'}
            item={null}
            cacheScope={`shop-${store.id}`}
            close={() => setQuickKind(null)}
            done={(message) => {
              setQuickKind(null);
              setQuickNotice(message);
              selectTab(quickKind === 'product' ? 'catalog' : 'posts');
              // A published row is public immediately, so every surface that
              // may have loaded this shop has to drop its cached copy.
              void client.invalidateQueries({
                queryKey: ['storefront-posts', store.slug],
              });
              void client.invalidateQueries({
                queryKey: ['storefront-menu', store.slug],
              });
              void client.invalidateQueries({
                queryKey: ['storefront-categories', store.slug],
              });
              void client.invalidateQueries({
                queryKey: ['storefront', store.slug],
              });
              void client.invalidateQueries({ queryKey: ['panel'] });
              void client.invalidateQueries({ queryKey: ['explore'] });
              // Shop cards and the directory show post/product counts.
              void client.invalidateQueries({ queryKey: ['stores'] });
              void client.invalidateQueries({ queryKey: ['store-directory'] });
            }}
          />
        </div>
      )}
    </div>
  );
}
