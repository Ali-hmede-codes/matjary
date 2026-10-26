import { useDeferredValue, useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
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
import { demoPosts, demoStores } from '../lib/demo';
import { usePostEngagement } from './usePostEngagement';
import { useWebsiteSettings } from './useWebsiteSettings';

const sampleCategories: ShopCategoryFacet[] = [
  {
    slug: 'restaurants',
    label: 'Restaurant',
    group: 'food_drink',
    groupLabel: 'Food & drink',
    count: 1,
  },
  {
    slug: 'cafe',
    label: 'Café / coffee shop',
    group: 'food_drink',
    groupLabel: 'Food & drink',
    count: 1,
  },
  {
    slug: 'home_furniture',
    label: 'Furniture',
    group: 'retail_fashion',
    groupLabel: 'Retail & fashion',
    count: 1,
  },
  {
    slug: 'handmade_crafts',
    label: 'Handmade & crafts',
    group: 'arts_culture',
    groupLabel: 'Arts & culture',
    count: 1,
  },
  {
    slug: 'flower_shop',
    label: 'Flowers',
    group: 'retail_fashion',
    groupLabel: 'Retail & fashion',
    count: 1,
  },
  {
    slug: 'clothing_store',
    label: 'Clothing store',
    group: 'retail_fashion',
    groupLabel: 'Retail & fashion',
    count: 1,
  },
];

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
  const [categories, setCategories] = useState<string[]>([]);
  const [store, setStore] = useState<Store | null>(null);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [demo, setDemo] = useState(
    () => new URLSearchParams(window.location.search).get('demo') === '1',
  );
  const [selected, setSelected] = useState<Post | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [notice, setNotice] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [layout, setLayout] = useState<FeedLayout>('feed');
  const { saved, liking, likePost, savePost, registerView, withLikes } =
    usePostEngagement({ demo, onNotice: setNotice });

  const { settingsQuery, settings, theme } = useWebsiteSettings(true, !demo);
  const storesQuery = useQuery({
    queryKey: ['stores'],
    queryFn: ({ signal }) =>
      getJson<{ items: Store[] }>('stores?limit=7', signal),
    enabled: !demo,
  });
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: ({ signal }) =>
      getJson<ShopCategoryFacet[]>('feed/explore/categories', signal),
    enabled: !demo,
    staleTime: 60_000,
  });
  const adsQuery = useQuery({
    queryKey: ['boost', 'feed-ads'],
    queryFn: ({ signal }) => getFeedAds(signal),
    enabled: !demo,
    staleTime: 120_000,
    retry: 0,
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
    enabled: !demo,
  });
  const stores = demo ? demoStores : (storesQuery.data?.items ?? []);
  const categoryFacets = demo ? sampleCategories : (categoriesQuery.data ?? []);
  const ads: BoostAd[] = demo ? [] : (adsQuery.data ?? []);
  const source = demo
    ? demoPosts.filter(
        (post) =>
          (categories.length === 0 ||
            categories.includes(post.store?.businessCategory ?? '')) &&
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
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function navigate(next: View) {
    setView(next);
    setStore(null);
    setCategories([]);
    setSearch('');
    setAlgorithm(next === 'trending' ? 'trending' : 'mixed');
    window.scrollTo({ top: 0, behavior: 'instant' });
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
  function toggleDemo() {
    const url = new URL(window.location.href);
    if (demo) url.searchParams.delete('demo');
    else url.searchParams.set('demo', '1');
    window.history.replaceState(null, '', url);
    setDemo(!demo);
    navigate('discover');
  }
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
  function openPost(post: Post, index: number) {
    setSelected(post);
    setSelectedIndex(index);
    void registerView(post);
  }
  return {
    view,
    algorithm,
    categories,
    store,
    search,
    demo,
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
    toggleDemo,
    savePost,
    likePost,
    registerView,
    withLikes,
    openPost,
  };
}

export type DiscoveryFeedController = ReturnType<typeof useDiscoveryFeed>;
