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
import { useShopFavorites } from '../hooks/useShopFavorites';
import { useWebsiteSettings } from '../hooks/useWebsiteSettings';
import { StatusBanner, Toast } from './Feedback';
import { MediaView } from './MediaView';
import { ShopTile } from './ShopTile';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

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
      {shop && <span className="favorite-post-shop">{shop}</span>}
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
        <main className="shops-main" id="favorites-main" tabIndex={-1}>
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
                : hasFavorites
                  ? 'Loading your favorite shops…'
                  : 'Tap the heart on any shop to keep it and its newest posts here.'}
            </p>
          </section>

          {!hasFavorites ? (
            <div className="shops-empty" role="status">
              <StoreIcon size={26} aria-hidden="true" />
              <h2>No favorite shops yet</h2>
              <p>
                Tap the heart on a shop in the directory, or on a shop page, and
                it will appear here together with its latest posts.
              </p>
              <a className="primary-button" href="/shops">
                Browse all shops
              </a>
            </div>
          ) : (
            <>
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
    </div>
  );
}
