import { useEffect, useRef } from 'react';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import { trackAdEvent, type AdCallToAction, type BoostAd } from '../lib/api';
import { storePath, storeMediaUrl } from '../lib/storefront';

const CTA_LABELS: Record<AdCallToAction, string> = {
  shop_now: 'Shop now',
  learn_more: 'Learn more',
  visit_store: 'Visit store',
  contact: 'Get in touch',
  book_now: 'Book now',
};

// One impression per campaign and page visit: StrictMode remounts and
// scrolling back and forth must not inflate delivery counters.
const trackedImpressions = new Set<string>();

export function AdCard({ ad }: { ad: BoostAd }) {
  const ref = useRef<HTMLElement>(null);
  const image = storeMediaUrl(ad.targetImageKey);
  const storeSlug =
    ad.targetType === 'store' ? ad.targetSlug : ad.targetStoreSlug;
  const href = storeSlug ? storePath(storeSlug) : undefined;
  const cta = CTA_LABELS[ad.creative?.callToAction ?? 'visit_store'] ?? 'Visit';

  useEffect(() => {
    const node = ref.current;
    if (!node || trackedImpressions.has(ad.id)) return;
    const track = () => {
      if (trackedImpressions.has(ad.id)) return;
      trackedImpressions.add(ad.id);
      void trackAdEvent(ad.id, 'impression');
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
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ad.id]);

  function open() {
    void trackAdEvent(ad.id, 'click');
  }

  const body = (
    <>
      <span className="ad-card-media" aria-hidden="true">
        {image ? (
          <img src={image} alt="" loading="lazy" />
        ) : (
          <span className="ad-card-mark">
            {ad.targetName.slice(0, 2).toUpperCase() || 'M'}
          </span>
        )}
      </span>
      <span className="ad-card-body">
        <span className="ad-card-kicker">
          <Sparkles size={13} /> Sponsored · {ad.sponsoredBy}
        </span>
        <strong>{ad.creative?.headline || ad.targetName}</strong>
        <span className="ad-card-copy">
          {ad.creative?.description ||
            (ad.targetType === 'store'
              ? `Discover what is new at ${ad.targetName}.`
              : `A find from ${ad.targetName}.`)}
        </span>
        <span className="ad-card-cta">
          {cta} <ArrowUpRight size={15} />
        </span>
      </span>
    </>
  );

  return (
    <article className="ad-card" ref={ref} aria-label="Sponsored">
      <span className="ad-card-label">AD</span>
      {href ? (
        <a className="ad-card-link" href={href} onClick={open}>
          {body}
        </a>
      ) : (
        <span className="ad-card-link">{body}</span>
      )}
    </article>
  );
}
