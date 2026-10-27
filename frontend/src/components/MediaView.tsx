import { useState } from 'react';
import { ImageOff, Play } from 'lucide-react';
import { assetUrl, type Media } from '../lib/api';

export function MediaView({
  media,
  title,
  eager = false,
}: {
  media?: Media;
  title: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (!media || failed)
    return (
      <div className="media-placeholder">
        <ImageOff size={28} />
        <span>Preview unavailable</span>
      </div>
    );
  const src = assetUrl(media.primaryUrl);
  const preview = media.kind === 'video' ? assetUrl(media.posterUrl) : src;
  if (!preview)
    return (
      <div className="media-placeholder">
        <Play size={32} />
        <span>Open to watch</span>
      </div>
    );
  const srcSet = (mime: string) =>
    media.variants
      .filter((v) => v.mimeType === mime && v.width > 0 && assetUrl(v.url))
      .filter(
        (v, index, all) =>
          all.findIndex((other) => other.width === v.width) === index,
      )
      .sort((a, b) => a.width - b.width)
      .map((v) => `${assetUrl(v.url)} ${v.width}w`)
      .join(', ');
  const jpeg = media.variants.find((v) => v.mimeType === 'image/jpeg');
  return (
    <picture className={`media-preview ${loaded ? 'is-loaded' : 'is-loading'}`}>
      {media.kind === 'image' && (
        <>
          <source
            type="image/avif"
            srcSet={srcSet('image/avif') || undefined}
            sizes="(max-width: 600px) 100vw, 440px"
          />
          <source
            type="image/webp"
            srcSet={srcSet('image/webp') || undefined}
            sizes="(max-width: 600px) 100vw, 440px"
          />
        </>
      )}
      <img
        src={media.kind === 'image' && jpeg ? assetUrl(jpeg.url) : preview}
        alt={title}
        width={media.width || undefined}
        height={media.height || undefined}
        loading={eager ? 'eager' : 'lazy'}
        // The first card is the largest thing on the first screen; the rest
        // load lazily so the browser spends its early connections there.
        fetchPriority={eager ? 'high' : 'auto'}
        decoding="async"
        ref={(image) => {
          if (image?.complete && image.naturalWidth > 0) setLoaded(true);
        }}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </picture>
  );
}
