import { useState, type CSSProperties } from 'react';
import { assetUrl, type Media, type Store } from '../lib/api';
import { storeMediaUrl, storePresentation } from '../lib/storefront';

export function StoreAvatar({
  store,
  large = false,
  preview,
}: {
  store?: Store;
  large?: boolean;
  preview?: Media;
}) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const thumbnail =
    assetUrl(storeMediaUrl(store?.logoKey)) ||
    assetUrl(
      preview?.kind === 'video' ? preview.posterUrl : preview?.primaryUrl,
    );
  const { theme } = storePresentation(store ?? { brandColor: null });
  return (
    <span
      className={`store-avatar ${large ? 'large' : ''}`}
      aria-hidden="true"
      style={
        store?.brandColor
          ? ({
              backgroundColor: theme['--brand-primary'],
              color: theme['--brand-on-primary'],
            } as CSSProperties)
          : undefined
      }
    >
      {thumbnail && thumbnail !== failedSrc ? (
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          onError={() => setFailedSrc(thumbnail)}
        />
      ) : (
        (store?.name || 'M')
          .split(' ')
          .map((part) => part[0])
          .slice(0, 2)
          .join('')
      )}
    </span>
  );
}
