import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { BadgeCheck, X } from 'lucide-react';
import { assetUrl, type Media, type Store } from '../lib/api';
import {
  isStoreVerified,
  storeMediaUrl,
  storePresentation,
} from '../lib/storefront';

// Long enough to feel deliberate, short enough that a normal tap still opens
// the shop. A hold that drifts further than the slop is a scroll, not a hold.
const HOLD_MS = 450;
const HOLD_SLOP = 8;

export function StoreVerifiedBadge({
  store,
  size = 20,
}: {
  // Every surface that prints a shop name can pass its badge fields, even when
  // it is not holding a full store record (feed items, stories, ads).
  store?: Pick<Store, 'hasVerificationBadge' | 'verificationBadgeExpiresAt'>;
  size?: number;
}) {
  if (!isStoreVerified(store)) return null;
  return (
    <span
      className="store-verified-badge"
      role="img"
      aria-label="Verified shop"
      title="This shop has an active verification badge."
    >
      <BadgeCheck size={size} aria-hidden="true" />
    </span>
  );
}

export function StoreAvatar({
  store,
  large = false,
  preview,
  expandable = false,
}: {
  store?: Store;
  large?: boolean;
  preview?: Media;
  /** Long-press shows the shop logo on its own, the way a profile photo does. */
  expandable?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  // A completed hold must not also follow the avatar's link.
  const swallowClick = useRef(false);
  // Touch holds are the gesture's own; a mouse right-click still gets the menu.
  const touchPress = useRef(false);
  const logoSrc = assetUrl(storeMediaUrl(store?.logoKey));
  const thumbnail =
    logoSrc ||
    assetUrl(
      preview?.kind === 'video' ? preview.posterUrl : preview?.primaryUrl,
    );
  const { theme } = storePresentation(store ?? { brandColor: null });
  // Initials are not a photo worth enlarging; only a real, loaded logo is.
  const canExpand = expandable && Boolean(logoSrc) && logoSrc !== failedSrc;
  const name = store?.name || 'Shop';

  function stopHold() {
    if (hold.current !== undefined) clearTimeout(hold.current);
    hold.current = undefined;
    start.current = undefined;
  }

  useEffect(() => stopHold, []);

  function beginHold(event: ReactPointerEvent<HTMLSpanElement>) {
    if (!canExpand) return;
    touchPress.current = event.pointerType !== 'mouse';
    // A new gesture always starts clean, even if the previous one ended
    // inside the preview instead of on this avatar.
    swallowClick.current = false;
    if (event.button !== 0) return;
    stopHold();
    start.current = { x: event.clientX, y: event.clientY };
    hold.current = setTimeout(() => {
      hold.current = undefined;
      swallowClick.current = true;
      setExpanded(true);
    }, HOLD_MS);
  }

  function trackHold(event: ReactPointerEvent<HTMLSpanElement>) {
    const origin = start.current;
    if (!origin || hold.current === undefined) return;
    if (
      Math.abs(event.clientX - origin.x) > HOLD_SLOP ||
      Math.abs(event.clientY - origin.y) > HOLD_SLOP
    )
      stopHold();
  }

  return (
    <>
      <span
        className={`store-avatar ${large ? 'large' : ''} ${canExpand ? 'is-expandable' : ''}`}
        aria-hidden="true"
        onPointerDown={canExpand ? beginHold : undefined}
        onPointerMove={canExpand ? trackHold : undefined}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        onContextMenu={(event) => {
          // A phone hold must never open the platform's image menu, not even
          // when its long-press fires before this gesture's own timer.
          if (
            touchPress.current ||
            hold.current !== undefined ||
            swallowClick.current
          )
            event.preventDefault();
        }}
        onClick={(event) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        style={
          store?.brandColor
            ? ({
                backgroundColor: theme['--brand-primary'],
                color: theme['--brand-on-primary'],
              } as CSSProperties)
            : undefined
        }
      >
        {thumbnail && thumbnail !== failedSrc ? (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setFailedSrc(thumbnail)}
          />
        ) : (
          (store?.name || 'M')
            .split(' ')
            .map((part) => part[0])
            .slice(0, 2)
            .join('')
        )}
      </span>
      {expanded &&
        logoSrc &&
        createPortal(
          <LogoPreview
            src={logoSrc}
            name={name}
            onClose={() => setExpanded(false)}
          />,
          document.body,
        )}
    </>
  );
}

function LogoPreview({
  src,
  name,
  onClose,
}: {
  src: string;
  name: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // A tap that began inside the preview dismisses it. A press that began on the
  // avatar and is still down when the dialog opens must not close it.
  const pressedInside = useRef(false);

  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    // The finger that opened the preview is still down. Without this the phone
    // offers its own "save image" menu for the picture just revealed, often
    // targeting the avatar underneath, so the block listens on the document.
    const blockContextMenu = (event: Event) => event.preventDefault();
    document.addEventListener('contextmenu', blockContextMenu, {
      capture: true,
    });
    element?.showModal();
    element
      ?.querySelector<HTMLElement>('.logo-preview-close')
      ?.focus({ preventScroll: true });
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('contextmenu', blockContextMenu, {
        capture: true,
      });
      element?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="logo-preview"
      aria-label={`${name} logo`}
      onCancel={onClose}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={() => {
        pressedInside.current = true;
      }}
      onClick={() => {
        if (pressedInside.current) onClose();
      }}
    >
      <figure className="logo-preview-card">
        <img src={src} alt={`${name} logo`} draggable={false} />
        <figcaption>{name}</figcaption>
      </figure>
      <button
        type="button"
        className="logo-preview-close"
        onClick={onClose}
        aria-label="Close logo preview"
      >
        <X size={19} aria-hidden="true" />
      </button>
    </dialog>
  );
}
