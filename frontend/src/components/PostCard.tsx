import { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Eye,
  Expand,
  Heart,
  ImageOff,
  Layers,
  Play,
  Send,
  X,
} from 'lucide-react';
import { assetUrl, type Media, type Post, type Store } from '../lib/api';

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

function MediaView({
  media,
  title,
  playing = false,
  eager = false,
}: {
  media?: Media;
  title: string;
  playing?: boolean;
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
  if (media.kind === 'video' && playing && src) {
    return (
      <video
        src={src}
        poster={assetUrl(media.posterUrl)}
        controls
        autoPlay
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
        loading={eager ? 'eager' : 'lazy'}
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

interface ActionProps {
  post: Post;
  saved: boolean;
  liking: boolean;
  onLike: () => void;
  onSave: () => void;
  onNotice: (message: string) => void;
}

function PostActions({
  post,
  media,
  saved,
  liking,
  onLike,
  onSave,
  onNotice,
}: ActionProps & { media?: Media }) {
  const [sharing, setSharing] = useState(false);
  const shareUrl = assetUrl(media?.primaryUrl);
  async function shareMedia() {
    if (!shareUrl || sharing) return;
    setSharing(true);
    try {
      const url = new URL(shareUrl, window.location.origin).href;
      if (navigator.share) {
        await navigator.share({ title: post.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        onNotice('Media link copied.');
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        onNotice('Sharing is unavailable in this browser.');
      }
    } finally {
      setSharing(false);
    }
  }
  return (
    <div className="post-actions">
      <button
        className={`icon-button like-button ${post.engagement.viewerLiked ? 'is-liked' : ''}`}
        aria-label={`${post.engagement.viewerLiked ? 'Unlike' : 'Like'} ${post.title}`}
        aria-pressed={post.engagement.viewerLiked}
        disabled={liking}
        onClick={onLike}
      >
        <Heart
          size={25}
          fill={post.engagement.viewerLiked ? 'currentColor' : 'none'}
        />
      </button>
      <span className="likes-count">
        {post.engagement.likes.toLocaleString()}
        <span className="sr-only"> likes</span>
      </span>
      <button
        className="icon-button"
        aria-label={`Share ${media?.kind === 'video' ? 'video' : 'photo'} from ${post.title}`}
        disabled={!shareUrl || sharing}
        onClick={() => void shareMedia()}
      >
        <Send size={23} />
      </button>
      <button
        className={`icon-button save-button ${saved ? 'is-saved' : ''}`}
        aria-pressed={saved}
        aria-label={`${saved ? 'Unsave' : 'Save'} ${post.title} on this device`}
        onClick={onSave}
      >
        <Bookmark size={24} fill={saved ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}

export function PostCard({
  post,
  index,
  preferVideo,
  saved,
  liking,
  onLike,
  onSave,
  onNotice,
  onOpen,
  onStore,
  demo,
}: ActionProps & {
  index: number;
  preferVideo: boolean;
  onOpen: (index: number) => void;
  onStore: (store: Store) => void;
  demo: boolean;
}) {
  const [mediaIndex, setMediaIndex] = useState(() =>
    preferVideo
      ? Math.max(
          0,
          post.media.findIndex((item) => item.kind === 'video'),
        )
      : 0,
  );
  const [playing, setPlaying] = useState(false);
  const media = post.media[mediaIndex];
  function changeMedia(next: number) {
    setPlaying(false);
    setMediaIndex(next);
  }
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
        <button
          className="icon-button post-expand"
          aria-label={`Open details for ${post.title}`}
          onClick={() => onOpen(mediaIndex)}
        >
          <Expand size={18} />
        </button>
      </header>
      <div className="post-media">
        {media?.kind === 'video' && playing ? (
          <div className="inline-player">
            <MediaView
              key={media.id}
              media={media}
              title={post.title}
              playing
            />
          </div>
        ) : (
          <button
            className="post-image"
            onClick={() =>
              media?.kind === 'video' ? setPlaying(true) : onOpen(mediaIndex)
            }
            aria-label={`${media?.kind === 'video' ? 'Play' : 'Open'} ${post.title}`}
          >
            <MediaView
              key={media?.id}
              media={media}
              title={post.title}
              eager={index === 0}
            />
            {media?.kind === 'video' && (
              <span className="play-badge">
                <Play fill="currentColor" size={25} />
              </span>
            )}
          </button>
        )}
        {post.media.length > 1 && (
          <>
            <span className="media-count">
              <Layers size={14} />
              {mediaIndex + 1}/{post.media.length}
            </span>
            <button
              className="icon-button media-previous"
              aria-label="Previous photo or video"
              disabled={mediaIndex === 0}
              onClick={() => changeMedia(mediaIndex - 1)}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className="icon-button media-next"
              aria-label="Next photo or video"
              disabled={mediaIndex === post.media.length - 1}
              onClick={() => changeMedia(mediaIndex + 1)}
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>
      <div className="post-body">
        <PostActions
          post={post}
          media={media}
          saved={saved}
          liking={liking}
          onLike={onLike}
          onSave={onSave}
          onNotice={onNotice}
        />
        <button className="post-title" onClick={() => onOpen(mediaIndex)}>
          {post.title}
        </button>
        <p>{post.description}</p>
        {!demo && (
          <span className="post-meta">
            <Eye size={13} />
            {post.engagement.views.toLocaleString()} views
          </span>
        )}
      </div>
    </article>
  );
}

export function PostDialog({
  post,
  initialIndex,
  notice,
  saved,
  liking,
  onLike,
  onSave,
  onNotice,
  demo,
  onClose,
}: ActionProps & {
  initialIndex: number;
  notice: string;
  demo: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(initialIndex);
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
          <PostActions
            post={post}
            media={media}
            saved={saved}
            liking={liking}
            onLike={onLike}
            onSave={onSave}
            onNotice={onNotice}
          />
          {notice && (
            <p className="dialog-notice" role="status">
              {notice}
            </p>
          )}
          {demo && <span className="sample-label">Sample post</span>}
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
