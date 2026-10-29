import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, Rows3, Search, SlidersHorizontal, X } from 'lucide-react';
import type { DiscoveryFeedController } from '../hooks/useDiscoveryFeed';
import { useUiLabel } from '../hooks/useUiLabel';
import type { Algorithm } from '../lib/feed';

type FeedToolbarProps = Pick<
  DiscoveryFeedController,
  | 'view'
  | 'store'
  | 'feedTitle'
  | 'algorithm'
  | 'setAlgorithm'
  | 'explore'
  | 'exploreActive'
  | 'selectExplore'
  | 'demo'
  | 'filtersOpen'
  | 'categories'
  | 'categoryFacets'
  | 'toggleCategory'
  | 'clearCategories'
  | 'setFiltersOpen'
  | 'layout'
  | 'setLayout'
  | 'setStore'
  | 'setView'
  | 'search'
>;

export function FeedToolbar({
  view,
  store,
  feedTitle,
  algorithm,
  setAlgorithm,
  explore,
  exploreActive,
  selectExplore,
  demo,
  filtersOpen,
  categories,
  categoryFacets,
  toggleCategory,
  clearCategories,
  setFiltersOpen,
  layout,
  setLayout,
  setStore,
  setView,
  search,
}: FeedToolbarProps) {
  const [group, setGroup] = useState('');
  const [categoryQuery, setCategoryQuery] = useState('');
  const filtersRef = useRef<HTMLDivElement>(null);
  // Feed titles (Home, Saved, Videos) are curated; shop names fall through as
  // written and stay in their own script.
  const uiText = useUiLabel();

  // Make the whole panel visible when it opens; without this the fixed mobile
  // dock can cover the last row of shop-type chips.
  useEffect(() => {
    if (!filtersOpen) return;
    filtersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [filtersOpen]);

  // Groups follow the server's popularity order, so the busiest shop types are
  // reachable without scrolling through the whole taxonomy.
  const groups = useMemo(() => {
    const seen = new Map<
      string,
      { slug: string; label: string; total: number }
    >();
    for (const facet of categoryFacets) {
      const current = seen.get(facet.group);
      if (current) current.total += facet.count;
      else
        seen.set(facet.group, {
          slug: facet.group,
          label: facet.groupLabel,
          total: facet.count,
        });
    }
    return [...seen.values()].sort((a, b) => b.total - a.total);
  }, [categoryFacets]);

  const query = categoryQuery.trim().toLowerCase();
  const visibleCategories = categoryFacets.filter(
    (facet) =>
      (!group || facet.group === group) &&
      (!query || facet.label.toLowerCase().includes(query)),
  );

  return (
    <>
      <div className="feed-toolbar">
        <h2
          id="feed-title"
          className={view === 'discover' && !store ? 'sr-only' : 'feed-title'}
        >
          <span className="notranslate">{uiText(feedTitle)}</span>
        </h2>
        {view === 'discover' && !store && (
          <div className="feed-tabs" aria-label="Feed views">
            <button
              className={!explore ? 'selected' : ''}
              aria-pressed={!explore}
              onClick={() => selectExplore(false)}
            >
              <span className="notranslate">{uiText('For you')}</span>
            </button>
            <button
              className={explore ? 'selected' : ''}
              aria-pressed={explore}
              onClick={() => selectExplore(true)}
            >
              <span className="notranslate">{uiText('Explore')}</span>
            </button>
          </div>
        )}
        <div className="feed-tools">
          {!store && (
            <button
              className={`icon-button ${filtersOpen || categories.length > 0 ? 'tool-active' : ''}`}
              aria-label="Filter your feed by shop type"
              aria-expanded={filtersOpen}
              aria-controls="feed-filters"
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              <SlidersHorizontal size={20} />
              {categories.length > 0 && (
                <span className="tool-badge">{categories.length}</span>
              )}
            </button>
          )}
          {/* Explore already is a grid; the card-density toggle would only
              muddle the choice, so it belongs to the "For you" surface. */}
          {!exploreActive && (
            <button
              className="icon-button"
              aria-label={
                layout === 'feed'
                  ? 'Switch to grid view'
                  : 'Switch to feed view'
              }
              onClick={() => setLayout(layout === 'feed' ? 'grid' : 'feed')}
            >
              {layout === 'feed' ? (
                <LayoutGrid size={20} />
              ) : (
                <Rows3 size={20} />
              )}
            </button>
          )}
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
        <div className="feed-filters" id="feed-filters" ref={filtersRef}>
          <label className="sort-select">
            <span className="notranslate">{uiText('Sort by')}</span>
            <select
              className="notranslate"
              value={algorithm}
              disabled={demo}
              onChange={(event) => {
                setAlgorithm(event.target.value as Algorithm);
                if (view === 'trending') setView('discover');
              }}
            >
              <option value="mixed">{uiText('For you')}</option>
              <option value="recent">{uiText('Newest first')}</option>
              <option value="trending">{uiText('Trending')}</option>
            </select>
          </label>

          <label className="category-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Find a shop type</span>
            <input
              className="notranslate"
              type="search"
              value={categoryQuery}
              placeholder={uiText('Find a shop type…')}
              autoComplete="off"
              onChange={(event) => setCategoryQuery(event.target.value)}
            />
            {categoryQuery && (
              <button
                type="button"
                aria-label="Clear the shop type search"
                onClick={() => setCategoryQuery('')}
              >
                <X size={14} />
              </button>
            )}
          </label>

          {groups.length > 0 && (
            <div
              className="category-groups"
              role="group"
              aria-label="Shop type groups"
            >
              <button
                className={!group ? 'selected' : ''}
                aria-pressed={!group}
                onClick={() => setGroup('')}
              >
                All groups
              </button>
              {groups.map((item) => (
                <button
                  key={item.slug}
                  className={group === item.slug ? 'selected' : ''}
                  aria-pressed={group === item.slug}
                  onClick={() => setGroup(item.slug)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          <div className="category-tabs" role="group" aria-label="Shop types">
            <button
              className={!categories.length ? 'selected' : ''}
              aria-pressed={!categories.length}
              onClick={clearCategories}
            >
              <span className="notranslate">{uiText('All types')}</span>
            </button>
            {visibleCategories.map((item) => {
              const selected = categories.includes(item.slug);
              return (
                <button
                  key={item.slug}
                  className={selected ? 'selected' : ''}
                  aria-pressed={selected}
                  onClick={() => toggleCategory(item.slug)}
                >
                  {item.label}
                  <span className="category-count">{item.count}</span>
                </button>
              );
            })}
          </div>
          {visibleCategories.length === 0 && (
            <p className="filter-note">No shop types match this search yet.</p>
          )}
          <p className="filter-note category-hint">
            Pick one or more types. The feed keeps every matching shop and ranks
            posts you are most likely to enjoy first.
          </p>
        </div>
      )}
      {categories.length > 0 && !store && (
        <div className="active-filters" aria-label="Active shop type filters">
          {categories.map((slug) => {
            const label =
              categoryFacets.find((facet) => facet.slug === slug)?.label ??
              slug;
            return (
              <button
                key={slug}
                className="active-filter"
                onClick={() => toggleCategory(slug)}
                aria-label={`Remove ${label} filter`}
              >
                {label}
                <X size={14} />
              </button>
            );
          })}
          <button className="clear-filters" onClick={clearCategories}>
            <span className="notranslate">{uiText('Clear all')}</span>
          </button>
        </div>
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
    </>
  );
}
