import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { AutoplayVideo } from './AutoplayVideo';
import { MediaView } from './MediaView';
import { storePath } from '../lib/storefront';
import type { Post } from '../lib/api';
import { resumeFeedPlayback, suspendFeedPlayback } from '../lib/video-playback';
import { PostActions, type PostActionProps } from './PostActions';
import { StoreAvatar } from './StoreAvatar';

type PostDialogProps = {
  initialIndex: number;
  notice?: string;
  demo: boolean;
  onClose: () => void;
} & ((PostActionProps & { viewOnly?: false }) | { post: Post; viewOnly: true });

function sharedDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function PostDialog(props: PostDialogProps) {
  const { post, initialIndex, notice, demo, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(initialIndex);
  // Layout effect so the dialog enters the top layer before the autoplaying
  // video under it runs play() on its first passive effect.
  useLayoutEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    // React's autoFocus runs before the dialog enters the top layer, so move
    // focus onto the close control once the modal is actually open.
    element
      ?.querySelector<HTMLElement>('.post-viewer-close')
      ?.focus({ preventScroll: true });
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
    };
  }, []);
  // The feed keeps rendering behind the modal; stop its autoplaying clips so
  // only the media being read keeps moving (and keeps its sound).
  useEffect(() => {
    suspendFeedPlayback();
    return () => resumeFeedPlayback();
  }, []);
  const media = post.media[index];
  const multiple = post.media.length > 1;
  const storeName = post.store?.name || 'Independent creator';
  const location = demo
    ? 'Sample showcase'
    : post.store?.location?.city || 'Independent store';
  const published = sharedDate(post.publishedAt);
  function step(next: number) {
    setIndex(Math.max(0, Math.min(post.media.length - 1, next)));
  }
  return (
    <dialog
      ref={dialog}
      className="post-dialog"
      aria-labelledby="detail-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') step(index - 1);
        else if (event.key === 'ArrowRight') step(index + 1);
        else return;
        event.preventDefault();
      }}
    >
      <div className="post-viewer">
        <section className="post-viewer-media" aria-label="Post media">
          <div className="post-viewer-stage">
            {media?.kind === 'video' ? (
              <AutoplayVideo
                key={media.id}
                media={media}
                title={post.title}
                eager
                fit="contain"
              />
            ) : (
              <MediaView key={media?.id} media={media} title={post.title} />
            )}
          </div>
          <div className="post-viewer-top">
            {multiple && (
              <span className="post-viewer-badge">
                {index + 1} / {post.media.length}
              </span>
            )}
            {demo && (
              <span className="post-viewer-badge post-viewer-sample">
                Sample post
              </span>
            )}
          </div>
          {multiple && (
            <>
              <button
                className="post-viewer-nav post-viewer-previous"
                disabled={index === 0}
                onClick={() => step(index - 1)}
                aria-label="Previous media"
              >
                <ChevronLeft size={21} />
              </button>
              <button
                className="post-viewer-nav post-viewer-next"
                disabled={index === post.media.length - 1}
                onClick={() => step(index + 1)}
                aria-label="Next media"
              >
                <ChevronRight size={21} />
              </button>
              <span className="post-viewer-dots" aria-hidden="true">
                {post.media.map((item, itemIndex) => (
                  <i
                    key={item.id}
                    className={itemIndex === index ? 'is-active' : ''}
                  />
                ))}
              </span>
            </>
          )}
        </section>
        <aside className="post-viewer-side">
          <header className="post-viewer-head">
            <a
              className="store-identity"
              href={post.store ? storePath(post.store.slug, demo) : undefined}
            >
              <StoreAvatar store={post.store} preview={media} />
              <span>
                <strong>{storeName}</strong>
                <small>{location}</small>
              </span>
            </a>
            <button
              className="icon-button post-viewer-close"
              onClick={onClose}
              aria-label="Close post"
            >
              <X size={20} />
            </button>
          </header>
          <div className="post-viewer-copy">
            <h2 id="detail-title">{post.title}</h2>
            {post.description && (
              <p className="post-viewer-description">{post.description}</p>
            )}
            {published && (
              <p className="post-viewer-date">Shared {published}</p>
            )}
            {notice && (
              <p className="dialog-notice" role="status">
                {notice}
              </p>
            )}
          </div>
          <footer className="post-viewer-foot">
            {!props.viewOnly && (
              <PostActions {...props} media={media} showCount={false} />
            )}
            {post.store && (
              <a
                className="post-viewer-store"
                href={storePath(post.store.slug, demo)}
              >
                Visit {storeName}
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            )}
          </footer>
        </aside>
      </div>
    </dialog>
  );
}
