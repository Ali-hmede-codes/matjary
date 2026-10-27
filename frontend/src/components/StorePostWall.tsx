import { Layers, Play } from 'lucide-react';
import type { Post } from '../lib/api';
import type { PostLayout } from '../lib/design.ts';
import { MediaView } from './MediaView';

/**
 * The shop's post wall. The owner picks the presentation in the design studio;
 * every layout renders the same tiles so the viewer, keyboard order and
 * analytics stay identical no matter how the wall looks.
 */
export function StorePostWall({
  posts,
  layout,
  onOpen,
}: {
  posts: Post[];
  layout: PostLayout;
  onOpen: (post: Post) => void;
}) {
  return (
    <div className={`shop-post-grid shop-post-wall layout-${layout}`}>
      {posts.map((post) => {
        const indicators = (
          <>
            {post.media.some((media) => media.kind === 'video') && (
              <Play size={19} fill="currentColor" />
            )}
            {post.media.length > 1 && <Layers size={19} />}
          </>
        );
        // The list layout is the only one that shows the post title, so a shop
        // can use its wall as a news feed as well as a gallery.
        if (layout === 'list')
          return (
            <button
              className="shop-post-tile shop-post-row"
              key={post.id}
              type="button"
              aria-label={`Open post: ${post.title}`}
              aria-haspopup="dialog"
              onClick={() => onOpen(post)}
            >
              <span className="shop-post-row-thumb">
                <span className="shop-post-thumbnail" aria-hidden="true">
                  <MediaView media={post.media[0]} title={post.title} />
                </span>
                <span className="shop-post-indicators" aria-hidden="true">
                  {indicators}
                </span>
              </span>
              <span className="shop-post-row-copy">
                <strong>{post.title}</strong>
                <small>
                  {post.media.length}{' '}
                  {post.media.length === 1
                    ? 'photo or video'
                    : 'photos & videos'}
                </small>
              </span>
            </button>
          );
        return (
          <button
            className="shop-post-tile"
            key={post.id}
            type="button"
            aria-label={`Open post: ${post.title}`}
            aria-haspopup="dialog"
            onClick={() => onOpen(post)}
          >
            <span className="shop-post-thumbnail" aria-hidden="true">
              <MediaView media={post.media[0]} title={post.title} />
            </span>
            <span className="shop-post-indicators" aria-hidden="true">
              {indicators}
            </span>
          </button>
        );
      })}
    </div>
  );
}
