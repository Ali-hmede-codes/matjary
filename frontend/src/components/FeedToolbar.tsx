import { LayoutGrid, Rows3, SlidersHorizontal, X } from 'lucide-react';
import type { DiscoveryFeedController } from '../hooks/useDiscoveryFeed';
import type { Algorithm } from '../lib/feed';
import { enableMouseScrolling } from '../lib/website';

type FeedToolbarProps = Pick<
  DiscoveryFeedController,
  | 'view'
  | 'store'
  | 'feedTitle'
  | 'algorithm'
  | 'setAlgorithm'
  | 'demo'
  | 'filtersOpen'
  | 'category'
  | 'setFiltersOpen'
  | 'layout'
  | 'setLayout'
  | 'setStore'
  | 'setView'
  | 'categories'
  | 'setCategory'
  | 'search'
>;

export function FeedToolbar({
  view,
  store,
  feedTitle,
  algorithm,
  setAlgorithm,
  demo,
  filtersOpen,
  category,
  setFiltersOpen,
  layout,
  setLayout,
  setStore,
  setView,
  categories,
  setCategory,
  search,
}: FeedToolbarProps) {
  return (
    <>
      <div className="feed-toolbar">
        <h2
          id="feed-title"
          className={view === 'discover' && !store ? 'sr-only' : 'feed-title'}
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
              layout === 'feed' ? 'Switch to grid view' : 'Switch to feed view'
            }
            onClick={() => setLayout(layout === 'feed' ? 'grid' : 'feed')}
          >
            {layout === 'feed' ? <LayoutGrid size={20} /> : <Rows3 size={20} />}
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
        <button className="active-filter" onClick={() => setCategory('')}>
          {categories.find((item) => item.category === category)?.label ||
            category}
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
    </>
  );
}
