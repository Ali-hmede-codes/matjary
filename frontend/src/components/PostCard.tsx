import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Expand,
  Layers,
  Play,
} from 'lucide-react';
import { storePath } from '../lib/storefront';
import { MediaView } from './MediaView';
import { PostActions, type PostActionProps } from './PostActions';
import { StoreAvatar } from './StoreAvatar';

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
  demo,
}: PostActionProps & {
  index: number;
  preferVideo: boolean;
  onOpen: (index: number) => void;
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
        <a
          className="store-identity"
          href={post.store ? storePath(post.store.slug, demo) : undefined}
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
        </a>
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
