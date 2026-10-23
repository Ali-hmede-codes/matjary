import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  getJson,
  togglePostLike,
  type Category,
  type Feed,
  type Post,
  type Store,
} from '../lib/api';
import type { Algorithm, FeedLayout, View } from '../lib/feed';
import { readSavedIds } from '../lib/website';
import { demoPosts, demoStores } from '../lib/demo';
import { useWebsiteSettings } from './useWebsiteSettings';

const sampleCategories = [
  { category: 'merchandise', label: 'Objects & living', count: 4 },
  { category: 'food', label: 'Food & dining', count: 1 },
  { category: 'beverage', label: 'Coffee & more', count: 1 },
];

export function useDiscoveryFeed() {
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
  const [layout, setLayout] = useState<FeedLayout>('feed');
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

  const { settingsQuery, settings, theme } = useWebsiteSettings();
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
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
  function openPost(post: Post, index: number) {
    setSelected(post);
    setSelectedIndex(index);
  }
  return {
    view,
    algorithm,
    category,
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
    categories,
    source,
    posts,
    isLoading,
    feedTitle,
    setView,
    setAlgorithm,
    setCategory,
    setStore,
    setSearch,
    setSelected,
    setNotice,
    setSearchOpen,
    setFiltersOpen,
    setLayout,
    navigate,
    chooseStore,
    toggleDemo,
    savePost,
    likePost,
    withLikes,
    openPost,
  };
}

export type DiscoveryFeedController = ReturnType<typeof useDiscoveryFeed>;
