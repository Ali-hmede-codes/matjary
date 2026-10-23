import {
  useDeferredValue,
  useEffect,
  useState,
  type CSSProperties,
} from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Bookmark,
  ChevronRight,
  Compass,
  Film,
  Flame,
  Leaf,
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
  type Category,
  type Feed,
  type Post,
  type Store,
} from './lib/api';
import {
  contrastColor,
  defaults,
  normalizeSettings,
  readSavedIds,
} from './lib/website';
import { demoPosts, demoStores, inspirationPhoto } from './lib/demo';
import { PostCard, PostDialog, StoreAvatar } from './components/PostCard';

const navigation = [
  { id: 'discover', label: 'Discover', icon: Compass },
  { id: 'trending', label: 'Trending', icon: Flame },
  { id: 'videos', label: 'Short videos', icon: Film },
  { id: 'saved', label: 'Saved finds', icon: Bookmark },
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
  const [notice, setNotice] = useState('');
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
  const feedTitle =
    store?.name ||
    {
      discover: 'Your daily dose of discovery',
      trending: 'Worth a little attention',
      videos: 'Little moments, in motion',
      saved: 'Your saved finds',
    }[view];

  return (
    <div className="app" style={theme}>
      <a className="skip-link" href="#discover-feed">
        Skip to discoveries
      </a>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label={`${settings.siteName} home`}>
          {settings.logoUrl ? (
            <img
              className="brand-logo"
              src={assetUrl(settings.logoUrl)}
              alt=""
            />
          ) : (
            <span className="brand-mark">
              m<span />
            </span>
          )}
          <span>
            {settings.siteName}
            <span className="brand-dot">.</span>
          </span>
        </a>
        <span className="nav-label">A WORLD TO DISCOVER</span>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => navigate(id)}
              className={view === id ? 'active' : ''}
              aria-label={label}
              aria-current={view === id ? 'page' : undefined}
            >
              <Icon size={21} />
              <span>{label}</span>
              {id === 'discover' && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-invite">
          <span className="invite-icon">
            <StoreIcon size={21} />
          </span>
          <h3>Your store. Your story.</h3>
          <p>Give your creations a place to be discovered.</p>
          <a href={loginUrl}>
            Join the community <ArrowUpRight size={16} />
          </a>
        </div>
        <div className="sidebar-bottom">
          <button className="text-button preview-toggle" onClick={toggleDemo}>
            <Sparkles size={16} />
            {demo ? 'Back to live content' : 'Preview the design'}
          </button>
          <span className="tiny">A little inspiration, every day.</span>
          <p>
            {settings.footerText ||
              `© ${new Date().getFullYear()} ${settings.siteName}`}
          </p>
        </div>
      </aside>

      <div className="page-shell">
        <header className="topbar">
          <span className="page-label">
            Discover <span>/</span> <span>Something good</span>
          </span>
          <label className="search-box">
            <Search size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search this feed…"
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
          <a className="sign-in" href={loginUrl}>
            Sign in <ArrowUpRight size={16} />
          </a>
        </header>

        <main className="main-content">
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
          <section className="hero" aria-labelledby="welcome-title">
            <div className="hero-copy">
              <span className="eyebrow">
                <span className="little-line" /> INDEPENDENT STORES. ENDLESS
                INSPIRATION.
              </span>
              <h1 id="welcome-title">
                {settings.tagline || (
                  <>
                    Find your next
                    <br />
                    <em>little obsession.</em>
                  </>
                )}
              </h1>
              <p>
                {settings.description ||
                  'Good things come from real people. Discover beautiful finds, fresh ideas, and the stores behind them.'}
              </p>
              <button className="primary-button" onClick={goToFeed}>
                Find your inspiration <ArrowDown size={17} />
              </button>
              <span className="hero-footnote">
                <Leaf size={14} /> Small stores. Big character.
              </span>
            </div>
            <div className="hero-visual">
              <img
                src={assetUrl(settings.bannerUrl) || inspirationPhoto}
                alt={
                  settings.bannerUrl
                    ? `${settings.siteName} banner`
                    : 'Thoughtfully crafted objects for everyday living'
                }
                fetchPriority="high"
              />
              <div className="photo-caption">
                <span>THE EVERYDAY, REIMAGINED</span>
                <strong>
                  More than a find.
                  <br />A feeling.
                </strong>
              </div>
              <span className="hero-stamp">
                <Sparkles size={19} />
                <span>
                  GOOD FINDS
                  <br />
                  LIVE HERE
                </span>
              </span>
            </div>
          </section>

          <div className="content-columns">
            <div className="feed-column">
              {stores.length > 0 && (
                <section className="store-strip" aria-label="Discover stores">
                  <button
                    className={`story all-stores ${!store ? 'selected' : ''}`}
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
                      onClick={() => chooseStore(item)}
                    >
                      <span className="story-ring">
                        <StoreAvatar store={item} large />
                      </span>
                      <span>{item.name}</span>
                    </button>
                  ))}
                </section>
              )}
              <section
                id="discover-feed"
                className="discover-feed"
                aria-labelledby="feed-title"
              >
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">
                      {demo
                        ? 'A LITTLE LOOK AT WHAT’S POSSIBLE'
                        : 'CURATED BY CURIOSITY'}
                    </span>
                    <h2 id="feed-title">{feedTitle}</h2>
                  </div>
                  {!store && (
                    <label className="sort-select">
                      <span className="sr-only">Sort discoveries</span>
                      <select
                        value={algorithm}
                        disabled={demo}
                        onChange={(event) => {
                          const value = event.target.value as Algorithm;
                          setAlgorithm(value);
                          if (view === 'trending') setView('discover');
                        }}
                      >
                        <option value="mixed">For you</option>
                        <option value="recent">Newest first</option>
                        <option value="trending">Trending</option>
                      </select>
                    </label>
                  )}
                  {store && (
                    <button
                      className="icon-button"
                      aria-label="Show all stores"
                      onClick={() => setStore(null)}
                    >
                      <X size={19} />
                    </button>
                  )}
                </div>
                {!store && (
                  <div className="category-tabs" aria-label="Categories">
                    <button
                      className={!category ? 'selected' : ''}
                      aria-pressed={!category}
                      onClick={() => setCategory('')}
                    >
                      <Sparkles size={15} />
                      All finds
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
                )}
                {(view === 'saved' || view === 'videos' || search) && (
                  <p className="filter-note">
                    {view === 'saved'
                      ? 'Saved on this device. Showing saved posts from the loaded feed.'
                      : view === 'videos'
                        ? 'Showing videos from the loaded feed.'
                        : 'Searching titles, descriptions, and stores in the loaded feed.'}{' '}
                    Load more to discover more matches.
                  </p>
                )}
                {!demo && feed.isPending && (
                  <div
                    className="post-grid"
                    role="status"
                    aria-label="Loading discoveries"
                  >
                    {[0, 1, 2, 3].map((id) => (
                      <div key={id} className="skeleton-card">
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
                    <h3>Good things are on their way.</h3>
                    <p>
                      We couldn’t load the feed. Make sure the backend is
                      running, then try again.
                    </p>
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
                  <div className="post-grid">
                    {posts.map((post) => (
                      <PostCard
                        key={post.id}
                        post={post}
                        saved={saved.includes(post.id)}
                        onSave={() => savePost(post.id)}
                        onOpen={() => setSelected(post)}
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
                          ? 'Keep the things that catch your eye.'
                          : 'A little space for something new.'}
                      </h3>
                      <p>
                        {view === 'saved'
                          ? 'Tap the bookmark on a discovery to save it here.'
                          : 'No discoveries here yet. Try another category or come back for fresh inspiration.'}
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
                    Load more discoveries
                  </button>
                )}
                {posts.length > 0 && (demo || !feed.hasNextPage) && (
                  <div className="feed-end">
                    <Leaf size={17} />
                    <span>You’re all caught up. Stay curious.</span>
                  </div>
                )}
              </section>
            </div>

            <aside className="right-rail">
              <section className="community-card">
                <span className="eyebrow">BETTER TOGETHER</span>
                <h2>
                  A place for
                  <br />
                  <em>your kind of finds.</em>
                </h2>
                <p>
                  Meet independent stores and discover the stories behind the
                  things you love.
                </p>
                <a className="primary-button" href={loginUrl}>
                  Make yourself at home <ArrowUpRight size={16} />
                </a>
                <span className="tiny">
                  A little community. A lot to discover.
                </span>
              </section>
              <section className="stores-panel">
                <div className="rail-heading">
                  <h3>Meet the stores</h3>
                  <StoreIcon size={18} />
                </div>
                <p className="muted">Good people. Great things.</p>
                {stores.slice(0, 4).map((item) => (
                  <button
                    className="store-row"
                    key={item.id}
                    onClick={() => chooseStore(item)}
                  >
                    <StoreAvatar store={item} />
                    <span>
                      <strong>
                        {item.name}
                        {item.hasVerificationBadge && <BadgeCheck size={14} />}
                      </strong>
                      <small>
                        {item.location?.city ||
                          (demo ? 'Sample store' : 'Independent store')}
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
                {!stores.length && (
                  <p className="store-empty">
                    {storesQuery.isError
                      ? 'Stores are taking a little longer to load.'
                      : storesQuery.isPending
                        ? 'Finding your next favorites…'
                        : 'New stores will appear here.'}
                  </p>
                )}
                {storesQuery.isError && !demo && (
                  <button
                    className="text-button"
                    onClick={() => void storesQuery.refetch()}
                  >
                    Try again
                  </button>
                )}
              </section>
              <div className="manifesto">
                <span className="manifesto-icon">
                  <Leaf size={27} />
                </span>
                <p>
                  Less scrolling.
                  <br />
                  <strong>More discovering.</strong>
                </p>
                <span>Find something that feels like you.</span>
              </div>
              <footer className="site-footer">
                {settings.contactEmail && (
                  <a href={`mailto:${settings.contactEmail}`}>
                    <Mail size={14} />
                    Get in touch
                  </a>
                )}
                <p>
                  {settings.footerText ||
                    `© ${new Date().getFullYear()} ${settings.siteName}. Made for discovery.`}
                </p>
              </footer>
            </aside>
          </div>
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
          post={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
