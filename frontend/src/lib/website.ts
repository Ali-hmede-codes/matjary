export interface WebsiteSettings {
  siteName: string;
  tagline: string | null;
  description: string | null;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  bannerUrl: string | null;
  contactEmail: string | null;
  footerText: string | null;
  // Whole Lebanese pounds per 1 USD. 0 means LBP display is off platform-wide.
  lbpExchangeRate: number;
}

export const defaults: WebsiteSettings = {
  siteName: 'Matjary',
  tagline: null,
  description: null,
  primaryColor: '#254e40',
  secondaryColor: '#d9a441',
  backgroundColor: '#ffffff',
  textColor: '#17231e',
  logoUrl: null,
  faviconUrl: null,
  bannerUrl: null,
  contactEmail: null,
  footerText: null,
  lbpExchangeRate: 0,
};

export function safeUrl(value: string | null | undefined): string | undefined {
  if (!value || /[\s\\]/u.test(value)) return undefined;
  if (/^\/(?!\/)/u.test(value)) return value;
  try {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

// Mirrors the API rule for branding images so a mistyped address is reported
// next to its field instead of as a generic rejection after a round trip.
export function imageAddressError(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return '';
  if (/[\s\\]/u.test(trimmed)) return 'Use one address with no spaces.';
  if (!/^https:\/\//u.test(trimmed) && !/^\/(?!\/)/u.test(trimmed))
    return 'Start with https:// or / for a file on this website.';
  try {
    const url = new URL(trimmed, 'https://website.invalid');
    if (url.username || url.password)
      return 'Remove the username and password from the address.';
    if (url.hash) return 'Remove the #part from the address.';
  } catch {
    return 'That address is not a valid link.';
  }
  return '';
}

// Static branding files keep their public names between releases, so a browser
// would keep serving a previously cached logo or favicon. Vite hashes those
// files at build time, and every reference appends the same stamp.
export const BRANDING_VERSION =
  typeof __BRANDING_VERSION__ === 'string' ? __BRANDING_VERSION__ : '';

export function brandingUrl(
  value: string | null | undefined,
  version = BRANDING_VERSION,
): string | undefined {
  const safe = safeUrl(value);
  if (!safe) return undefined;
  // Uploaded media keys embed the asset UUID and never change bytes; external
  // URLs are not ours to rewrite. Only same-origin static files need the stamp.
  if (!version || !safe.startsWith('/') || safe.startsWith('/api/'))
    return safe;
  const url = new URL(safe, 'https://branding.invalid');
  url.searchParams.set('v', version);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function normalizeSettings(input: unknown): WebsiteSettings {
  const result = { ...defaults };
  if (!input || typeof input !== 'object') return result;
  for (const key of Object.keys(defaults) as (keyof WebsiteSettings)[]) {
    const value: unknown = Reflect.get(input, key);
    if (key === 'lbpExchangeRate') {
      if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 10_000_000
      )
        Object.assign(result, { [key]: value });
    } else if (key.endsWith('Color')) {
      if (typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value))
        Object.assign(result, { [key]: value });
    } else if (key.endsWith('Url')) {
      Object.assign(result, {
        [key]: typeof value === 'string' ? (safeUrl(value) ?? null) : null,
      });
    } else if (typeof value === 'string' && value.trim()) {
      Object.assign(result, { [key]: value.trim() });
    }
  }
  return result;
}

export const SETTINGS_CACHE_KEY = 'matjary:website-settings';
// Branding changes are rare, but a tab opened after a rename must not keep an
// ancient name forever when the API is unreachable.
const SETTINGS_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

export interface SettingsCacheEntry {
  values: WebsiteSettings;
  savedAt: number;
}

// The static build cannot know the administrator's current name, so the last
// successfully loaded values are kept locally and applied before the first
// paint. The API remains the single source of truth on every load.
export function readSettingsCache(
  storage: Pick<Storage, 'getItem'> | undefined = browserStorage(),
  now = Date.now(),
): SettingsCacheEntry | undefined {
  if (!storage) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(SETTINGS_CACHE_KEY) ?? 'null',
    );
    if (!parsed || typeof parsed !== 'object') return undefined;
    const values = Reflect.get(parsed, 'values');
    const savedAt = Reflect.get(parsed, 'savedAt');
    if (
      !values ||
      typeof values !== 'object' ||
      typeof savedAt !== 'number' ||
      !Number.isFinite(savedAt) ||
      savedAt > now + 60_000 ||
      now - savedAt > SETTINGS_CACHE_MAX_AGE_MS
    )
      return undefined;
    return { values: normalizeSettings(values), savedAt };
  } catch {
    return undefined;
  }
}

export function cacheSettings(
  settings: WebsiteSettings,
  storage: Pick<Storage, 'setItem'> | undefined = browserStorage(),
  now = Date.now(),
): void {
  try {
    storage?.setItem(
      SETTINGS_CACHE_KEY,
      JSON.stringify({ values: settings, savedAt: now }),
    );
  } catch {
    /* Private mode or a full quota: the API still supplies every load. */
  }
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function contrastColor(hex: string): string {
  const channels = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return r * 0.2126 + g * 0.7152 + b * 0.0722 > 0.179 ? '#17231e' : '#ffffff';
}

// Keep local API media behind the proxy, without decoding opaque storage keys.
export function mediaUrl(
  value: string | null | undefined,
  backendOrigin: string | null,
) {
  const safe = safeUrl(value);
  if (!safe || !backendOrigin || safe.startsWith('/')) return safe;
  const url = new URL(safe);
  const backend = new URL(backendOrigin);
  const loopback = ['localhost', '127.0.0.1', '[::1]'];
  const sameBackend =
    url.origin === backend.origin ||
    (loopback.includes(url.hostname) &&
      loopback.includes(backend.hostname) &&
      url.port === backend.port);
  return sameBackend && url.pathname.startsWith('/api/')
    ? `${url.pathname}${url.search}`
    : safe;
}

export function parseLikeResponse(input: unknown): {
  likes: number;
  viewerLiked: boolean;
} {
  if (input && typeof input === 'object') {
    const likes: unknown = Reflect.get(input, 'likes');
    const viewerLiked: unknown = Reflect.get(input, 'viewerLiked');
    if (
      typeof likes === 'number' &&
      Number.isSafeInteger(likes) &&
      likes >= 0 &&
      typeof viewerLiked === 'boolean'
    ) {
      return { likes, viewerLiked };
    }
  }
  throw new Error('Could not update this like.');
}

export function parseViewResponse(input: unknown): { views: number } {
  if (input && typeof input === 'object') {
    const views: unknown = Reflect.get(input, 'views');
    if (
      typeof views === 'number' &&
      Number.isSafeInteger(views) &&
      views >= 0
    ) {
      return { views };
    }
  }
  throw new Error('Could not record this view.');
}

export function isLocalFrontendRequest(
  origin: string | undefined,
  host: string | undefined,
): boolean {
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      ['5173', '4173'].includes(url.port) &&
      url.host === host
    );
  } catch {
    return false;
  }
}

export function enableMouseScrolling(node: HTMLElement | null) {
  if (!node) return;
  const element = node;
  const document = element.ownerDocument;
  let drag: { id: number; x: number; left: number; moved: boolean } | undefined;
  let suppressClick = false;
  const clamp = (left: number) =>
    Math.max(0, Math.min(left, element.scrollWidth - element.clientWidth));

  function wheel(event: WheelEvent) {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !event.cancelable ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
    )
      return;
    const unit =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? element.clientWidth
          : 1;
    const next = clamp(element.scrollLeft + event.deltaY * unit);
    // Let the page keep scrolling when the row has reached either edge.
    if (next === element.scrollLeft) return;
    event.preventDefault();
    element.scrollLeft = next;
  }
  function finish() {
    const id = drag?.id;
    drag = undefined;
    element.classList.remove('is-dragging');
    if (id !== undefined && element.hasPointerCapture(id))
      element.releasePointerCapture(id);
  }
  function down(event: PointerEvent) {
    suppressClick = false;
    if (
      event.pointerType !== 'mouse' ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      element.scrollWidth <= element.clientWidth
    )
      return;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      left: element.scrollLeft,
      moved: false,
    };
  }
  function move(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    if (!(event.buttons & 1)) return finish();
    const distance = event.clientX - drag.x;
    if (!drag.moved && Math.abs(distance) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      suppressClick = true;
      element.classList.add('is-dragging');
      // Capture only after dragging starts, so ordinary store/button clicks still work.
      element.setPointerCapture(drag.id);
    }
    event.preventDefault();
    element.scrollLeft = clamp(drag.left - distance);
  }
  function end(event: PointerEvent) {
    if (event.pointerId === drag?.id) finish();
  }
  function click(event: MouseEvent) {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }
  const preventDrag = (event: DragEvent) => event.preventDefault();
  element.addEventListener('wheel', wheel, { passive: false });
  element.addEventListener('pointerdown', down);
  element.addEventListener('lostpointercapture', end);
  element.addEventListener('dragstart', preventDrag);
  element.addEventListener('click', click, true);
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  document.defaultView?.addEventListener('blur', finish);
  return () => {
    finish();
    element.removeEventListener('wheel', wheel);
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('lostpointercapture', end);
    element.removeEventListener('dragstart', preventDrag);
    element.removeEventListener('click', click, true);
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', end);
    document.removeEventListener('pointercancel', end);
    document.defaultView?.removeEventListener('blur', finish);
  };
}

export function readSavedIds(storage: Pick<Storage, 'getItem'>): string[] {
  try {
    const value: unknown = JSON.parse(
      storage.getItem('matjary:saved-posts') || '[]',
    );
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter((id): id is string => typeof id === 'string'),
          ),
        ].slice(-500)
      : [];
  } catch {
    return [];
  }
}
