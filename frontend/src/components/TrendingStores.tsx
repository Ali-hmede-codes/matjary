import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Flame } from 'lucide-react';
import { getTrendingBoostStores, trackAdEvent, type Store } from '../lib/api';
import { enableMouseScrolling } from '../lib/website';
import { storePath } from '../lib/storefront';
import { StoreAvatar } from './StoreAvatar';

// One impression per campaign and page visit, matching feed ads.
const trackedImpressions = new Set<string>();

export function TrendingStores() {
  const ref = useRef<HTMLElement>(null);
  const query = useQuery({
    queryKey: ['boost', 'trending-stores'],
    queryFn: ({ signal }) => getTrendingBoostStores(signal),
    staleTime: 120_000,
    retry: 0,
  });
  const stores = query.data ?? [];

  useEffect(() => {
    const node = ref.current;
    if (!node || !stores.length) return;
    const track = () => {
      for (const item of stores) {
        if (trackedImpressions.has(item.campaignId)) continue;
        trackedImpressions.add(item.campaignId);
        void trackAdEvent(item.campaignId, 'impression');
      }
    };
    if (!('IntersectionObserver' in window)) {
      track();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          track();
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [stores]);

  if (!stores.length) return null;
  return (
    <section
      className="trending-boosts"
      ref={ref}
      aria-labelledby="trending-boosts-title"
    >
      <div className="trending-boosts-heading">
        <h2 id="trending-boosts-title">
          <Flame size={17} /> Trending shops
        </h2>
        <span>Promoted</span>
      </div>
      <div className="trending-boosts-row" ref={enableMouseScrolling}>
        {stores.map((item) => {
          const store: Store = {
            id: item.id,
            name: item.name,
            slug: item.slug,
            brandColor: item.brandColor ?? null,
            logoKey: item.logoKey ?? null,
          };
          return (
            <a
              className="trending-boost"
              key={item.campaignId}
              href={storePath(item.slug)}
              onClick={() => void trackAdEvent(item.campaignId, 'click')}
            >
              <StoreAvatar store={store} large />
              <span>
                <strong className="notranslate">{item.name}</strong>
                <small className="notranslate">
                  {item.headline || item.city || 'Boosted shop'}
                </small>
              </span>
              <ArrowUpRight size={16} />
            </a>
          );
        })}
      </div>
    </section>
  );
}
