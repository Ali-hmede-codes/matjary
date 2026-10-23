import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Store as StoreIcon,
} from 'lucide-react';
import { assetUrl, type Store } from '../lib/api';
import type { WebsiteSettings } from '../lib/website';
import { StoreAvatar } from './StoreAvatar';

export function DiscoveryRail({
  stores,
  savedCount,
  settings,
  onSelectStore,
  onOpenSaved,
}: {
  stores: Store[];
  savedCount: number;
  settings: WebsiteSettings;
  onSelectStore: (store: Store) => void;
  onOpenSaved: () => void;
}) {
  return (
    <aside className="discovery-rail" aria-label="More to explore">
      <div className="rail-heading">
        <h2>Stores to explore</h2>
        <StoreIcon size={18} />
      </div>
      {stores.slice(0, 5).map((item) => (
        <button
          className="suggested-store"
          key={item.id}
          onClick={() => onSelectStore(item)}
        >
          <StoreAvatar store={item} />
          <span>
            <strong>{item.name}</strong>
            <small>{item.location?.city || 'Explore store'}</small>
          </span>
          <ArrowUpRight size={17} />
        </button>
      ))}
      {!stores.length && (
        <p className="rail-empty">Stores will appear here as they join.</p>
      )}
      <div className="saved-shortcut">
        <span className="saved-shortcut-icon">
          <Bookmark size={22} />
        </span>
        <div>
          <strong>Your collection</strong>
          <span>{savedCount} saved on this device</span>
        </div>
        <button
          className="icon-button"
          aria-label="Open saved posts"
          onClick={onOpenSaved}
        >
          <ArrowRight size={18} />
        </button>
      </div>
      {settings.bannerUrl && (
        <img
          className="community-banner"
          src={assetUrl(settings.bannerUrl)}
          alt={`${settings.siteName} banner`}
          loading="lazy"
        />
      )}
      {(settings.tagline || settings.description) && (
        <p className="rail-about">{settings.tagline || settings.description}</p>
      )}
    </aside>
  );
}
