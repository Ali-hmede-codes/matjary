import { ArrowRight, Sparkles } from 'lucide-react';
import { DiscoveryRail } from './components/DiscoveryRail';
import { FeedPosts } from './components/FeedPosts';
import { FeedToolbar } from './components/FeedToolbar';
import { LoadingBar, StatusBanner, Toast } from './components/Feedback';
import { PostDialog } from './components/PostDialog';
import { SiteFooter } from './components/SiteFooter';
import { SiteHeader } from './components/SiteHeader';
import { StoreStrip } from './components/StoreStrip';
import { useDiscoveryFeed } from './hooks/useDiscoveryFeed';

export default function App() {
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
    saved,
    selected,
    selectedIndex,
    notice,
    liking,
    navigate,
    chooseStore,
    toggleDemo,
    savePost,
    likePost,
    withLikes,
    setSearch,
    setSearchOpen,
    setStore,
    setCategory,
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
              onSelectStore={chooseStore}
              onClearStore={() => {
                setStore(null);
                setCategory('');
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
            onSelectStore={chooseStore}
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
