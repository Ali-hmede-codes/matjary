import {
  Bookmark,
  Film,
  Flame,
  Heart,
  House,
  Plus,
  Search,
  Store,
  Tag,
  UserRound,
  X,
} from 'lucide-react';
import { assetUrl, loginUrl } from '../lib/api';
import type { View } from '../lib/feed';
import { brandingUrl, type WebsiteSettings } from '../lib/website';

const navigation = [
  { id: 'discover', label: 'Home', icon: House },
  { id: 'trending', label: 'Trending', icon: Flame },
  { id: 'videos', label: 'Videos', icon: Film },
  { id: 'saved', label: 'Saved', icon: Bookmark },
] as const;

type SiteHeaderProps = { settings: WebsiteSettings } & (
  | { view: 'pricing' | 'shops' | 'favorites' }
  | {
      view: View;
      search: string;
      searchOpen: boolean;
      onNavigate: (view: View) => void;
      onSearchChange: (search: string) => void;
      onToggleSearch: () => void;
    }
);

export function SiteHeader(props: SiteHeaderProps) {
  const { settings, view } = props;
  // Property presence narrows the union reliably; comparing view values does
  // not, because one branch's view is itself a union.
  const feed = 'search' in props ? props : null;
  return (
    <header className="site-header">
      <div className="topbar">
        <a className="brand" href="/" aria-label={`${settings.siteName} home`}>
          <img
            className="brand-logo"
            src={
              brandingUrl(assetUrl(settings.logoUrl)) ||
              brandingUrl('/logo.png')
            }
            alt=""
          />
          <span className="brand-name">{settings.siteName}</span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) =>
            feed ? (
              <button
                key={id}
                onClick={() => feed.onNavigate(id)}
                className={view === id ? 'active' : ''}
                aria-current={view === id ? 'page' : undefined}
              >
                <Icon size={19} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ) : (
              <a key={id} href={id === 'discover' ? '/' : `/?view=${id}`}>
                <Icon size={19} aria-hidden="true" />
                <span>{label}</span>
              </a>
            ),
          )}
          <a
            href="/shops"
            className={view === 'shops' ? 'active' : ''}
            aria-current={view === 'shops' ? 'page' : undefined}
          >
            <Store size={19} aria-hidden="true" />
            <span>Shops</span>
          </a>
          <a
            href="/pricing"
            className={view === 'pricing' ? 'active' : ''}
            aria-current={view === 'pricing' ? 'page' : undefined}
          >
            <Tag size={19} aria-hidden="true" />
            <span>Pricing</span>
          </a>
        </nav>
        {feed && (
          <label className="search-box" id="feed-search">
            <Search size={18} />
            <input
              value={feed.search}
              onChange={(event) => feed.onSearchChange(event.target.value)}
              placeholder="Search posts and stores"
              aria-label="Search loaded posts and stores"
            />
            {feed.search && (
              <button
                className="icon-button"
                aria-label="Clear search"
                onClick={() => feed.onSearchChange('')}
              >
                <X size={16} />
              </button>
            )}
          </label>
        )}
        <div className="header-actions">
          {feed && (
            <button
              className="icon-button search-toggle"
              aria-label="Search posts and stores"
              aria-controls="feed-search"
              aria-expanded={feed.searchOpen}
              onClick={() => feed.onToggleSearch()}
            >
              {feed.searchOpen ? <X size={22} /> : <Search size={22} />}
            </button>
          )}
          <a
            className={`icon-button favorites-link ${view === 'favorites' ? 'active' : ''}`}
            href="/favorites"
            aria-label="Your favorite shops"
            title="Your favorite shops"
          >
            <Heart size={21} aria-hidden="true" />
          </a>
          <a
            className="create-button"
            href={loginUrl}
            aria-label="Sign in to share a post"
          >
            <Plus size={20} />
            <span>Create</span>
          </a>
          <a
            className="profile-button"
            href={loginUrl}
            aria-label="Sign in to your account"
          >
            <UserRound size={21} />
          </a>
        </div>
      </div>
    </header>
  );
}
