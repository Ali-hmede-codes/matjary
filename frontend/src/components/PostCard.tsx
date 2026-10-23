import { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Eye,
  Heart,
  ImageOff,
  Layers,
  Play,
  X,
} from 'lucide-react';
import { assetUrl, type Media, type Post, type Store } from '../lib/api';

export function StoreAvatar({
  store,
  large = false,
}: {
  store?: Store;
  large?: boolean;
}) {
  return (
    <span className={`store-avatar ${large ? 'large' : ''}`} aria-hidden="true">
      {(store?.name || 'M')
        .split(' ')
        .map((part) => part[0])
        .slice(0, 2)
        .join('')}
    </span>
  );
}

function MediaView({
  media,
  title,
  playing = false,
}: {
  media?: Media;
  title: string;
  playing?: boolean;
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
  if (media.kind === 'video' && playing && src) {
    return (
      <video
        src={src}
        poster={assetUrl(media.posterUrl)}
        controls
        playsInline
        preload="metadata"
        aria-label={title}
        onError={() => setFailed(true)}
      />
    );
  }
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
        loading="lazy"
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

export function PostCard({
  post,
  index,
  saved,
  onSave,
  onOpen,
  onStore,
  demo,
}: {
  post: Post;
  index: number;
  saved: boolean;
  onSave: () => void;
  onOpen: () => void;
  onStore: (store: Store) => void;
  demo: boolean;
}) {
  const media = post.media[0];
  return (
    <article
      className="post-card"
      style={{ animationDelay: `${Math.min(index, 5) * 55}ms` }}
    >
      <header className="post-header">
        <button
          className="store-identity"
          onClick={() => post.store && onStore(post.store)}
          disabled={!post.store}
        >
          <StoreAvatar store={post.store} />
          <span>
            <strong>{post.store?.name || 'Independent creator'}</strong>
            <small>
              {demo
                ? 'Sample showcase'
                : post.store?.location?.city || 'Independent store'}
            </small>
          </span>
        </button>
        {demo && <span className="sample-label">SAMPLE</span>}
      </header>
      <button
        className="post-image"
        onClick={onOpen}
        aria-label={`Open ${post.title}`}
      >
        <MediaView key={media?.id} media={media} title={post.title} />
        {media?.kind === 'video' && (
          <span className="play-badge">
            <Play fill="currentColor" size={20} />
          </span>
        )}
        {post.media.length > 1 && (
          <span className="media-count">
            <Layers size={14} />
            {post.media.length}
          </span>
        )}
        <span className="image-open">
          Take a closer look <ChevronRight size={14} />
        </span>
      </button>
      <div className="post-body">
        <div className="post-actions">
          <span className="engagement" title="Likes">
            <Heart size={19} />
            {demo ? 'Made to inspire' : post.engagement.likes.toLocaleString()}
          </span>
          {!demo && (
            <span className="engagement views" title="Views">
              <Eye size={18} />
              {post.engagement.views.toLocaleString()}
            </span>
          )}
          <button
            className={`icon-button save-button ${saved ? 'is-saved' : ''}`}
            aria-pressed={saved}
            aria-label={`${saved ? 'Unsave' : 'Save'} ${post.title} on this device`}
            onClick={onSave}
          >
            <Bookmark size={20} fill={saved ? 'currentColor' : 'none'} />
          </button>
        </div>
        <button className="post-title" onClick={onOpen}>
          {post.title}
        </button>
        <p>{post.description || 'A new find, waiting to be discovered.'}</p>
      </div>
    </article>
  );
}

export function PostDialog({
  post,
  onClose,
}: {
  post: Post;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  const media = post.media[index];
  return (
    <dialog
      ref={dialog}
      className="post-dialog"
      aria-labelledby="detail-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-content">
        <button
          className="icon-button dialog-close"
          onClick={onClose}
          aria-label="Close showcase"
          autoFocus
        >
          <X />
        </button>
        <div className="dialog-media">
          <MediaView key={media?.id} media={media} title={post.title} playing />
        </div>
        {post.media.length > 1 && (
          <div className="gallery-controls">
            <button
              className="icon-button"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
              aria-label="Previous media"
            >
              <ChevronLeft />
            </button>
            <span>
              {index + 1} / {post.media.length}
            </span>
            <button
              className="icon-button"
              disabled={index === post.media.length - 1}
              onClick={() => setIndex(index + 1)}
              aria-label="Next media"
            >
              <ChevronRight />
            </button>
          </div>
        )}
        <div className="dialog-copy">
          <span className="eyebrow">
            {post.store?.name || 'Independent creator'}
          </span>
          <h2 id="detail-title">{post.title}</h2>
          <p>{post.description}</p>
        </div>
      </div>
    </dialog>
  );
}
