import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  LayoutGrid,
  ShoppingBag,
} from 'lucide-react';
import { storePath } from '../lib/storefront';
import { AutoplayVideo } from './AutoplayVideo';
import { MediaView } from './MediaView';
import { PostActions, type PostActionProps } from './PostActions';
import { StoreAvatar, StoreVerifiedBadge } from './StoreAvatar';

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
  const media = post.media[mediaIndex];
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
          <StoreAvatar store={post.store} expandable />
          <span>
            <strong className="post-store-name">
              {post.store?.name || 'Independent creator'}
              <StoreVerifiedBadge store={post.store} size={15} />
            </strong>
            <small>
              {demo
                ? 'Sample showcase'
                : [
                    post.store?.businessCategoryLabel,
                    post.store?.location?.city,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Independent store'}
            </small>
          </span>
        </a>
        {demo && <span className="sample-label">SAMPLE</span>}
      </header>
      <div className="post-media">
        {media?.kind === 'video' ? (
          <div className="post-video">
            {/* A first tap opens the full-screen viewer; pausing happens there. */}
            <AutoplayVideo
              key={media.id}
              media={media}
              title={post.title}
              onOpen={() => onOpen(mediaIndex)}
            />
          </div>
        ) : (
          <button
            className="post-image"
            onClick={() => onOpen(mediaIndex)}
            aria-label={`Open ${post.title}`}
          >
            <MediaView
              key={media?.id}
              media={media}
              title={post.title}
              eager={index === 0}
            />
          </button>
        )}
        {/* The card only hints at the link; the viewer carries the tappable
            pill, so the badge never fights the card's own open action. */}
        {post.link && (
          <span className="post-link-badge" title={post.link.name}>
            {post.link.type === 'product' ? (
              <ShoppingBag size={14} aria-hidden="true" />
            ) : (
              <LayoutGrid size={14} aria-hidden="true" />
            )}
            <span>{post.link.name}</span>
          </span>
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
              onClick={() => setMediaIndex(mediaIndex - 1)}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className="icon-button media-next"
              aria-label="Next photo or video"
              disabled={mediaIndex === post.media.length - 1}
              onClick={() => setMediaIndex(mediaIndex + 1)}
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>
      <div className="post-body">
        <PostActions
          post={post}
          saved={saved}
          liking={liking}
          onLike={onLike}
          onSave={onSave}
          onNotice={onNotice}
          demo={demo}
        />
        <p className="post-caption">
          <a
            className="post-caption-author"
            href={post.store ? storePath(post.store.slug, demo) : undefined}
          >
            {post.store?.name || 'Independent creator'}
          </a>{' '}
          {post.description || post.title}
        </p>
      </div>
    </article>
  );
}
