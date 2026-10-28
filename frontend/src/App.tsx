import { ArrowRight, Sparkles } from 'lucide-react';
import { DiscoveryRail } from './components/DiscoveryRail';
import { FeedPosts } from './components/FeedPosts';
import { FeedToolbar } from './components/FeedToolbar';
import { LoadingBar, StatusBanner, Toast } from './components/Feedback';
import { PostDialog } from './components/PostDialog';
import { SiteFooter } from './components/SiteFooter';
import { SiteHeader } from './components/SiteHeader';
import { StoreStrip } from './components/StoreStrip';
import { TrendingStores } from './components/TrendingStores';
import { storefrontRouteFromPath, postSlugFromPath } from './lib/storefront';
import { useDiscoveryFeed } from './hooks/useDiscoveryFeed';

import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { LoginPage, ProtectedPanel } from './features/shared/PanelAuth';
import { Loading } from './features/shared/PanelUI';
import './features/shared/panels.css';
const AdminPanel = lazy(() => import('./features/admin/AdminPanel'));
const OwnerPanel = lazy(() => import('./features/dashboard/OwnerPanel'));
// Shop and pricing screens are reached from the feed, so they stay out of the
// initial bundle; the discovery page ships only what it renders.
const StorePage = lazy(() =>
  import('./components/StorePage').then((module) => ({
    default: module.StorePage,
  })),
);
const StoreCategoryPage = lazy(() =>
  import('./components/StoreCategoryPage').then((module) => ({
    default: module.StoreCategoryPage,
  })),
);
const StoreProductPage = lazy(() =>
  import('./components/StoreProductPage').then((module) => ({
    default: module.StoreProductPage,
  })),
);
// A shared post link opens its own page, so previews and visitors have a
// stable address instead of the media file behind the post.
const PostPage = lazy(() =>
  import('./components/PostPage').then((module) => ({
    default: module.PostPage,
  })),
);
const PricingPage = lazy(() =>
  import('./components/PricingPage').then((module) => ({
    default: module.PricingPage,
  })),
);

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<DiscoveryPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/admin/*"
            element={
              <ProtectedPanel admin>
                {(session) => <AdminPanel session={session} />}
              </ProtectedPanel>
            }
          />
          <Route
            path="/dashboard/*"
            element={
              <ProtectedPanel>
                {(session) => <OwnerPanel session={session} />}
              </ProtectedPanel>
            }
          />
          <Route path="*" element={<StoreRoute />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
function StoreRoute() {
  const { pathname } = useLocation();
  const route = storefrontRouteFromPath(pathname);
  const demo = new URLSearchParams(window.location.search).get('demo') === '1';
  if (route?.postSlug)
    return (
      <PostPage
        key={pathname}
        shopSlug={route.shopSlug}
        postSlug={route.postSlug}
        demo={demo}
      />
    );
  if (route?.productSlug)
    return (
      <StoreProductPage
        key={pathname}
        shopSlug={route.shopSlug}
        productSlug={route.productSlug}
        demo={demo}
      />
    );
  if (route?.categorySlug)
    return (
      <StoreCategoryPage
        key={pathname}
        shopSlug={route.shopSlug}
        categorySlug={route.categorySlug}
        demo={demo}
      />
    );
  // Posts without a shop use the platform path.
  const postSlug = postSlugFromPath(pathname);
  if (postSlug)
    return <PostPage key={pathname} postSlug={postSlug} demo={demo} />;
  return <StorePage key={pathname} slug={route?.shopSlug ?? null} />;
}

function DiscoveryPage() {
  const discovery = useDiscoveryFeed();
  const {
    settings,
    settingsQuery,
    theme,
    view,
    search,
    searchOpen,
    isLoading,
    demo,
    stores,
    storesQuery,
    store,
    source,
    posts,
    feed,
    saved,
    selected,
    selectedIndex,
    notice,
    liking,
    navigate,
    toggleDemo,
    savePost,
    likePost,
    registerView,
    withLikes,
    setSearch,
    setSearchOpen,
    setStore,
    clearCategories,
    setSelected,
    setNotice,
  } = discovery;

  return (
    <div className={`app ${searchOpen ? 'search-open' : ''}`} style={theme}>
      <a className="skip-link" href="#discover-feed">
        Skip to discoveries
      </a>
      {isLoading && <LoadingBar />}
      <SiteHeader
        settings={settings}
        view={view}
        search={search}
        searchOpen={searchOpen}
        onNavigate={navigate}
        onSearchChange={setSearch}
        onToggleSearch={() => setSearchOpen(!searchOpen)}
      />
      <div className="page-shell">
        <main className="main-content">
          <div className="feed-column">
            {demo && (
              <StatusBanner
                demo
                icon={<Sparkles size={17} />}
                action={
                  <>
                    View live feed <ArrowRight size={15} />
                  </>
                }
                onAction={toggleDemo}
              >
                Design preview · Sample stores and photos, not live content.
              </StatusBanner>
            )}
            {settingsQuery.isError && (
              <StatusBanner
                action="Retry settings"
                onAction={() => void settingsQuery.refetch()}
              >
                Website settings are unavailable.{' '}
                {settingsQuery.data
                  ? 'The last loaded branding is shown.'
                  : 'Default branding is shown.'}
              </StatusBanner>
            )}
            <h1 className="sr-only">{settings.siteName} social feed</h1>
            <StoreStrip
              stores={stores}
              selectedStore={store}
              posts={source}
              demo={demo}
              onClearStore={() => {
                setStore(null);
                clearCategories();
              }}
            />
            {!demo && storesQuery.isError && (
              <StatusBanner
                action="Retry stores"
                onAction={() => void storesQuery.refetch()}
              >
                Stores couldn’t load right now.
              </StatusBanner>
            )}
            {!demo && view === 'trending' && <TrendingStores />}
            <section
              id="discover-feed"
              className="discover-feed"
              aria-labelledby="feed-title"
            >
              <FeedToolbar {...discovery} />
              <FeedPosts {...discovery} />
            </section>
          </div>
          <DiscoveryRail
            stores={stores}
            savedCount={saved.length}
            settings={settings}
            demo={demo}
            onOpenSaved={() => navigate('saved')}
          />
          <SiteFooter
            settings={settings}
            demo={demo}
            onToggleDemo={toggleDemo}
          />
        </main>
      </div>
      <Toast message={notice} />
      {selected && (
        <PostDialog
          key={selected.id}
          posts={posts.map((post) => withLikes(post))}
          initialPostId={selected.id}
          initialMediaIndex={selectedIndex}
          notice={notice}
          saved={saved}
          liking={liking}
          onLike={(post) => void likePost(post)}
          onSave={savePost}
          onNotice={setNotice}
          onActivePost={(post) => void registerView(post)}
          onNearEnd={() => {
            // Keep the reel ahead of the viewer instead of dead-ending the
            // feed at the last post of the loaded page.
            if (feed.hasNextPage && !feed.isFetchingNextPage)
              void feed.fetchNextPage();
          }}
          demo={demo}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
