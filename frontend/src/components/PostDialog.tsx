import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { MediaView } from './MediaView';
import { PostActions, type PostActionProps } from './PostActions';

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
}: PostActionProps & {
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
