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

export function normalizeSettings(input: unknown): WebsiteSettings {
  const result = { ...defaults };
  if (!input || typeof input !== 'object') return result;
  for (const key of Object.keys(defaults) as (keyof WebsiteSettings)[]) {
    const value: unknown = Reflect.get(input, key);
    if (key.endsWith('Color')) {
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
