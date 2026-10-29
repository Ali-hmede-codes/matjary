import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Heart,
  LoaderCircle,
  Store as StoreIcon,
} from 'lucide-react';
import { getJson, type Feed, type Post, type StoreDirectory } from '../lib/api';
import { postPath } from '../lib/storefront';
import { usePageSeo } from '../hooks/usePageSeo';
import { useSeenStories, useStoryGroups } from '../hooks/useStories';
import { useShopFavorites } from '../hooks/useShopFavorites';
import { useWebsiteSettings } from '../hooks/useWebsiteSettings';
import { StatusBanner, Toast } from './Feedback';
import { MediaView } from './MediaView';
import { ShopTile } from './ShopTile';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import { StoreVerifiedBadge } from './StoreAvatar';
import { StoryRail } from './stories/StoryRail';
import { StoryViewer } from './stories/StoryViewer';

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

function FavoritePostTile({ post, eager }: { post: Post; eager: boolean }) {
  const shop = post.store?.name;
  return (
    <a
      className="explore-tile favorite-post-tile"
      href={postPath(post)}
      aria-label={`Open ${post.title}${shop ? ` from ${shop}` : ''}`}
    >
      <MediaView
        media={post.media[0]}
        title={post.title}
        eager={eager}
        sizes="(max-width: 600px) 33vw, (max-width: 900px) 25vw, 200px"
      />
      {shop && (
        <span className="favorite-post-shop">
          <span className="notranslate">{shop}</span>
          <StoreVerifiedBadge store={post.store} size={12} />
        </span>
      )}
    </a>
  );
}

export function FavoritesPage() {
  const { settings, theme, settingsQuery } = useWebsiteSettings();
  const [notice, setNotice] = useState('');
  const favorites = useShopFavorites(setNotice);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // The same query key as the directory page, so visiting one warms the other.
  const directoryQuery = useQuery({
    queryKey: ['store-directory'],
    queryFn: ({ signal }) =>
      getJson<StoreDirectory>('stores/directory', signal),
    staleTime: 300_000,
  });
  const items = useMemo(
    () => directoryQuery.data?.items ?? [],
    [directoryQuery.data],
  );
  // Favorites are stored oldest-first; the newest favorite reads first.
  const favoriteShops = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    return [...favorites.favorites].reverse().flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
  }, [items, favorites.favorites]);
  const shopSlugs = favoriteShops.map((item) => item.slug).join(',');
  // The favorites page is where a shopper expects the shops they kept to keep
  // talking; the same live stories surface here as on the home rail.
  const storySlugs = favoriteShops.slice(0, 12).map((item) => item.slug);
  const { seen, markSeen } = useSeenStories();
  const storyGroups = useStoryGroups(storySlugs, storySlugs.length > 0);
  const groups = storyGroups.data?.groups ?? [];
  const [openStoreId, setOpenStoreId] = useState<string | null>(null);
  const openGroup = groups.find((group) => group.store.id === openStoreId);

  const postsQuery = useInfiniteQuery({
    queryKey: ['favorite-posts', shopSlugs],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ shops: shopSlugs, limit: '18' });
      if (pageParam) params.set('cursor', pageParam);
      return getJson<Feed>(`feed/stores?${params}`, signal);
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    enabled: Boolean(shopSlugs),
    staleTime: 60_000,
  });
  const posts = useMemo(() => {
    const all = postsQuery.data?.pages.flatMap((page) => page.items) ?? [];
    // Cursor pages can repeat a post published at the same second.
    return [...new Map(all.map((post) => [post.id, post])).values()];
  }, [postsQuery.data]);

  usePageSeo({
    title: `Favorite shops — ${settings.siteName}`,
    description:
      'The shops you favorited on this device, with their newest posts.',
    siteName: settings.siteName,
    canonical: '/favorites',
    robots: 'noindex, follow',
  });

  const hasFavorites = favorites.favorites.length > 0;
  const loadingShops = hasFavorites && directoryQuery.isPending;

  return (
    <div className="app shops-page favorites-page" style={theme}>
      <a className="skip-link" href="#favorites-main">
        Skip to your favorites
      </a>
      <SiteHeader settings={settings} view="favorites" />
      <div className="page-shell">
        <main
          className={`shops-main${hasFavorites ? '' : ' favorites-main-empty'}`}
          id="favorites-main"
          tabIndex={-1}
        >
          {!hasFavorites ? (
            <section
              className="favorites-empty"
              aria-labelledby="favorites-title"
            >
              <span className="shops-eyebrow">
                <Heart size={13} aria-hidden="true" /> Your favorites
              </span>
              <h1 id="favorites-title">Shops you love</h1>
              <p className="favorites-empty-lede">
                Tap the heart on any shop, in the directory or on its page, and
                it stays here together with its newest posts.
              </p>
              <a className="primary-button" href="/shops">
                <StoreIcon size={16} aria-hidden="true" />
                Browse all shops
              </a>
            </section>
          ) : (
            <>
              <section
                className="shops-hero favorites-hero"
                aria-labelledby="favorites-title"
              >
                <span className="shops-eyebrow">
                  <Heart size={13} aria-hidden="true" /> Your favorites
                </span>
                <h1 id="favorites-title">Shops you love</h1>
                <p className="shops-lede">
                  {favoriteShops.length > 0
                    ? `${plural(favoriteShops.length, 'shop', 'shops')} saved on this device, with their newest posts below.`
                    : 'Loading your favorite shops…'}
                </p>
              </section>
              {directoryQuery.isError && (
                <StatusBanner
                  action="Try again"
                  onAction={() => void directoryQuery.refetch()}
                >
                  {items.length
                    ? 'Favorite shops couldn’t refresh. The last loaded list is shown.'
                    : 'Favorite shops couldn’t load right now.'}
                </StatusBanner>
              )}
              {settingsQuery.isError && !items.length && (
                <StatusBanner
                  action="Retry settings"
                  onAction={() => void settingsQuery.refetch()}
                >
                  Website settings are unavailable. Default branding is shown.
                </StatusBanner>
              )}

              <StoryRail groups={groups} seen={seen} onOpen={setOpenStoreId} />

              <section
                className="favorites-section"
                aria-labelledby="favorite-shops-title"
              >
                <div className="favorites-heading">
                  <h2 id="favorite-shops-title">
                    Favorite shops
                    {favoriteShops.length > 0 && (
                      <span>{favoriteShops.length}</span>
                    )}
                  </h2>
                  <a className="favorites-more" href="/shops">
                    Find more shops
                    <ArrowRight size={15} aria-hidden="true" />
                  </a>
                </div>
                {loadingShops ? (
                  <>
                    <p className="shops-status" role="status">
                      Loading your shops…
                    </p>
                    <div className="shops-skeleton" aria-hidden="true">
                      {Array.from({ length: 3 }, (_, index) => (
                        <span key={index} />
                      ))}
                    </div>
                  </>
                ) : favoriteShops.length > 0 ? (
                  <ul className="shops-grid">
                    {favoriteShops.map((item) => (
                      <li key={item.id}>
                        <ShopTile
                          item={item}
                          favorite
                          onToggleFavorite={(shop) =>
                            favorites.toggleFavorite(shop.id, shop.name)
                          }
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="favorites-note">
                    Your favorite shops aren’t available right now. They may be
                    offline or removed.
                  </p>
                )}
              </section>

              {favoriteShops.length > 0 && (
                <section
                  className="favorites-section"
                  aria-labelledby="favorite-posts-title"
                >
                  <div className="favorites-heading">
                    <h2 id="favorite-posts-title">Latest from your shops</h2>
                    {posts.length > 0 && (
                      <p className="favorites-count">
                        {plural(posts.length, 'post', 'posts')}
                      </p>
                    )}
                  </div>
                  {favoriteShops.length > 12 && (
                    <p className="favorites-note">
                      Showing posts from your 12 most recently added shops.
                    </p>
                  )}
                  {postsQuery.isError && (
                    <StatusBanner
                      action="Try again"
                      onAction={() => void postsQuery.refetch()}
                    >
                      Posts from your shops couldn’t load right now.
                    </StatusBanner>
                  )}
                  {postsQuery.isPending ? (
                    <div className="explore-grid" aria-hidden="true">
                      {Array.from({ length: 8 }, (_, index) => (
                        <div className="explore-skeleton" key={index} />
                      ))}
                    </div>
                  ) : posts.length > 0 ? (
                    <div className="explore-grid">
                      {posts.map((post, index) => (
                        <FavoritePostTile
                          key={post.id}
                          post={post}
                          eager={index < 4}
                        />
                      ))}
                    </div>
                  ) : (
                    !postsQuery.isError && (
                      <p className="favorites-note">
                        Your favorite shops haven’t shared any posts yet.
                      </p>
                    )
                  )}
                  {postsQuery.hasNextPage && (
                    <div className="favorites-more-row">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={postsQuery.isFetchingNextPage}
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
                    </div>
                  )}
                </section>
              )}
            </>
          )}

          <SiteFooter settings={settings} />
        </main>
      </div>
      <Toast message={notice} icon={<Heart size={16} aria-hidden="true" />} />
      {openGroup && (
        <StoryViewer
          key={openGroup.store.id}
          groups={groups}
          initialStoreId={openGroup.store.id}
          onSeen={markSeen}
          onClose={() => setOpenStoreId(null)}
        />
      )}
    </div>
  );
}
