import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Expand,
  LoaderCircle,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { assetUrl, type Media } from '../lib/api';
import {
  isFeedPlaybackSuspended,
  subscribeFeedPlayback,
} from '../lib/video-playback';
import { MediaView } from './MediaView';

type AutoplayVideoProps = {
  media: Media;
  title: string;
  /** The post viewer is on screen by definition; feed cards wait for scroll. */
  eager?: boolean;
  /** Only the post a viewer is showing may play; hidden slides keep a poster. */
  active?: boolean;
  /** When set, a tap opens the post instead of pausing this clip. */
  onOpen?: () => void;
  fit?: 'cover' | 'contain';
};

// Playback starts once a meaningful part of the card is visible (a post below
// the fold can peek in at under half height), but the source is attached a
// little earlier so scrolling into a clip feels instant. Must match the
// preloader rootMargin below.
const PRELOAD_MARGIN = '300px 0px';
const PLAY_THRESHOLD = 0.35;

export function AutoplayVideo({
  media,
  title,
  eager = false,
  active = true,
  onOpen,
  fit = 'cover',
}: AutoplayVideoProps) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  // A visitor's own pause survives scroll jitter, but not leaving the card.
  const manuallyPaused = useRef(false);
  const [near, setNear] = useState(eager);
  const [visible, setVisible] = useState(eager);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [pageVisible, setPageVisible] = useState(
    () => document.visibilityState !== 'hidden',
  );
  // Autoplay is decorative motion; reduced-motion visitors press play first.
  const [reducedMotion] = useState(
    () =>
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  const suspended =
    useSyncExternalStore(
      subscribeFeedPlayback,
      isFeedPlaybackSuspended,
      isFeedPlaybackSuspended,
    ) && !eager;
  const src = assetUrl(media.primaryUrl);
  const poster = assetUrl(media.posterUrl);

  useEffect(() => {
    const onChange = () =>
      setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  useEffect(() => {
    if (eager) return;
    const node = frame.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      setVisible(true);
      return;
    }
    // Loading watches an expanded root so the next clip buffers before it
    // arrives. Playback watches the real viewport: rootMargin would inflate the
    // ratio and start clips that are still off screen.
    const preloader = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setNear(entry.isIntersecting);
      },
      { rootMargin: PRELOAD_MARGIN },
    );
    const player = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const rect = entry.boundingClientRect;
        const viewport = window.innerHeight;
        const shown = Math.max(
          0,
          Math.min(rect.bottom, viewport) - Math.max(rect.top, 0),
        );
        // Portrait clips can be taller than the screen, so compare against the
        // shorter of card and viewport instead of the card alone.
        const onScreen =
          rect.height > 0 &&
          shown >= PLAY_THRESHOLD * Math.min(rect.height, viewport);
        // Coming back to a card should autoplay again even if it was paused.
        if (!onScreen) manuallyPaused.current = false;
        setVisible(onScreen);
      },
      { threshold: [0, 0.25, 0.35, 0.5, 0.75, 1] },
    );
    preloader.observe(node);
    player.observe(node);
    return () => {
      preloader.disconnect();
      player.disconnect();
    };
  }, [eager]);

  useEffect(() => {
    const element = video.current;
    if (!element || !near) return;
    if (!visible || !pageVisible || suspended || !active) {
      element.pause();
      return;
    }
    // Reduced motion and an explicit pause keep the poster until play is pressed.
    if (reducedMotion || manuallyPaused.current) return;
    // Low-power modes may still refuse; the poster and play control remain.
    void element.play().catch(() => setPaused(true));
  }, [active, near, pageVisible, reducedMotion, suspended, visible]);

  useEffect(() => {
    // A slide that scrolled away may autoplay again when it returns.
    if (!active) manuallyPaused.current = false;
  }, [active]);

  useEffect(() => {
    const element = video.current;
    if (element) element.muted = muted;
  }, [muted]);

  useEffect(() => {
    const element = video.current;
    if (!element || (near && active)) return;
    // Far-away or hidden clips drop their source so decoder memory and
    // in-flight requests are released; the poster stays up until they return.
    element.pause();
    element.removeAttribute('src');
    element.load();
    setProgress(0);
  }, [active, near]);

  if (!src || failed) return <MediaView media={media} title={title} />;

  function togglePlay() {
    const element = video.current;
    if (!element) return;
    if (!element.paused) {
      manuallyPaused.current = true;
      element.pause();
      return;
    }
    manuallyPaused.current = false;
    void element.play().catch(() => setPaused(true));
  }

  function handleTimeUpdate() {
    const element = video.current;
    if (!element || !Number.isFinite(element.duration) || element.duration <= 0)
      return;
    setProgress(Math.min(1, element.currentTime / element.duration));
  }

  return (
    <div
      ref={frame}
      className={`auto-video auto-video-${fit}${paused ? ' is-paused' : ''}`}
    >
      <video
        ref={video}
        className="auto-video-el"
        src={near && active ? src : undefined}
        poster={poster ?? undefined}
        muted={muted}
        loop
        playsInline
        preload={near && active ? 'auto' : 'none'}
        aria-label={title}
        onPlay={() => {
          setPaused(false);
          setBuffering(false);
        }}
        onPause={() => {
          setPaused(true);
          setBuffering(false);
        }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onTimeUpdate={handleTimeUpdate}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        className="auto-video-toggle"
        onClick={onOpen ?? togglePlay}
        aria-label={
          onOpen ? `Open ${title}` : `${paused ? 'Play' : 'Pause'} ${title}`
        }
      >
        {onOpen ? (
          <Expand size={24} />
        ) : paused ? (
          <Play size={26} fill="currentColor" />
        ) : (
          <Pause size={24} fill="currentColor" />
        )}
      </button>
      <button
        type="button"
        className="auto-video-sound"
        onClick={() => setMuted((value) => !value)}
        aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
        aria-pressed={!muted}
      >
        {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
      </button>
      {buffering && !paused && (
        <span
          className="auto-video-buffering"
          role="status"
          aria-label="Loading video"
        >
          <LoaderCircle className="spin" size={24} />
        </span>
      )}
      <span className="auto-video-progress" aria-hidden="true">
        <i style={{ transform: `scaleX(${progress})` }} />
      </span>
    </div>
  );
}
