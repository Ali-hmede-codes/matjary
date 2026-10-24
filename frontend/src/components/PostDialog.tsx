import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { MediaView } from './MediaView';
import { storePath } from '../lib/storefront';
import type { Post } from '../lib/api';
import { PostActions, type PostActionProps } from './PostActions';

type PostDialogProps = {
  initialIndex: number;
  notice?: string;
  demo: boolean;
  onClose: () => void;
} & ((PostActionProps & { viewOnly?: false }) | { post: Post; viewOnly: true });

export function PostDialog(props: PostDialogProps) {
  const { post, initialIndex, notice, demo, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(initialIndex);
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
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
            <span role="status">
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
          {!props.viewOnly && <PostActions {...props} media={media} />}
          {notice && (
            <p className="dialog-notice" role="status">
              {notice}
            </p>
          )}
          {demo && <span className="sample-label">Sample post</span>}
          <a
            className="eyebrow"
            href={post.store ? storePath(post.store.slug, demo) : undefined}
          >
            {post.store?.name || 'Independent creator'}
          </a>
          <h2 id="detail-title">{post.title}</h2>
          <p>{post.description}</p>
        </div>
      </div>
    </dialog>
  );
}
