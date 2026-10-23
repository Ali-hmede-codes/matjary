import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Bookmark,
  Check,
  Compass,
  Film,
  Flame,
  House,
  LayoutGrid,
  Rows3,
  SlidersHorizontal,
  UserRound,
  LoaderCircle,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Store as StoreIcon,
  X,
} from 'lucide-react';
import {
  assetUrl,
  getJson,
  loginUrl,
  togglePostLike,
  type Category,
  type Feed,
  type Post,
  type Store,
} from './lib/api';
import {
  contrastColor,
  defaults,
  enableMouseScrolling,
  normalizeSettings,
  readSavedIds,
} from './lib/website';
import { demoPosts, demoStores } from './lib/demo';
import { PostCard, PostDialog, StoreAvatar } from './components/PostCard';

const navigation = [
  { id: 'discover', label: 'Home', icon: House },
  { id: 'trending', label: 'Trending', icon: Flame },
  { id: 'videos', label: 'Videos', icon: Film },
  { id: 'saved', label: 'Saved', icon: Bookmark },
] as const;
type View = (typeof navigation)[number]['id'];
type Algorithm = 'mixed' | 'recent' | 'trending';
const sampleCategories = [
  { category: 'merchandise', label: 'Objects & living', count: 4 },
  { category: 'food', label: 'Food & dining', count: 1 },
  { category: 'beverage', label: 'Coffee & more', count: 1 },
];

export default function App() {
  const [view, setView] = useState<View>('discover');
  const [algorithm, setAlgorithm] = useState<Algorithm>('mixed');
  const [category, setCategory] = useState('');
  const [store, setStore] = useState<Store | null>(null);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [demo, setDemo] = useState(false);
  const [selected, setSelected] = useState<Post | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [notice, setNotice] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [layout, setLayout] = useState<'feed' | 'grid'>('feed');
  const [likes, setLikes] = useState<
    Record<string, Pick<Post['engagement'], 'likes' | 'viewerLiked'>>
  >({});
  const [liking, setLiking] = useState(false);
  const likeLock = useRef(false);
  const [saved, setSaved] = useState<string[]>(() => {
    try {
      return readSavedIds(window.localStorage);
    } catch {
      return [];
    }
  });

  const settingsQuery = useQuery({
    queryKey: ['website-settings'],
    queryFn: async ({ signal }) =>
      normalizeSettings(await getJson<unknown>('settings/website', signal)),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const settings = settingsQuery.data ?? defaults;
  const storesQuery = useQuery({
    queryKey: ['stores'],
    queryFn: ({ signal }) =>
      getJson<{ items: Store[] }>('stores?limit=7', signal),
    enabled: !demo,
  });
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: ({ signal }) =>
      getJson<Category[]>('feed/explore/categories', signal),
    enabled: !demo,
  });
  const feed = useInfiniteQuery({
    queryKey: ['explore', algorithm, category, store?.slug],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ limit: '12', algorithm });
      if (pageParam) params.set('cursor', pageParam);
      if (category && !store) params.set('category', category);
      const endpoint = store
        ? `feed/store/${encodeURIComponent(store.slug)}`
        : 'feed/explore';
      return getJson<Feed>(`${endpoint}?${params}`, signal);
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    enabled: !demo,
  });
  const stores = demo ? demoStores : (storesQuery.data?.items ?? []);
  const categories = demo ? sampleCategories : (categoriesQuery.data ?? []);
  const source = demo
    ? demoPosts.filter(
        (post) =>
          (!category || post.category === category) &&
          (!store || post.store?.id === store.id),
      )
    : (feed.data?.pages.flatMap((page) => page.items) ?? []);
  const posts = [
    ...new Map(source.map((post) => [post.id, post])).values(),
  ].filter((post) => {
    const matchesView =
      view === 'videos'
        ? post.media.some((item) => item.kind === 'video')
        : view !== 'saved' || saved.includes(post.id);
    return (
      matchesView &&
      `${post.title} ${post.description ?? ''} ${post.store?.name ?? ''}`
        .toLowerCase()
        .includes(deferredSearch)
    );
  });

  useEffect(() => {
    document.title = `${settings.siteName} — ${settings.tagline || 'Discover something good'}`;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        settings.description ||
          'Discover independent stores, beautiful finds, and everyday inspiration.',
      );
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', settings.primaryColor);
    document
      .getElementById('site-favicon')
      ?.setAttribute('href', assetUrl(settings.faviconUrl) || '/favicon.svg');
  }, [settings]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const theme = {
    '--primary': settings.primaryColor,
    '--secondary': settings.secondaryColor,
    '--surface': settings.backgroundColor,
    '--ink': settings.textColor,
    '--on-primary': contrastColor(settings.primaryColor),
  } as CSSProperties;
  const goToFeed = () =>
    document.getElementById('discover-feed')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start',
    });
  function navigate(next: View) {
    setView(next);
    setStore(null);
    setCategory('');
    setSearch('');
    setAlgorithm(next === 'trending' ? 'trending' : 'mixed');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function chooseStore(next: Store) {
    setStore(next);
    setView('discover');
    setCategory('');
    setSearch('');
    goToFeed();
  }
  function toggleDemo() {
    setDemo(!demo);
    navigate('discover');
  }
  function savePost(id: string) {
    const removing = saved.includes(id);
    const next = removing
      ? saved.filter((item) => item !== id)
      : [...saved, id].slice(-500);
    setSaved(next);
    try {
      window.localStorage.setItem('matjary:saved-posts', JSON.stringify(next));
      setNotice(
        removing ? 'Removed from your saved finds.' : 'Saved on this device.',
      );
    } catch {
      setNotice('Saved for this visit only. Browser storage is unavailable.');
    }
  }
  async function likePost(post: Post) {
    // Serialize first-time visitor mutations so the server can establish one cookie.
    if (likeLock.current) return;
    likeLock.current = true;
    setLiking(true);
    const previous = likes[post.id] ?? post.engagement;
    const optimistic = {
      viewerLiked: !previous.viewerLiked,
      likes: Math.max(0, previous.likes + (previous.viewerLiked ? -1 : 1)),
    };
    setLikes((current) => ({ ...current, [post.id]: optimistic }));
    try {
      if (!demo) {
        const result = await togglePostLike(post.id);
        setLikes((current) => ({ ...current, [post.id]: result }));
      }
    } catch {
      setLikes((current) => ({ ...current, [post.id]: previous }));
      setNotice('Couldn’t update your like. Please try again.');
    } finally {
      likeLock.current = false;
      setLiking(false);
    }
  }
  const withLikes = (post: Post): Post => ({
    ...post,
    engagement: { ...post.engagement, ...likes[post.id] },
  });
  const isLoading =
    settingsQuery.isLoading ||
    (!demo &&
      (feed.isLoading || storesQuery.isLoading || categoriesQuery.isLoading));
  const feedTitle =
    store?.name ||
    {
      discover: algorithm === 'recent' ? 'Latest' : 'For you',
      trending: 'Trending',
      videos: 'Videos',
      saved: 'Saved',
    }[view];

  return (
    <div className={`app ${searchOpen ? 'search-open' : ''}`} style={theme}>
      <a className="skip-link" href="#discover-feed">
        Skip to discoveries
      </a>
      {isLoading && (
        <div className="loading-bar" role="status">
          <span className="sr-only">Loading your discoveries…</span>
        </div>
      )}
      <header className="site-header">
        <div className="topbar">
          <a
            className="brand"
            href="/"
            aria-label={`${settings.siteName} home`}
          >
            {settings.logoUrl ? (
              <img
                className="brand-logo"
                src={assetUrl(settings.logoUrl)}
                alt=""
              />
            ) : (
              <span className="brand-mark" aria-hidden="true">
                m
              </span>
            )}
            <span className="brand-name">{settings.siteName}</span>
          </a>
          <nav className="main-nav" aria-label="Main navigation">
            {navigation.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => navigate(id)}
                className={view === id ? 'active' : ''}
                aria-current={view === id ? 'page' : undefined}
              >
                <Icon size={19} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <label className="search-box" id="feed-search">
            <Search size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search posts and stores"
              aria-label="Search loaded posts and stores"
            />
            {search && (
              <button
                className="icon-button"
                aria-label="Clear search"
                onClick={() => setSearch('')}
              >
                <X size={16} />
              </button>
            )}
          </label>
          <div className="header-actions">
            <button
              className="icon-button search-toggle"
              aria-label="Search posts and stores"
              aria-controls="feed-search"
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen(!searchOpen)}
            >
              {searchOpen ? <X size={22} /> : <Search size={22} />}
            </button>
            <a
              className="create-button"
              href={loginUrl}
              aria-label="Sign in to share a post"
            >
              <Plus size={20} />
              <span>Create</span>
            </a>
            <a
              className="profile-button"
              href={loginUrl}
              aria-label="Sign in to your account"
            >
              <UserRound size={21} />
            </a>
          </div>
        </div>
      </header>

      <div className="page-shell">
        <main className="main-content">
          <div className="feed-column">
            {demo && (
              <div className="status-banner demo-banner" role="status">
                <Sparkles size={17} />
                <span>
                  Design preview · Sample stores and photos, not live content.
                </span>
                <button onClick={toggleDemo}>
                  View live feed <ArrowRight size={15} />
                </button>
              </div>
            )}
            {settingsQuery.isError && (
              <div className="status-banner" role="status">
                <span>
                  Website settings are unavailable.{' '}
                  {settingsQuery.data
                    ? 'The last loaded branding is shown.'
                    : 'Default branding is shown.'}
                </span>
                <button onClick={() => void settingsQuery.refetch()}>
                  Retry settings
                </button>
              </div>
            )}
            <h1 className="sr-only">{settings.siteName} social feed</h1>
            <section
              className="store-strip"
              aria-label="Browse store posts"
              ref={enableMouseScrolling}
              tabIndex={0}
            >
              <a className="story your-store" href={loginUrl}>
                <span className="story-ring">
                  <Plus size={25} />
                </span>
                <span>Your store</span>
              </a>
              <button
                className={`story all-stores ${!store ? 'selected' : ''}`}
                aria-pressed={!store}
                onClick={() => {
                  setStore(null);
                  setCategory('');
                }}
              >
                <span className="story-ring">
                  <Compass size={25} />
                </span>
                <span>All stores</span>
              </button>
              {stores.map((item) => (
                <button
                  className={`story ${store?.id === item.id ? 'selected' : ''}`}
                  key={item.id}
                  aria-pressed={store?.id === item.id}
                  onClick={() => chooseStore(item)}
                >
                  <span className="story-ring">
                    <StoreAvatar
                      store={item}
                      large
                      preview={
                        source.find((post) => post.store?.id === item.id)
                          ?.media[0]
                      }
                    />
                  </span>
                  <span>{item.name}</span>
                  {item.hasVerificationBadge && <BadgeCheck size={15} />}
                </button>
              ))}
            </section>
            {!demo && storesQuery.isError && (
              <div className="status-banner" role="status">
                <span>Stores couldn’t load right now.</span>
                <button onClick={() => void storesQuery.refetch()}>
                  Retry stores
                </button>
              </div>
            )}
            <section
              id="discover-feed"
              className="discover-feed"
              aria-labelledby="feed-title"
            >
              <div className="feed-toolbar">
                <h2
                  id="feed-title"
                  className={
                    view === 'discover' && !store ? 'sr-only' : 'feed-title'
                  }
                >
                  {feedTitle}
                </h2>
                {view === 'discover' && !store && (
                  <div className="feed-tabs" aria-label="Feed order">
                    <button
                      className={algorithm === 'mixed' ? 'selected' : ''}
                      aria-pressed={algorithm === 'mixed'}
                      onClick={() => setAlgorithm('mixed')}
                    >
                      For you
                    </button>
                    <button
                      className={algorithm === 'recent' ? 'selected' : ''}
                      aria-pressed={algorithm === 'recent'}
                      disabled={demo}
                      onClick={() => setAlgorithm('recent')}
                    >
                      Latest
                    </button>
                  </div>
                )}
                <div className="feed-tools">
                  {!store && (
                    <button
                      className={`icon-button ${filtersOpen || category ? 'tool-active' : ''}`}
                      aria-label="Filter your feed"
                      aria-expanded={filtersOpen}
                      aria-controls="feed-filters"
                      onClick={() => setFiltersOpen(!filtersOpen)}
                    >
                      <SlidersHorizontal size={20} />
                    </button>
                  )}
                  <button
                    className="icon-button"
                    aria-label={
                      layout === 'feed'
                        ? 'Switch to grid view'
                        : 'Switch to feed view'
                    }
                    onClick={() =>
                      setLayout(layout === 'feed' ? 'grid' : 'feed')
                    }
                  >
                    {layout === 'feed' ? (
                      <LayoutGrid size={20} />
                    ) : (
                      <Rows3 size={20} />
                    )}
                  </button>
                  {store && (
                    <button
                      className="icon-button"
                      aria-label="Show all stores"
                      onClick={() => setStore(null)}
                    >
                      <X size={20} />
                    </button>
                  )}
                </div>
              </div>
              {!store && filtersOpen && (
                <div className="feed-filters" id="feed-filters">
                  <label className="sort-select">
                    Sort by
                    <select
                      value={algorithm}
                      disabled={demo}
                      onChange={(event) => {
                        setAlgorithm(event.target.value as Algorithm);
                        if (view === 'trending') setView('discover');
                      }}
                    >
                      <option value="mixed">For you</option>
                      <option value="recent">Newest first</option>
                      <option value="trending">Trending</option>
                    </select>
                  </label>
                  <div
                    className="category-tabs"
                    role="group"
                    aria-label="Categories"
                    ref={enableMouseScrolling}
                    tabIndex={0}
                  >
                    <button
                      className={!category ? 'selected' : ''}
                      aria-pressed={!category}
                      onClick={() => setCategory('')}
                    >
                      All
                    </button>
                    {categories.map((item) => (
                      <button
                        key={item.category}
                        className={category === item.category ? 'selected' : ''}
                        aria-pressed={category === item.category}
                        onClick={() => setCategory(item.category)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {category && !filtersOpen && (
                <button
                  className="active-filter"
                  onClick={() => setCategory('')}
                >
                  {categories.find((item) => item.category === category)
                    ?.label || category}
                  <X size={14} />
                </button>
              )}
              {(view === 'saved' || view === 'videos' || search) && (
                <p className="filter-note">
                  {view === 'saved'
                    ? 'Saved on this device · Matches from loaded posts'
                    : view === 'videos'
                      ? 'Videos from loaded posts · Load more to keep exploring'
                      : 'Search results from loaded posts'}
                </p>
              )}
              {!demo && feed.isPending && (
                <div
                  className={`post-grid ${layout === 'grid' ? 'compact-grid' : ''} ${view === 'videos' ? 'video-feed' : ''}`}
                  role="status"
                  aria-label="Loading discoveries"
                >
                  <span className="sr-only">Finding your next favorites…</span>
                  {[0, 1].map((id) => (
                    <div key={id} className="skeleton-card" aria-hidden="true">
                      <div />
                      <div />
                      <div />
                    </div>
                  ))}
                </div>
              )}
              {!demo && feed.isError && (
                <div className="empty-state" role="status">
                  <span className="empty-icon">
                    <RefreshCw size={25} />
                  </span>
                  <h3>Let’s try that again.</h3>
                  <p>We couldn’t load your feed. Try again in a moment.</p>
                  <div className="empty-actions">
                    <button
                      className="primary-button"
                      onClick={() => void feed.refetch()}
                      disabled={feed.isFetching}
                    >
                      <RefreshCw size={15} />
                      Try again
                    </button>
                    <button className="secondary-button" onClick={toggleDemo}>
                      Preview the design
                    </button>
                  </div>
                </div>
              )}
              {posts.length > 0 && (
                <div
                  className={`post-grid ${layout === 'grid' ? 'compact-grid' : ''} ${view === 'videos' ? 'video-feed' : ''}`}
                >
                  {posts.map((post, index) => (
                    <PostCard
                      key={`${view}:${post.id}`}
                      post={withLikes(post)}
                      preferVideo={view === 'videos'}
                      index={index}
                      liking={liking}
                      onLike={() => void likePost(post)}
                      onNotice={setNotice}
                      saved={saved.includes(post.id)}
                      onSave={() => savePost(post.id)}
                      onOpen={(index) => {
                        setSelected(post);
                        setSelectedIndex(index);
                      }}
                      onStore={chooseStore}
                      demo={demo}
                    />
                  ))}
                </div>
              )}
              {(demo || (!feed.isPending && !feed.isError)) &&
                posts.length === 0 && (
                  <div className="empty-state">
                    <span className="empty-icon">
                      {view === 'saved' ? (
                        <Bookmark size={26} />
                      ) : (
                        <Compass size={26} />
                      )}
                    </span>
                    <h3>
                      {view === 'saved'
                        ? 'All your favorites, right here.'
                        : 'Nothing here just yet.'}
                    </h3>
                    <p>
                      {view === 'saved'
                        ? 'Tap the bookmark on a discovery to save it here.'
                        : 'Try another category or check back for new posts.'}
                    </p>
                    <button
                      className="secondary-button"
                      onClick={() => navigate('discover')}
                    >
                      Explore all finds <ArrowRight size={15} />
                    </button>
                    {!demo && !source.length && (
                      <button className="text-button" onClick={toggleDemo}>
                        See a sample of the design
                      </button>
                    )}
                  </div>
                )}
              {!demo && feed.hasNextPage && (
                <button
                  className="load-more secondary-button"
                  disabled={feed.isFetching}
                  onClick={() => void feed.fetchNextPage()}
                >
                  {feed.isFetchingNextPage ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Plus size={17} />
                  )}
                  Load more posts
                </button>
              )}
              {posts.length > 0 && (demo || !feed.hasNextPage) && (
                <div className="feed-end">
                  <Check size={17} />
                  <span>You’re all caught up.</span>
                </div>
              )}
            </section>
          </div>
          <aside className="discovery-rail" aria-label="More to explore">
            <div className="rail-heading">
              <h2>Stores to explore</h2>
              <StoreIcon size={18} />
            </div>
            {stores.slice(0, 5).map((item) => (
              <button
                className="suggested-store"
                key={item.id}
                onClick={() => chooseStore(item)}
              >
                <StoreAvatar store={item} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.location?.city || 'Explore store'}</small>
                </span>
                <ArrowUpRight size={17} />
              </button>
            ))}
            {!stores.length && (
              <p className="rail-empty">
                Stores will appear here as they join.
              </p>
            )}
            <div className="saved-shortcut">
              <span className="saved-shortcut-icon">
                <Bookmark size={22} />
              </span>
              <div>
                <strong>Your collection</strong>
                <span>{saved.length} saved on this device</span>
              </div>
              <button
                className="icon-button"
                aria-label="Open saved posts"
                onClick={() => navigate('saved')}
              >
                <ArrowRight size={18} />
              </button>
            </div>
            {settings.bannerUrl && (
              <img
                className="community-banner"
                src={assetUrl(settings.bannerUrl)}
                alt={`${settings.siteName} banner`}
                loading="lazy"
              />
            )}
            {(settings.tagline || settings.description) && (
              <p className="rail-about">
                {settings.tagline || settings.description}
              </p>
            )}
          </aside>
          <footer className="site-footer">
            <p>
              {settings.footerText ||
                `© ${new Date().getFullYear()} ${settings.siteName}. Made for discovery.`}
            </p>
            <div className="footer-links">
              <button className="text-button" onClick={toggleDemo}>
                <Sparkles size={15} />
                {demo ? 'Back to live feed' : 'Preview the design'}
              </button>
              {settings.contactEmail && (
                <a href={`mailto:${settings.contactEmail}`}>
                  <Mail size={14} /> Get in touch
                </a>
              )}
            </div>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Bookmark size={16} />
          {notice}
        </div>
      )}
      {selected && (
        <PostDialog
          key={selected.id}
          post={withLikes(selected)}
          initialIndex={selectedIndex}
          notice={notice}
          saved={saved.includes(selected.id)}
          onSave={() => savePost(selected.id)}
          liking={liking}
          onLike={() => void likePost(selected)}
          onNotice={setNotice}
          demo={demo}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
