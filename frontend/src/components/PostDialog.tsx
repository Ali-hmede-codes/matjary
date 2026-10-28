import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  ShoppingBag,
  X,
} from 'lucide-react';
import { AutoplayVideo } from './AutoplayVideo';
import { MediaView } from './MediaView';
import {
  categorySlug,
  formatProductPrice,
  storeCategoryPath,
  storePath,
  storeProductPath,
} from '../lib/storefront';
import type { Post } from '../lib/api';
import { resumeFeedPlayback, suspendFeedPlayback } from '../lib/video-playback';
import { PostActions } from './PostActions';
import { StoreAvatar } from './StoreAvatar';

export type PostDialogEngagement = {
  saved: string[];
  liking: boolean;
  onLike: (post: Post) => void;
  onSave: (postId: string) => void;
  onNotice: (message: string) => void;
};

type PostDialogProps = PostDialogEngagement & {
  /** Posts to page through: the whole shop on a shop page, the feed elsewhere. */
  posts: Post[];
  initialPostId: string;
  initialMediaIndex?: number;
  notice?: string;
  demo: boolean;
  onClose: () => void;
  /** Fired for every post that becomes the visible one, so views stay honest. */
  onActivePost?: (post: Post) => void;
  /** Called as the viewer approaches the last loaded post, to append a page. */
  onNearEnd?: () => void;
};

// Phones page vertically (one post per screen, swiped like a reel). Pointer
// layouts page horizontally with the chevrons, arrow keys and the wheel.
const POINTER_QUERY = '(min-width: 900px)';

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

function PostSlide({
  post,
  index,
  total,
  active,
  initialMediaIndex,
  demo,
  notice,
  saved,
  liking,
  onLike,
  onSave,
  onNotice,
}: {
  post: Post;
  index: number;
  total: number;
  active: boolean;
  initialMediaIndex: number;
  demo: boolean;
  notice?: string;
  saved: boolean;
  liking: boolean;
  onLike: () => void;
  onSave: () => void;
  onNotice: (message: string) => void;
}) {
  const [mediaIndex, setMediaIndex] = useState(() =>
    Math.max(0, Math.min(post.media.length - 1, initialMediaIndex)),
  );
  const media = post.media[mediaIndex];
  const multiple = post.media.length > 1;
  const storeName = post.store?.name || 'Independent creator';
  const location = demo
    ? 'Sample showcase'
    : post.store?.location?.city || 'Independent store';
  const published = sharedDate(post.publishedAt);
  // Off-screen posts must not take tab focus or be read out; swiping still
  // works because the track itself handles the gesture.
  return (
    <section
      className="reel-slide"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${total}: ${post.title}`}
      inert={!active}
    >
      <div className="reel-stage">
        {media?.kind === 'video' ? (
          <AutoplayVideo
            key={media.id}
            media={media}
            title={post.title}
            eager
            active={active}
            fit="contain"
          />
        ) : (
          // Off-screen slides wait for the scroll instead of loading every
          // photo in the queue up front.
          <MediaView
            key={media?.id}
            media={media}
            title={post.title}
            eager={active}
          />
        )}
        <header className="reel-head">
          <a
            className="reel-store"
            href={post.store ? storePath(post.store.slug, demo) : undefined}
          >
            <StoreAvatar store={post.store} preview={media} expandable />
            <span>
              <strong>{storeName}</strong>
              <small>{location}</small>
            </span>
          </a>
        </header>
        <div className="reel-bottom">
          <div className="reel-copy">
            {multiple && (
              <div className="reel-pager">
                <button
                  type="button"
                  disabled={mediaIndex === 0}
                  onClick={() => setMediaIndex(mediaIndex - 1)}
                  aria-label="Previous photo or video"
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <span aria-live="polite">
                  {mediaIndex + 1} / {post.media.length}
                </span>
                <button
                  type="button"
                  disabled={mediaIndex === post.media.length - 1}
                  onClick={() => setMediaIndex(mediaIndex + 1)}
                  aria-label="Next photo or video"
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            )}
            {/* A shoppable post carries one link: a product or a section. It
                stays a small pill so the photo keeps the stage. */}
            {post.link && post.store && (
              <a
                className="reel-product"
                href={
                  post.link.type === 'product' && post.link.slug
                    ? storeProductPath(post.store.slug, post.link.slug, demo)
                    : storeCategoryPath(
                        post.store.slug,
                        categorySlug(post.link.name),
                        demo,
                      )
                }
              >
                {post.link.type === 'product' ? (
                  <ShoppingBag size={15} aria-hidden="true" />
                ) : (
                  <LayoutGrid size={15} aria-hidden="true" />
                )}
                <span className="reel-product-copy">
                  <strong>{post.link.name}</strong>
                  {post.link.type === 'product' &&
                    post.link.priceCents &&
                    post.link.currency && (
                      <small>
                        {formatProductPrice(
                          post.link.priceCents,
                          post.link.currency,
                        )}
                      </small>
                    )}
                </span>
                <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            )}
            <p className="reel-caption">
              <a
                className="reel-caption-author"
                href={post.store ? storePath(post.store.slug, demo) : undefined}
              >
                {storeName}
              </a>{' '}
              {post.description || post.title}
            </p>
            {published && <p className="reel-date">Shared {published}</p>}
            {notice && active && (
              <p className="reel-notice" role="status">
                {notice}
              </p>
            )}
          </div>
          <aside className="reel-rail" aria-label={`Actions for ${post.title}`}>
            <PostActions
              post={post}
              saved={saved}
              liking={liking}
              onLike={onLike}
              onSave={onSave}
              onNotice={onNotice}
              demo={demo}
            />
            {post.store && (
              <a
                className="reel-visit"
                href={storePath(post.store.slug, demo)}
                aria-label={`Visit ${storeName}`}
              >
                <ArrowUpRight size={19} aria-hidden="true" />
                <span>Visit</span>
              </a>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}

export function PostDialog({
  posts,
  initialPostId,
  initialMediaIndex = 0,
  notice,
  demo,
  saved,
  liking,
  onLike,
  onSave,
  onNotice,
  onClose,
  onActivePost,
  onNearEnd,
}: PostDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const wheelLock = useRef(0);
  const [startIndex] = useState(() =>
    Math.max(
      0,
      posts.findIndex((post) => post.id === initialPostId),
    ),
  );
  const [active, setActive] = useState(startIndex);
  const activeRef = useRef(active);
  activeRef.current = active;
  const activePost = posts[active];
  const activePostId = activePost?.id;
  const latestPosts = useRef(posts);
  latestPosts.current = posts;
  const activePostHandler = useRef(onActivePost);
  activePostHandler.current = onActivePost;
  const nearEndHandler = useRef(onNearEnd);
  nearEndHandler.current = onNearEnd;

  const go = useCallback(
    (next: number) => {
      const node = track.current;
      if (!node) return;
      const index = Math.max(0, Math.min(posts.length - 1, next));
      const slide = node.children[index];
      if (!(slide instanceof HTMLElement)) return;
      setActive(index);
      node.scrollTo({
        top: slide.offsetTop,
        left: slide.offsetLeft,
        behavior: 'smooth',
      });
    },
    [posts.length],
  );

  // Layout effect so the dialog enters the top layer before the autoplaying
  // slide under it runs play() on its first passive effect.
  useLayoutEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    // React's autoFocus runs before the dialog enters the top layer, so move
    // focus onto the close control once the modal is actually open.
    element
      ?.querySelector<HTMLElement>('.reel-close')
      ?.focus({ preventScroll: true });
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
    };
  }, []);

  // Opening a post should start on that post, not on the first slide, and the
  // jump must happen before paint so no other post flashes first.
  useLayoutEffect(() => {
    const node = track.current;
    const slide = node?.children[startIndex];
    if (!node || !(slide instanceof HTMLElement)) return;
    node.scrollTo({
      top: slide.offsetTop,
      left: slide.offsetLeft,
      behavior: 'auto',
    });
  }, [startIndex]);

  // The feed keeps rendering behind the modal; stop its autoplaying clips so
  // only the post being read keeps moving.
  useEffect(() => {
    suspendFeedPlayback();
    return () => resumeFeedPlayback();
  }, []);

  // Whichever slide owns most of the viewport is the post being viewed.
  useEffect(() => {
    const node = track.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const slides = Array.from(node.children);
    if (!slides.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio < 0.6) continue;
          const index = slides.indexOf(entry.target);
          if (index >= 0) setActive(index);
        }
      },
      { root: node, threshold: [0.6] },
    );
    for (const slide of slides) observer.observe(slide);
    return () => observer.disconnect();
  }, [posts.length]);

  useEffect(() => {
    if (!activePostId) return;
    const post = latestPosts.current.find((item) => item.id === activePostId);
    if (post) activePostHandler.current?.(post);
  }, [activePostId]);

  // Reels keep going: append the next page before the shopper reaches the end
  // instead of stopping on the last loaded post.
  useEffect(() => {
    if (active < posts.length - 2) return;
    nearEndHandler.current?.();
  }, [active, posts.length]);

  // A vertical wheel has nothing to scroll in the horizontal pager, so turn it
  // into a page step. Trackpads that already scroll sideways keep their axis.
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!window.matchMedia(POINTER_QUERY).matches) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      const now = Date.now();
      if (now - wheelLock.current < 420) return;
      wheelLock.current = now;
      go(activeRef.current + (event.deltaY > 0 ? 1 : -1));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [go]);

  return (
    <dialog
      ref={dialog}
      className="post-dialog"
      aria-label="Post viewer"
      onCancel={onClose}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
          go(active - 1);
        else if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
          go(active + 1);
        else return;
        event.preventDefault();
      }}
    >
      <div className="reel-track" ref={track} tabIndex={-1}>
        {posts.map((post, index) => (
          <PostSlide
            key={post.id}
            post={post}
            index={index}
            total={posts.length}
            active={index === active}
            initialMediaIndex={index === startIndex ? initialMediaIndex : 0}
            demo={demo}
            notice={notice}
            saved={saved.includes(post.id)}
            liking={liking}
            onLike={() => onLike(post)}
            onSave={() => onSave(post.id)}
            onNotice={onNotice}
          />
        ))}
      </div>
      <div className="reel-chrome">
        <button
          type="button"
          className="reel-chrome-button reel-close"
          onClick={onClose}
          aria-label="Close posts"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        className="reel-nav reel-prev"
        onClick={() => go(active - 1)}
        disabled={active === 0}
        aria-label="Previous post"
      >
        <ChevronLeft size={22} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="reel-nav reel-next"
        onClick={() => go(active + 1)}
        disabled={active === posts.length - 1}
        aria-label="Next post"
      >
        <ChevronRight size={22} aria-hidden="true" />
      </button>
    </dialog>
  );
}
