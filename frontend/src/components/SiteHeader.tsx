import {
  Bookmark,
  Film,
  Flame,
  House,
  Plus,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import { assetUrl, loginUrl } from '../lib/api';
import type { View } from '../lib/feed';
import type { WebsiteSettings } from '../lib/website';

const navigation = [
  { id: 'discover', label: 'Home', icon: House },
  { id: 'trending', label: 'Trending', icon: Flame },
  { id: 'videos', label: 'Videos', icon: Film },
  { id: 'saved', label: 'Saved', icon: Bookmark },
] as const;

export function SiteHeader({
  settings,
  view,
  search,
  searchOpen,
  onNavigate,
  onSearchChange,
  onToggleSearch,
}: {
  settings: WebsiteSettings;
  view: View;
  search: string;
  searchOpen: boolean;
  onNavigate: (view: View) => void;
  onSearchChange: (search: string) => void;
  onToggleSearch: () => void;
}) {
  return (
    <header className="site-header">
      <div className="topbar">
        <a className="brand" href="/" aria-label={`${settings.siteName} home`}>
          {settings.logoUrl ? (
            <img
              className="brand-logo"
              src={assetUrl(settings.logoUrl)}
              alt=""
            />
          ) : (
            <span className="brand-mark" aria-hidden="true">
              m
            </span>
          )}
          <span className="brand-name">{settings.siteName}</span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={view === id ? 'active' : ''}
              aria-current={view === id ? 'page' : undefined}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <label className="search-box" id="feed-search">
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search posts and stores"
            aria-label="Search loaded posts and stores"
          />
          {search && (
            <button
              className="icon-button"
              aria-label="Clear search"
              onClick={() => onSearchChange('')}
            >
              <X size={16} />
            </button>
          )}
        </label>
        <div className="header-actions">
          <button
            className="icon-button search-toggle"
            aria-label="Search posts and stores"
            aria-controls="feed-search"
            aria-expanded={searchOpen}
            onClick={() => onToggleSearch()}
          >
            {searchOpen ? <X size={22} /> : <Search size={22} />}
          </button>
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
