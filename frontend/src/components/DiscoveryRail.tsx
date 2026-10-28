import { ArrowRight, ArrowUpRight, Bookmark } from 'lucide-react';
import { assetUrl, type Store } from '../lib/api';
import { brandingUrl, type WebsiteSettings } from '../lib/website';
import { storePath } from '../lib/storefront';
import { StoreAvatar, StoreVerifiedBadge } from './StoreAvatar';

export function DiscoveryRail({
  stores,
  savedCount,
  settings,
  demo,
  onOpenSaved,
}: {
  stores: Store[];
  savedCount: number;
  settings: WebsiteSettings;
  demo: boolean;
  onOpenSaved: () => void;
}) {
  return (
    <aside className="discovery-rail" aria-label="More to explore">
      <div className="rail-heading">
        <h2>Stores to explore</h2>
        <a className="rail-see-all" href="/shops">
          All shops
          <ArrowRight size={13} aria-hidden="true" />
        </a>
      </div>
      {stores.slice(0, 5).map((item) => (
        <a
          className="suggested-store"
          key={item.id}
          href={storePath(item.slug, demo)}
        >
          <StoreAvatar store={item} />
          <span>
            <strong className="rail-store-name">
              {item.name}
              <StoreVerifiedBadge store={item} size={14} />
            </strong>
            <small>{item.location?.city || 'Explore store'}</small>
          </span>
          <ArrowUpRight size={17} />
        </a>
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
          src={brandingUrl(assetUrl(settings.bannerUrl))}
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
