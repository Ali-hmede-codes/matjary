import { Layers, Play } from 'lucide-react';
import { assetUrl, type Post, type Story } from '../lib/api';
import type { PostLayout } from '../lib/design.ts';
import { storyTimeLabel } from '../lib/stories';
import { MediaView } from './MediaView';

/**
 * The shop's post wall. The owner picks the presentation in the design studio;
 * every layout renders the same tiles so the viewer, keyboard order and
 * analytics stay identical no matter how the wall looks. A live story leads
 * the wall, so scrolling the profile feed still surfaces today's story.
 */
export function StorePostWall({
  posts,
  layout,
  story,
  storySeen = false,
  onOpen,
  onOpenStory,
}: {
  posts: Post[];
  layout: PostLayout;
  story?: Story;
  storySeen?: boolean;
  onOpen: (post: Post) => void;
  onOpenStory?: () => void;
}) {
  return (
    <div className={`shop-post-grid shop-post-wall layout-${layout}`}>
      {story && onOpenStory && (
        <StoryTile
          story={story}
          seen={storySeen}
          list={layout === 'list'}
          onOpen={onOpenStory}
        />
      )}
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

function StoryTile({
  story,
  seen,
  list,
  onOpen,
}: {
  story: Story;
  seen: boolean;
  list: boolean;
  onOpen: () => void;
}) {
  // Videos preview through their generated poster, exactly like feed cards.
  const preview = assetUrl(
    story.media.kind === 'video'
      ? story.media.posterUrl
      : story.media.primaryUrl,
  );
  const ringClass = seen ? 'is-seen' : 'is-unseen';
  if (list)
    return (
      <button
        type="button"
        className={`shop-post-tile shop-post-row shop-story-tile ${ringClass}`}
        aria-label="Watch the shop's story"
        aria-haspopup="dialog"
        onClick={onOpen}
      >
        <span className="shop-post-row-thumb shop-story-row-thumb">
          {preview && <img src={preview} alt="" loading="lazy" />}
        </span>
        <span className="shop-post-row-copy">
          <strong>Story</strong>
          <small>
            {storyTimeLabel(story.createdAt)} · Tap to watch what the shop
            shared today
          </small>
        </span>
      </button>
    );
  return (
    <button
      type="button"
      className={`shop-post-tile shop-story-tile ${ringClass}`}
      aria-label="Watch the shop's story"
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      <span className="shop-post-thumbnail" aria-hidden="true">
        {preview ? (
          <img src={preview} alt="" loading="lazy" />
        ) : (
          <span className="shop-story-tile-fallback">Story</span>
        )}
      </span>
      <span className="shop-story-tile-shade" aria-hidden="true" />
      <span className="shop-story-tile-copy">
        <span>Story</span>
        <small>{storyTimeLabel(story.createdAt)}</small>
      </span>
    </button>
  );
}
