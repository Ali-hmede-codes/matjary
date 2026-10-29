import { Layers, Pause, Play } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { assetUrl, type Post, type Story } from '../lib/api';
import type { PostLayout } from '../lib/design.ts';
import { storyTimeLabel } from '../lib/stories';
import { enableMouseScrolling } from '../lib/website';
import { MediaView } from './MediaView';

// The 4:3 walls reveal their tiles in a short cascade. The other layouts keep
// their instant paint so an archive never feels like it is still loading.
const motionLayouts: readonly PostLayout[] = ['tiles', 'reel', 'stagger'];

/**
 * A strip that keeps moving has to be stoppable. Visitors who ask for less
 * motion get the same 4:3 photos as a still grid instead of a looping ribbon.
 */
function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

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
  const reducedMotion = useReducedMotion();
  // Drift is motion by definition; reduced-motion visitors get the still
  // 4:3 wall, which already hides its reveal cascade for them.
  const effectiveLayout: PostLayout =
    layout === 'drift' && reducedMotion ? 'tiles' : layout;
  const motion = motionLayouts.includes(effectiveLayout);
  const reel = effectiveLayout === 'reel';
  // A capped stagger keeps a long archive from rippling for seconds, and CSS
  // drops the animation entirely under prefers-reduced-motion.
  const revealDelay = (index: number): CSSProperties | undefined =>
    motion
      ? ({ '--post-delay': `${Math.min(index, 11) * 35}ms` } as CSSProperties)
      : undefined;
  if (effectiveLayout === 'drift')
    return (
      <DriftWall
        posts={posts}
        story={story}
        storySeen={storySeen}
        onOpen={onOpen}
        onOpenStory={onOpenStory}
      />
    );
  return (
    <div
      className={`shop-post-grid shop-post-wall layout-${effectiveLayout}`}
      ref={reel ? enableMouseScrolling : undefined}
      tabIndex={reel ? 0 : undefined}
    >
      {story && onOpenStory && (
        <StoryTile
          story={story}
          seen={storySeen}
          list={layout === 'list'}
          onOpen={onOpenStory}
        />
      )}
      {posts.map((post, index) => {
        // The list layout is the only one that shows the post title, so a shop
        // can use its wall as a news feed as well as a gallery.
        if (layout === 'list') {
          const indicators = (
            <>
              {post.media.some((media) => media.kind === 'video') && (
                <Play size={19} fill="currentColor" />
              )}
              {post.media.length > 1 && <Layers size={19} />}
            </>
          );
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
                <strong className="notranslate">{post.title}</strong>
                <small>
                  {post.media.length}{' '}
                  {post.media.length === 1
                    ? 'photo or video'
                    : 'photos & videos'}
                </small>
              </span>
            </button>
          );
        }
        return (
          <button
            className="shop-post-tile"
            key={post.id}
            type="button"
            style={revealDelay(index)}
            aria-label={`Open post: ${post.title}`}
            aria-haspopup="dialog"
            onClick={() => onOpen(post)}
          >
            <PostTileMedia post={post} />
          </button>
        );
      })}
    </div>
  );
}

/** One tile's photo and corner marks, shared by the wall and the drift strip. */
function PostTileMedia({ post }: { post: Post }) {
  return (
    <>
      <span className="shop-post-thumbnail" aria-hidden="true">
        <MediaView media={post.media[0]} title={post.title} />
      </span>
      <span className="shop-post-indicators" aria-hidden="true">
        {post.media.some((media) => media.kind === 'video') && (
          <Play size={19} fill="currentColor" />
        )}
        {post.media.length > 1 && <Layers size={19} />}
      </span>
    </>
  );
}

/**
 * Drift is a 4:3 window that keeps moving. The strip repeats its set enough
 * times to fill the column, so the loop has no seam; every repeat after the
 * first is decorative. Motion pauses on hover, on keyboard focus and on the
 * strip's own pause button.
 */
function DriftWall({
  posts,
  story,
  storySeen,
  onOpen,
  onOpenStory,
}: {
  posts: Post[];
  story?: Story;
  storySeen: boolean;
  onOpen: (post: Post) => void;
  onOpenStory?: () => void;
}) {
  const [stopped, setStopped] = useState(false);
  const total = posts.length + (story && onOpenStory ? 1 : 0);
  if (!total) return null;
  // The track must always keep one full set beyond the visible column, or the
  // loop would expose a gap at its seam. Short walls repeat their tiles.
  const copies = total === 1 ? 5 : total <= 3 ? 3 : 2;
  // A longer archive drifts for longer instead of faster, so the pace stays
  // readable whether the shop has four posts or forty.
  const duration = Math.min(96, Math.max(24, total * 8));
  const shift = `${100 / copies}%`;
  const renderSet = (clone: boolean) => (
    <>
      {story && onOpenStory && (
        <StoryTile
          story={story}
          seen={storySeen}
          list={false}
          onOpen={onOpenStory}
          decorative={clone}
        />
      )}
      {posts.map((post) =>
        clone ? (
          <span
            className="shop-post-tile"
            key={`drift-${post.id}`}
            aria-hidden="true"
            onClick={() => onOpen(post)}
          >
            <PostTileMedia post={post} />
          </span>
        ) : (
          <button
            className="shop-post-tile"
            key={post.id}
            type="button"
            aria-label={`Open post: ${post.title}`}
            aria-haspopup="dialog"
            onClick={() => onOpen(post)}
          >
            <PostTileMedia post={post} />
          </button>
        ),
      )}
    </>
  );
  return (
    <div
      className={`shop-post-wall layout-drift${stopped ? ' is-stopped' : ''}`}
    >
      <div className="shop-post-drift">
        <div
          className="shop-post-drift-track"
          style={
            {
              '--drift-duration': `${duration}s`,
              '--drift-shift': shift,
            } as CSSProperties
          }
        >
          {Array.from({ length: copies }, (_, copy) =>
            copy === 0 ? (
              <div className="shop-post-drift-set" key={copy}>
                {renderSet(false)}
              </div>
            ) : (
              <div
                className="shop-post-drift-set is-clone"
                key={copy}
                aria-hidden="true"
              >
                {renderSet(true)}
              </div>
            ),
          )}
        </div>
      </div>
      <button
        type="button"
        className="shop-post-drift-toggle shop-glass"
        aria-label={
          stopped ? 'Resume the drifting posts' : 'Pause the drifting posts'
        }
        onClick={() => setStopped((current) => !current)}
      >
        {stopped ? (
          <Play size={14} aria-hidden="true" />
        ) : (
          <Pause size={14} aria-hidden="true" />
        )}
        {stopped ? 'Play' : 'Pause'}
      </button>
    </div>
  );
}

function StoryTile({
  story,
  seen,
  list,
  onOpen,
  decorative = false,
}: {
  story: Story;
  seen: boolean;
  list: boolean;
  onOpen: () => void;
  decorative?: boolean;
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
  const frame = (
    <>
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
    </>
  );
  return (
    <>
      {decorative ? (
        // The drift strip's second copy keeps the loop seamless; it repeats the
        // same tile for the eye only, so assistive tech never announces it.
        <span
          className={`shop-post-tile shop-story-tile ${ringClass}`}
          aria-hidden="true"
          onClick={onOpen}
        >
          {frame}
        </span>
      ) : (
        <button
          type="button"
          className={`shop-post-tile shop-story-tile ${ringClass}`}
          aria-label="Watch the shop's story"
          aria-haspopup="dialog"
          onClick={onOpen}
        >
          {frame}
        </button>
      )}
    </>
  );
}
