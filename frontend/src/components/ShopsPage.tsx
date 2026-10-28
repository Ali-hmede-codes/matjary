import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeCheck,
  Compass,
  Heart,
  MapPin,
  Search,
  Store as StoreIcon,
  X,
} from 'lucide-react';
import {
  getJson,
  type StoreDirectory,
  type StoreDirectoryItem,
} from '../lib/api';
import { isStoreVerified } from '../lib/storefront';
import { usePageSeo } from '../hooks/usePageSeo';
import { useShopFavorites } from '../hooks/useShopFavorites';
import { useWebsiteSettings } from '../hooks/useWebsiteSettings';
import { StatusBanner, Toast } from './Feedback';
import { ShopTile } from './ShopTile';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

interface Facet {
  slug: string;
  label: string;
  count: number;
}

interface CityFacet {
  name: string;
  count: number;
}

// One pass over the loaded directory builds the group facets, so typing or
// switching a filter never costs another request.
function buildGroupFacets(items: StoreDirectoryItem[]): Facet[] {
  const groups = new Map<string, { label: string; count: number }>();
  for (const item of items) {
    const group = groups.get(item.categoryGroup);
    if (group) group.count += 1;
    else
      groups.set(item.categoryGroup, {
        label: item.categoryGroupLabel,
        count: 1,
      });
  }
  return [...groups.entries()]
    .map(([slug, value]) => ({ slug, ...value }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildCities(items: StoreDirectoryItem[]): CityFacet[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = item.city?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  // Bigger cities lead; the alphabet breaks ties so the list stays stable.
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

// Case- and accent-insensitive matching, so "cafe" still finds "Café".
const searchable = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase();

export function ShopsPage() {
  const { settings, theme, settingsQuery } = useWebsiteSettings();
  const directoryQuery = useQuery({
    queryKey: ['store-directory'],
    queryFn: ({ signal }) =>
      getJson<StoreDirectory>('stores/directory', signal),
    // The directory changes slowly; a five-minute cache keeps revisits instant.
    staleTime: 300_000,
  });
  const items = useMemo(
    () => directoryQuery.data?.items ?? [],
    [directoryQuery.data],
  );
  const total = directoryQuery.data?.total ?? items.length;

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [group, setGroup] = useState('');
  const [city, setCity] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [notice, setNotice] = useState('');
  const favorites = useShopFavorites(setNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const facets = useMemo(() => buildGroupFacets(items), [items]);
  const scopedItems = useMemo(
    () => items.filter((item) => !group || item.categoryGroup === group),
    [items, group],
  );
  const cities = useMemo(() => buildCities(scopedItems), [scopedItems]);
  // A narrower shop type can retire the chosen city; ignoring the stale value
  // beats leaving an invisible filter that empties the grid.
  const cityFilter =
    city && cities.some((entry) => entry.name === city) ? city : '';

  const filtered = useMemo(() => {
    const needle = searchable(deferredQuery.trim());
    return scopedItems.filter((item) => {
      if (cityFilter && (item.city?.trim() ?? '') !== cityFilter) return false;
      if (verifiedOnly && !isStoreVerified(item)) return false;
      if (!needle) return true;
      return searchable(
        `${item.name} ${item.businessCategoryLabel} ${item.categoryGroupLabel} ${item.city ?? ''} ${item.country ?? ''}`,
      ).includes(needle);
    });
  }, [scopedItems, cityFilter, verifiedOnly, deferredQuery]);

  const hasFilters = Boolean(query || group || cityFilter || verifiedOnly);

  // Each category group becomes its own titled band, so a long directory reads
  // like a menu instead of one wall of cards. Empty groups drop out entirely.
  const sections = useMemo(() => {
    const buckets = new Map<string, StoreDirectoryItem[]>();
    for (const item of filtered) {
      const bucket = buckets.get(item.categoryGroup);
      if (bucket) bucket.push(item);
      else buckets.set(item.categoryGroup, [item]);
    }
    return facets.flatMap((entry) => {
      const groupItems = buckets.get(entry.slug);
      return groupItems?.length
        ? [{ slug: entry.slug, label: entry.label, items: groupItems }]
        : [];
    });
  }, [filtered, facets]);

  function resetFilters() {
    setQuery('');
    setGroup('');
    setCity('');
    setVerifiedOnly(false);
  }

  usePageSeo({
    title: `All shops — ${settings.siteName}`,
    description: `Browse every shop on ${settings.siteName} by type and city.`,
    siteName: settings.siteName,
    canonical: '/shops',
  });

  return (
    <div className="app shops-page" style={theme}>
      <a className="skip-link" href="#shops-directory">
        Skip to the shop directory
      </a>
      <SiteHeader settings={settings} view="shops" />
      <div className="page-shell">
        <main className="shops-main" id="shops-directory" tabIndex={-1}>
          <header className="shops-head">
            <span className="shops-kicker">
              <Compass size={13} aria-hidden="true" /> Shop directory
            </span>
            <h1 id="shops-title">Every shop, in one place</h1>
            <p className="shops-lede">
              {total > 0
                ? `${plural(total, 'independent shop', 'independent shops')} sharing their posts, menus, and products.`
                : 'Independent shops sharing their posts, menus, and products.'}
            </p>
            <div className="shops-search-row">
              <label className="shops-search">
                <Search size={17} aria-hidden="true" />
                <span className="sr-only">Search shops</span>
                <input
                  type="search"
                  value={query}
                  placeholder="Search shops, types, or cities…"
                  autoComplete="off"
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear the shop search"
                    onClick={() => setQuery('')}
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                )}
              </label>
              <a className="shops-favorites-link" href="/favorites">
                <Heart size={15} aria-hidden="true" />
                Your favorites
                {favorites.favorites.length > 0 && (
                  <span className="shops-count">
                    {favorites.favorites.length}
                  </span>
                )}
              </a>
            </div>
            <div
              className="shops-toolbar"
              role="group"
              aria-label="Filter shops"
              aria-busy={directoryQuery.isPending}
            >
              <label className="shops-select">
                <StoreIcon size={15} aria-hidden="true" />
                <span className="sr-only">Shop type</span>
                <select
                  value={group}
                  onChange={(event) => setGroup(event.target.value)}
                >
                  <option value="">All types ({items.length})</option>
                  {facets.map((entry) => (
                    <option key={entry.slug} value={entry.slug}>
                      {entry.label} ({entry.count})
                    </option>
                  ))}
                </select>
              </label>
              <label className="shops-select">
                <MapPin size={15} aria-hidden="true" />
                <span className="sr-only">City</span>
                <select
                  value={cityFilter}
                  onChange={(event) => setCity(event.target.value)}
                >
                  <option value="">All cities</option>
                  {cities.map((entry) => (
                    <option key={entry.name} value={entry.name}>
                      {entry.name} ({entry.count})
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={`shops-verified ${verifiedOnly ? 'selected' : ''}`}
                aria-pressed={verifiedOnly}
                onClick={() => setVerifiedOnly(!verifiedOnly)}
              >
                <BadgeCheck size={15} aria-hidden="true" />
                Verified only
              </button>
              {hasFilters && (
                <button className="shops-reset" onClick={resetFilters}>
                  Clear filters
                </button>
              )}
              {!directoryQuery.isPending && (
                <p className="shops-result" role="status">
                  {hasFilters
                    ? `${filtered.length} of ${items.length} shops`
                    : plural(items.length, 'shop', 'shops')}
                </p>
              )}
            </div>
          </header>

          {directoryQuery.isError && (
            <StatusBanner
              action="Try again"
              onAction={() => void directoryQuery.refetch()}
            >
              {items.length
                ? 'Shops couldn’t refresh. The last loaded list is shown.'
                : 'Shops couldn’t load right now. Please try again in a moment.'}
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

          {directoryQuery.isPending && (
            <>
              <p className="shops-status" role="status">
                Loading every shop…
              </p>
              <div className="shops-skeleton" aria-hidden="true">
                {Array.from({ length: 8 }, (_, index) => (
                  <span key={index} />
                ))}
              </div>
            </>
          )}

          {!directoryQuery.isPending && !filtered.length && (
            <div className="shops-empty" role="status">
              <StoreIcon size={26} aria-hidden="true" />
              <h2>
                {hasFilters
                  ? 'No shops match these filters'
                  : directoryQuery.isError
                    ? 'Shops couldn’t load'
                    : 'The first shops are on their way'}
              </h2>
              <p>
                {hasFilters
                  ? 'Try another shop type, city, or a shorter search.'
                  : directoryQuery.isError
                    ? 'Please try again in a moment.'
                    : 'New shops appear here as they open.'}
              </p>
              {hasFilters && (
                <button className="text-button" onClick={resetFilters}>
                  Clear filters
                </button>
              )}
            </div>
          )}

          {sections.map((section) => (
            <section
              className="shops-section"
              key={section.slug}
              aria-labelledby={`shops-group-${section.slug}`}
            >
              <div className="shops-section-head">
                <h2 id={`shops-group-${section.slug}`}>{section.label}</h2>
                <span>{plural(section.items.length, 'shop', 'shops')}</span>
              </div>
              <ul className="shops-grid" aria-label={section.label}>
                {section.items.map((item) => (
                  <li key={item.id}>
                    <ShopTile
                      item={item}
                      favorite={favorites.isFavorite(item.id)}
                      onToggleFavorite={(shop) =>
                        favorites.toggleFavorite(shop.id, shop.name)
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {total > items.length && (
            <p className="shops-note">
              Showing the first {items.length} of {total} shops.
            </p>
          )}

          <SiteFooter settings={settings} />
        </main>
      </div>
      <Toast message={notice} icon={<Heart size={16} aria-hidden="true" />} />
    </div>
  );
}
