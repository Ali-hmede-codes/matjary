import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ChevronDown,
  LayoutGrid,
  LoaderCircle,
  Play,
  ShoppingBag,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { assetUrl, type Story, type StoryGroup } from '../../lib/api';
import {
  formatProductPrice,
  linkCompareAtPriceCents,
  storePath,
} from '../../lib/storefront';
import {
  STORY_MAX_VIDEO_MS,
  storyDisplayMs,
  storyLinkPath,
  storyTimeLabel,
} from '../../lib/stories';
import { StoreAvatar, StoreVerifiedBadge } from '../StoreAvatar';

// A hold longer than this is a pause, not a tap on the story.
const HOLD_MS = 250;
const PROGRESS_TICK_MS = 50;
// A downward drag past this distance closes the reel, and the ring that
// follows the finger is full at exactly this point.
const SWIPE_CLOSE_PX = 140;
const SWIPE_RING_RADIUS = 21;
const SWIPE_RING_LENGTH = 2 * Math.PI * SWIPE_RING_RADIUS;
// How far the reel travels while closing; the CSS keyframes handle the rest.
const CLOSE_ANIMATION_MS = 240;

export function StoryViewer({
  groups,
  initialStoreId,
  initialStoryId,
  canManage = false,
  onSeen,
  onDelete,
  onClose,
}: {
  groups: StoryGroup[];
  initialStoreId: string;
  initialStoryId?: string;
  canManage?: boolean;
  onSeen: (ids: string[]) => void;
  onDelete?: (story: Story) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState(0);
  // A story starts only after its media is actually on screen, like Instagram:
  // tracking the id avoids a stale "ready" flag flashing on the next story.
  const [readyStoryId, setReadyStoryId] = useState<string>();
  const [buffering, setBuffering] = useState(false);
  // Elapsed time survives a hold so the bar resumes where it stopped.
  const elapsed = useRef(0);
  const holdStart = useRef(0);
  const suppressTap = useRef(false);
  // Pulling down closes the reel like Instagram: the card follows the finger,
  // a ring at the top fills as it travels, and letting go past the threshold
  // drops it away. The ref mirrors the state so the release reads the latest
  // distance rather than the value of the last render.
  const [pull, setPull] = useState(0);
  const pullRef = useRef(0);
  const [pulling, setPulling] = useState(false);
  const [closing, setClosing] = useState(false);
  const drag = useRef<
    | {
        id: number;
        startX: number;
        startY: number;
        active: boolean;
      }
    | undefined
  >(undefined);
  const closeTimer = useRef(0);

  const queue = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          stories: group.stories.filter((story) => !removed.includes(story.id)),
        }))
        .filter((group) => group.stories.length > 0),
    [groups, removed],
  );
  const [groupIndex, setGroupIndex] = useState(() => {
    const index = queue.findIndex((group) => group.store.id === initialStoreId);
    return index >= 0 ? index : 0;
  });
  const [storyIndex, setStoryIndex] = useState(() => {
    const group = queue.find((item) => item.store.id === initialStoreId);
    if (!group || !initialStoryId) return 0;
    const index = group.stories.findIndex(
      (story) => story.id === initialStoryId,
    );
    return index >= 0 ? index : 0;
  });

  const group = queue[groupIndex];
  const story = group?.stories[storyIndex];
  const isVideo = story?.media.kind === 'video';
  const duration = story ? storyDisplayMs(story) : 0;
  const ready = Boolean(story && readyStoryId === story.id);
  // The next photo warms up while this one is watched, so advancing feels instant.
  const upcoming = group
    ? (group.stories[storyIndex + 1] ?? queue[groupIndex + 1]?.stories[0])
    : undefined;

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const advance = useCallback(
    (direction: 1 | -1) => {
      const nextStory = storyIndex + direction;
      const current = queue[groupIndex];
      if (current && nextStory >= 0 && nextStory < current.stories.length) {
        setStoryIndex(nextStory);
        return;
      }
      const nextGroup = groupIndex + direction;
      if (nextGroup < 0 || nextGroup >= queue.length) {
        // Running past the newest story ends the show, like closing the reel.
        if (direction === 1) onClose();
        return;
      }
      setGroupIndex(nextGroup);
      const stories = queue[nextGroup]?.stories.length ?? 1;
      setStoryIndex(direction === 1 ? 0 : stories - 1);
    },
    [groupIndex, onClose, queue, storyIndex],
  );

  // A deleted or expired story can shorten the queue under the viewer.
  useEffect(() => {
    if (queue.length === 0) {
      onClose();
      return;
    }
    if (groupIndex >= queue.length) {
      setGroupIndex(queue.length - 1);
      setStoryIndex(0);
      return;
    }
    const count = queue[groupIndex]?.stories.length ?? 0;
    if (storyIndex >= count) setStoryIndex(Math.max(0, count - 1));
  }, [groupIndex, onClose, queue, storyIndex]);

  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    element?.focus({ preventScroll: true });
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Each story starts a fresh bar; pausing keeps the elapsed part.
  useEffect(() => {
    elapsed.current = 0;
    setProgress(0);
    setBlocked(false);
    setBuffering(false);
  }, [groupIndex, storyIndex]);

  // A cached image may finish before React attaches onLoad.
  useEffect(() => {
    const element = image.current;
    if (story && !isVideo && element?.complete && element.naturalWidth > 0)
      setReadyStoryId(story.id);
  }, [isVideo, story]);

  useEffect(() => {
    if (!upcoming || upcoming.media.kind !== 'image') return;
    const url = assetUrl(upcoming.media.primaryUrl);
    if (!url) return;
    const preload = new window.Image();
    preload.src = url;
  }, [upcoming]);

  useEffect(() => {
    if (!story) return;
    onSeen([story.id]);
  }, [story, onSeen]);

  // Images advance on a timer; videos advance on `ended`.
  useEffect(() => {
    if (!story || !ready || paused || story.media.kind === 'video') return;
    const started = Date.now() - elapsed.current;
    const timer = window.setInterval(() => {
      elapsed.current = Date.now() - started;
      const ratio = duration > 0 ? Math.min(1, elapsed.current / duration) : 1;
      setProgress(ratio);
      if (elapsed.current >= duration) {
        window.clearInterval(timer);
        advance(1);
      }
    }, PROGRESS_TICK_MS);
    return () => window.clearInterval(timer);
  }, [advance, duration, paused, ready, story]);

  useEffect(() => {
    const element = video.current;
    if (!element || !isVideo) return;
    if (paused) {
      element.pause();
      return;
    }
    // Muted playback is allowed everywhere; sound stays a deliberate choice.
    void element.play().catch(() => setBlocked(true));
  }, [isVideo, paused, groupIndex, storyIndex]);

  if (!story || !group) return null;
  const link = story.link;
  const linkHref = link ? storyLinkPath(link, group.store.slug) : null;
  // A story opens the same item page, so it prints the same sale.
  const linkCompareAt = link
    ? linkCompareAtPriceCents(link.compareAtPriceCents, link.priceCents)
    : null;

  function beginHold() {
    holdStart.current = Date.now();
    suppressTap.current = false;
    setPaused(true);
  }

  function endHold() {
    const held = Date.now() - holdStart.current;
    suppressTap.current = held >= HOLD_MS;
    setPaused(false);
  }

  function tap(direction: 1 | -1) {
    if (suppressTap.current) {
      suppressTap.current = false;
      return;
    }
    advance(direction);
  }

  function beginDrag(event: ReactPointerEvent<HTMLDialogElement>) {
    if (closing) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Links and the tool buttons keep their own gestures; the rest of the
    // stage is one big swipe surface.
    if (
      event.target instanceof Element &&
      event.target.closest(
        '.story-viewer-tools, .story-viewer-shop, .story-viewer-foot',
      )
    )
      return;
    drag.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  }

  function trackDrag(event: ReactPointerEvent<HTMLDialogElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const distanceY = event.clientY - current.startY;
    if (!current.active) {
      // Only a downward pull closes: sideways travel still belongs to the
      // previous/next taps and upward travel is not a story gesture.
      if (
        distanceY <= 8 ||
        distanceY <= Math.abs(event.clientX - current.startX)
      )
        return;
      current.active = true;
      setPulling(true);
      setPaused(true);
      // Capture only once the gesture is certain, so ordinary taps still
      // reach the navigation buttons. A browser that already dropped the
      // pointer rejects the capture; the drag itself must still work.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // No active pointer to capture: the gesture keeps its own tracking.
      }
    }
    // Past the threshold the card slows down, so it stays under the finger
    // instead of running away from it.
    const next =
      distanceY <= SWIPE_CLOSE_PX
        ? distanceY
        : SWIPE_CLOSE_PX + (distanceY - SWIPE_CLOSE_PX) * 0.35;
    pullRef.current = next;
    setPull(next);
  }

  function endDrag(
    event: ReactPointerEvent<HTMLDialogElement>,
    cancelled = false,
  ) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = undefined;
    if (!current.active) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    // The release must never fall through as a tap on the story.
    suppressTap.current = true;
    setPulling(false);
    if (!cancelled && pullRef.current >= SWIPE_CLOSE_PX) {
      closeBySwipe();
      return;
    }
    pullRef.current = 0;
    setPull(0);
    setPaused(false);
  }

  function closeBySwipe() {
    setClosing(true);
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    closeTimer.current = window.setTimeout(
      onClose,
      reduced ? 0 : CLOSE_ANIMATION_MS,
    );
  }

  async function removeStory() {
    if (!story || !onDelete || deleting) return;
    const target = story;
    setDeleting(true);
    try {
      await onDelete(target);
      setRemoved((current) => [...current, target.id]);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="story-viewer"
      aria-label={`${group.store.name} story`}
      tabIndex={-1}
      onCancel={onClose}
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
      onPointerDown={beginDrag}
      onPointerMove={trackDrag}
      onPointerUp={endDrag}
      onPointerCancel={(event) => endDrag(event, true)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          advance(1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          advance(-1);
        }
      }}
    >
      {/* The ring sits in the viewport, not on the card, so it stays at the
          top of the screen while the story travels down with the finger. */}
      <span
        className={`story-pull${pulling || closing ? ' is-visible' : ''}`}
        aria-hidden="true"
      >
        <svg className="story-pull-ring" viewBox="0 0 48 48">
          <circle
            className="story-pull-track"
            cx="24"
            cy="24"
            r={SWIPE_RING_RADIUS}
          />
          <circle
            className="story-pull-fill"
            cx="24"
            cy="24"
            r={SWIPE_RING_RADIUS}
            strokeDasharray={SWIPE_RING_LENGTH}
            strokeDashoffset={
              SWIPE_RING_LENGTH *
              (1 - (closing ? 1 : Math.min(1, pull / SWIPE_CLOSE_PX)))
            }
          />
        </svg>
        <ChevronDown size={17} aria-hidden="true" />
      </span>
      <div
        className={`story-viewer-shell${pulling ? ' is-pulling' : ''}${
          closing ? ' is-closing' : ''
        }`}
        style={
          {
            '--story-pull': `${pull}px`,
            '--story-pull-radius': `${Math.min(26, pull / 5)}px`,
            '--story-pull-scale': String(1 - Math.min(0.14, pull / 1000)),
          } as CSSProperties
        }
      >
        <div className="story-viewer-bars" aria-hidden="true">
          {group.stories.map((item, index) => (
            <span
              key={item.id}
              className={`story-bar ${
                index < storyIndex
                  ? 'is-done'
                  : index === storyIndex
                    ? 'is-active'
                    : ''
              }`}
            >
              <i
                style={{
                  width:
                    index < storyIndex
                      ? '100%'
                      : index === storyIndex
                        ? `${Math.round(progress * 100)}%`
                        : '0%',
                }}
              />
            </span>
          ))}
        </div>
        <header className="story-viewer-head">
          <a
            className="story-viewer-shop"
            href={storePath(group.store.slug)}
            title={`Open ${group.store.name}`}
          >
            <StoreAvatar store={group.store} />
            <span className="story-viewer-name">
              <strong>{group.store.name}</strong>
              <StoreVerifiedBadge store={group.store} size={15} />
            </span>
            <small>{storyTimeLabel(story.createdAt)}</small>
          </a>
          <div className="story-viewer-tools">
            {isVideo && (
              <button
                type="button"
                aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
                aria-pressed={!muted}
                onClick={() => setMuted((value) => !value)}
              >
                {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
            )}
            {canManage && onDelete && (
              <button
                type="button"
                aria-label="Delete this story"
                title="Delete this story"
                disabled={deleting}
                onClick={() => void removeStory()}
              >
                {deleting ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Trash2 size={18} />
                )}
              </button>
            )}
            <button type="button" aria-label="Close stories" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </header>
        <div className="story-viewer-media">
          {isVideo ? (
            <video
              key={story.id}
              ref={video}
              src={assetUrl(story.media.primaryUrl)}
              poster={assetUrl(story.media.posterUrl) ?? undefined}
              muted={muted}
              playsInline
              preload="auto"
              onLoadedData={() => setReadyStoryId(story.id)}
              onPlaying={() => {
                setBuffering(false);
                setReadyStoryId(story.id);
              }}
              onCanPlay={() => setBuffering(false)}
              onWaiting={() => setBuffering(true)}
              onStalled={() => setBuffering(true)}
              onTimeUpdate={(event) => {
                const element = event.currentTarget;
                if (!Number.isFinite(element.duration) || element.duration <= 0)
                  return;
                setProgress(
                  Math.min(
                    1,
                    (element.currentTime * 1000) /
                      Math.min(element.duration * 1000, STORY_MAX_VIDEO_MS),
                  ),
                );
              }}
              onEnded={() => advance(1)}
              onError={() => advance(1)}
            />
          ) : (
            <img
              key={story.id}
              ref={image}
              src={assetUrl(story.media.primaryUrl)}
              alt=""
              draggable={false}
              // The timer starts only once the photo is actually decoded.
              onLoad={() => setReadyStoryId(story.id)}
              onError={() => advance(1)}
            />
          )}
          {(!ready || buffering) && !blocked && (
            <span
              className="story-loading"
              role="status"
              aria-label="Loading story"
            >
              <LoaderCircle className="spin" size={28} aria-hidden="true" />
            </span>
          )}
          {blocked && isVideo && (
            <button
              type="button"
              className="story-play"
              aria-label="Play this story"
              onClick={() => {
                setBlocked(false);
                setPaused(false);
                void video.current?.play().catch(() => setBlocked(true));
              }}
            >
              <Play size={28} fill="currentColor" />
            </button>
          )}
        </div>
        <button
          type="button"
          className="story-nav story-nav-prev"
          aria-label="Previous story"
          onPointerDown={beginHold}
          onPointerUp={endHold}
          onPointerLeave={() => {
            // Leaving the button must not resume a story that is being pulled.
            if (!drag.current?.active) setPaused(false);
          }}
          onPointerCancel={() => {
            if (!drag.current?.active) setPaused(false);
          }}
          onClick={() => tap(-1)}
        />
        <button
          type="button"
          className="story-nav story-nav-next"
          aria-label="Next story"
          onPointerDown={beginHold}
          onPointerUp={endHold}
          onPointerLeave={() => {
            if (!drag.current?.active) setPaused(false);
          }}
          onPointerCancel={() => {
            if (!drag.current?.active) setPaused(false);
          }}
          onClick={() => tap(1)}
        />
        {linkHref && link && (
          <footer className="story-viewer-foot">
            <a className="story-link" href={linkHref}>
              {link.type === 'product' ? (
                <ShoppingBag size={16} aria-hidden="true" />
              ) : (
                <LayoutGrid size={16} aria-hidden="true" />
              )}
              <span>
                <strong>{link.name}</strong>
                {link.type === 'product' &&
                  link.priceCents &&
                  link.currency && (
                    <small>
                      {formatProductPrice(link.priceCents, link.currency)}
                      {linkCompareAt && (
                        <s className="price-was">
                          {formatProductPrice(linkCompareAt, link.currency)}
                        </s>
                      )}
                    </small>
                  )}
              </span>
            </a>
          </footer>
        )}
      </div>
    </dialog>
  );
}
