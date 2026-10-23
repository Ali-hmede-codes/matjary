import { useState } from 'react';
import { assetUrl, type Media, type Store } from '../lib/api';

export function StoreAvatar({
  store,
  large = false,
  preview,
}: {
  store?: Store;
  large?: boolean;
  preview?: Media;
}) {
  const [failed, setFailed] = useState(false);
  const thumbnail = assetUrl(
    preview?.kind === 'video' ? preview.posterUrl : preview?.primaryUrl,
  );
  return (
    <span className={`store-avatar ${large ? 'large' : ''}`} aria-hidden="true">
      {thumbnail && !failed ? (
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
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
