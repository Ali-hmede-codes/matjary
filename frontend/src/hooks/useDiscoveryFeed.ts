import { useDeferredValue, useEffect, useState } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import {
  getFeedAds,
  getJson,
  type BoostAd,
  type Feed,
  type Post,
  type ShopCategoryFacet,
  type Store,
} from '../lib/api';
import type { Algorithm, FeedLayout, View } from '../lib/feed';
import { usePostEngagement } from './usePostEngagement';
import { useWebsiteSettings } from './useWebsiteSettings';

export function useDiscoveryFeed() {
  const [view, setView] = useState<View>(() => {
    const requested = new URLSearchParams(window.location.search).get('view');
    return requested === 'trending' ||
      requested === 'videos' ||
      requested === 'saved'
      ? requested
      : 'discover';
  });
  const [algorithm, setAlgorithm] = useState<Algorithm>(
    view === 'trending' ? 'trending' : 'mixed',
  );
  // Explore is a presentation of the discovery feed: an image-only grid over
  // every published post, ordered newest first like the old "Latest" tab.
  const [explore, setExplore] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [store, setStore] = useState<Store | null>(null);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [selected, setSelected] = useState<Post | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [notice, setNotice] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [layout, setLayout] = useState<FeedLayout>('feed');
  const { saved, liking, likePost, savePost, registerView, withLikes } =
    usePostEngagement({ onNotice: setNotice });

  const { settingsQuery, settings, theme } = useWebsiteSettings(true, true);
  const storesQuery = useQuery({
    queryKey: ['stores'],
    queryFn: ({ signal }) =>
      getJson<{ items: Store[] }>('stores?limit=7', signal),
  });
  const categoryKey = [...categories].sort().join(',');
  const feed = useInfiniteQuery({
    queryKey: ['explore', algorithm, categoryKey, store?.slug],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ limit: '12', algorithm });
      if (pageParam) params.set('cursor', pageParam);
      if (categories.length > 0 && !store)
        params.set('categories', categories.join(','));
      const endpoint = store
        ? `feed/store/${encodeURIComponent(store.slug)}`
        : 'feed/explore';
      return getJson<Feed>(`${endpoint}?${params}`, signal);
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    // Keep the current cards on screen while a filter change loads, and reuse
    // a page for a moment when the visitor comes back to it.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  // Filters and sponsored cards never paint the first screen, so they wait for
  // the feed instead of competing with it for the visitor's connection.
  const feedSettled = !feed.isPending;
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: ({ signal }) =>
      getJson<ShopCategoryFacet[]>('feed/explore/categories', signal),
    enabled: feedSettled,
    staleTime: 60_000,
  });
  const adsQuery = useQuery({
    queryKey: ['boost', 'feed-ads'],
    queryFn: ({ signal }) => getFeedAds(signal),
    enabled: feedSettled,
    staleTime: 120_000,
    retry: 0,
  });
  const stores = storesQuery.data?.items ?? [];
  const categoryFacets = categoriesQuery.data ?? [];
  const ads: BoostAd[] = adsQuery.data ?? [];
  const source = feed.data?.pages.flatMap((page) => page.items) ?? [];
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
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function navigate(next: View) {
    setView(next);
    setStore(null);
    setCategories([]);
    setSearch('');
    setExplore(false);
    setAlgorithm(next === 'trending' ? 'trending' : 'mixed');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  // Tabs choose the discovery surface, not just an ordering: "Explore" paints
  // every post as a tile grid, while "For you" restores the ranked cards.
  function selectExplore(next: boolean) {
    setExplore(next);
    setAlgorithm(next ? 'recent' : 'mixed');
  }
  function toggleCategory(slug: string) {
    setCategories((current) =>
      current.includes(slug)
        ? current.filter((value) => value !== slug)
        : [...current, slug],
    );
  }
  function clearCategories() {
    setCategories([]);
  }
  const isLoading =
    settingsQuery.isLoading || feed.isLoading || storesQuery.isLoading;
  // The tile grid only exists on the discovery surface; a selected shop or
  // search view always falls back to the card feed.
  const exploreActive = explore && view === 'discover' && !store;
  const feedTitle =
    store?.name ||
    {
      discover: exploreActive
        ? 'Explore'
        : algorithm === 'recent'
          ? 'Latest'
          : 'For you',
      trending: 'Trending',
      videos: 'Videos',
      saved: 'Saved',
    }[view];
  function openPost(post: Post, index: number) {
    setSelected(post);
    setSelectedIndex(index);
    void registerView(post);
  }
  return {
    view,
    algorithm,
    explore,
    exploreActive,
    categories,
    store,
    search,
    selected,
    selectedIndex,
    notice,
    searchOpen,
    filtersOpen,
    layout,
    liking,
    saved,
    settingsQuery,
    settings,
    theme,
    storesQuery,
    feed,
    stores,
    categoryFacets,
    ads,
    source,
    posts,
    isLoading,
    feedTitle,
    setView,
    setAlgorithm,
    selectExplore,
    setCategories,
    setStore,
    setSearch,
    setSelected,
    setNotice,
    setSearchOpen,
    setFiltersOpen,
    setLayout,
    navigate,
    toggleCategory,
    clearCategories,
    savePost,
    likePost,
    registerView,
    withLikes,
    openPost,
  };
}

export type DiscoveryFeedController = ReturnType<typeof useDiscoveryFeed>;
