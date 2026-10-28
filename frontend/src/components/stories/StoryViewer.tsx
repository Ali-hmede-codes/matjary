import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutGrid,
  LoaderCircle,
  Pause,
  Play,
  ShoppingBag,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { assetUrl, type Story, type StoryGroup } from '../../lib/api';
import { formatProductPrice, storePath } from '../../lib/storefront';
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
  const [removed, setRemoved] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState(0);
  // Elapsed time survives a hold so the bar resumes where it stopped.
  const elapsed = useRef(0);
  const holdStart = useRef(0);
  const suppressTap = useRef(false);

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
  }, [groupIndex, storyIndex]);

  useEffect(() => {
    if (!story) return;
    onSeen([story.id]);
  }, [story, onSeen]);

  // Images advance on a timer; videos advance on `ended`.
  useEffect(() => {
    if (!story || paused || story.media.kind === 'video') return;
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
  }, [advance, duration, paused, story]);

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
      <div className="story-viewer-shell">
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
              src={assetUrl(story.media.primaryUrl)}
              alt=""
              draggable={false}
            />
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
          {paused && !blocked && (
            <span className="story-paused" aria-hidden="true">
              <Pause size={26} fill="currentColor" />
            </span>
          )}
        </div>
        <button
          type="button"
          className="story-nav story-nav-prev"
          aria-label="Previous story"
          onPointerDown={beginHold}
          onPointerUp={endHold}
          onPointerLeave={() => setPaused(false)}
          onPointerCancel={() => setPaused(false)}
          onClick={() => tap(-1)}
        />
        <button
          type="button"
          className="story-nav story-nav-next"
          aria-label="Next story"
          onPointerDown={beginHold}
          onPointerUp={endHold}
          onPointerLeave={() => setPaused(false)}
          onPointerCancel={() => setPaused(false)}
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
