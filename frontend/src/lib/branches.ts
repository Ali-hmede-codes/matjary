import type { Store, StoreBranch } from './api';
import { safeUrl } from './website.ts';
import { storeMap } from './storefront.ts';

export const weekDays = [
  { key: 'mon', short: 'Mon', label: 'Monday' },
  { key: 'tue', short: 'Tue', label: 'Tuesday' },
  { key: 'wed', short: 'Wed', label: 'Wednesday' },
  { key: 'thu', short: 'Thu', label: 'Thursday' },
  { key: 'fri', short: 'Fri', label: 'Friday' },
  { key: 'sat', short: 'Sat', label: 'Saturday' },
  { key: 'sun', short: 'Sun', label: 'Sunday' },
] as const;

export type WeekdayKey = (typeof weekDays)[number]['key'];

const dayAliases: Record<string, WeekdayKey> = {
  mon: 'mon',
  monday: 'mon',
  tue: 'tue',
  tuesday: 'tue',
  wed: 'wed',
  wednesday: 'wed',
  thu: 'thu',
  thursday: 'thu',
  fri: 'fri',
  friday: 'fri',
  sat: 'sat',
  saturday: 'sat',
  sun: 'sun',
  sunday: 'sun',
};

const timeRangePattern =
  /^\s*([01]?\d|2[0-3]):([0-5]\d)\s*[-–]\s*([01]?\d|2[0-3]):([0-5]\d)\s*$/u;

export interface ParsedTimeRange {
  open: number;
  close: number;
}

export function dayKeyFor(date: Date): WeekdayKey {
  return (
    (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[
      date.getDay()
    ] ?? 'mon'
  );
}

export function normalizeHours(
  hours: Record<string, string | null> | null | undefined,
): Map<WeekdayKey, string> {
  const normalized = new Map<WeekdayKey, string>();
  for (const [day, value] of Object.entries(hours ?? {})) {
    const key = dayAliases[day.trim().toLowerCase()];
    if (!key || typeof value !== 'string' || !value.trim()) continue;
    normalized.set(key, value.trim());
  }
  return normalized;
}

export function parseTimeRange(
  value: string | null | undefined,
): ParsedTimeRange | null {
  if (!value) return null;
  const match = timeRangePattern.exec(value);
  if (!match) return null;
  const openHour = Number(match[1] ?? 0);
  const openMinute = Number(match[2] ?? 0);
  const closeHour = Number(match[3] ?? 0);
  const closeMinute = Number(match[4] ?? 0);
  return {
    open: openHour * 60 + openMinute,
    close: closeHour * 60 + closeMinute,
  };
}

export function timeInputValue(minutes: number): string {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(
    safe % 60,
  ).padStart(2, '0')}`;
}

export function timeInputToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const suffix = hours < 12 ? 'AM' : 'PM';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${String(minutes % 60).padStart(2, '0')} ${suffix}`;
}

export function hoursLabel(value: string | null | undefined): string {
  const range = parseTimeRange(value);
  if (!range) return value?.trim() ? value : 'Closed';
  return `${formatTime(range.open)} – ${formatTime(range.close)}`;
}

function openAtRange(range: ParsedTimeRange, minutes: number): boolean {
  if (range.close === range.open) return false;
  return range.close > range.open
    ? minutes >= range.open && minutes < range.close
    : minutes >= range.open || minutes < range.close;
}

export interface BranchOpenState {
  open: boolean;
  label: string;
  // Short second line used by the hero chip and branch card on phones, where
  // a hover-only tooltip cannot show the until/opens time.
  detail: string;
}

export function branchOpenState(
  hours: Record<string, string | null> | null | undefined,
  now = new Date(),
): BranchOpenState | null {
  const normalized = normalizeHours(hours);
  if (normalized.size === 0) return null;
  const currentDay = dayKeyFor(now);
  const currentIndex = weekDays.findIndex((day) => day.key === currentDay);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const today = parseTimeRange(normalized.get(currentDay));
  // An overnight range from yesterday can still cover the early morning.
  const previousDay =
    weekDays[(currentIndex + weekDays.length - 1) % weekDays.length];
  const previous = parseTimeRange(normalized.get(previousDay?.key ?? 'mon'));
  if (previous && previous.close <= previous.open && minutes < previous.close) {
    return {
      open: true,
      label: `Open now · until ${formatTime(previous.close)}`,
      detail: `until ${formatTime(previous.close)}`,
    };
  }
  if (today && openAtRange(today, minutes)) {
    return {
      open: true,
      label: `Open now · until ${formatTime(today.close)}`,
      detail: `until ${formatTime(today.close)}`,
    };
  }
  if (today && minutes < today.open) {
    return {
      open: false,
      label: `Closed · opens ${formatTime(today.open)}`,
      detail: `opens ${formatTime(today.open)}`,
    };
  }
  for (let offset = 1; offset <= weekDays.length; offset += 1) {
    const day = weekDays[(currentIndex + offset) % weekDays.length];
    if (!day) continue;
    const range = parseTimeRange(normalized.get(day.key));
    if (range) {
      return {
        open: false,
        label: `Closed · opens ${day.short} ${formatTime(range.open)}`,
        detail: `opens ${day.short} ${formatTime(range.open)}`,
      };
    }
  }
  return { open: false, label: 'Closed', detail: '' };
}

export function branchAddress(
  branch: Pick<StoreBranch, 'address' | 'city' | 'country' | 'postalCode'>,
): string {
  return [branch.address, branch.city, branch.country, branch.postalCode]
    .filter((value) => value?.trim())
    .join(', ');
}

export function branchCoordinates(
  branch: Pick<StoreBranch, 'latitude' | 'longitude'>,
): { latitude: number; longitude: number } | undefined {
  const latitude =
    typeof branch.latitude === 'string'
      ? Number(branch.latitude)
      : branch.latitude;
  const longitude =
    typeof branch.longitude === 'string'
      ? Number(branch.longitude)
      : branch.longitude;
  return typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude)
    ? { latitude, longitude }
    : undefined;
}

export function branchMap(branch: StoreBranch) {
  return storeMap({
    latitude: branch.latitude ?? null,
    longitude: branch.longitude ?? null,
    city: null,
    country: null,
    mapUrl: branch.mapUrl ?? null,
  });
}

export function branchPhoneHref(branch: Pick<StoreBranch, 'phone'>) {
  const cleaned = branch.phone?.replace(/[^\d+]/gu, '') ?? '';
  return /^\+?\d{7,15}$/u.test(cleaned) ? `tel:${cleaned}` : undefined;
}

export function branchWhatsAppHref(branch: StoreBranch) {
  const saved = safeUrl(branch.whatsappUrl ?? '');
  if (saved) {
    try {
      const url = new URL(saved);
      if (
        url.origin === 'https://wa.me' &&
        /^\/?\+?\d{7,15}$/u.test(url.pathname)
      )
        return saved;
    } catch {
      /* Fall through to the stored digits. */
    }
  }
  const digits = branch.whatsapp?.replace(/\D/gu, '') ?? '';
  return /^\d{7,15}$/u.test(digits) ? `https://wa.me/${digits}` : undefined;
}

export function branchDirectionsUrl(branch: StoreBranch) {
  const googleMapsLink = branchGoogleMapsLink(branch.googleMapsUrl);
  if (googleMapsLink) return googleMapsLink;
  const saved = safeUrl(branch.mapUrl ?? '');
  if (saved) return saved;
  const coordinates = branchCoordinates(branch);
  if (coordinates)
    return `https://www.openstreetmap.org/?mlat=${coordinates.latitude}&mlon=${coordinates.longitude}#map=16/${coordinates.latitude}/${coordinates.longitude}`;
  const address = branchAddress(branch);
  return address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
    : undefined;
}

// Mirrors the server allowlist so a shop-owner-supplied link can never turn a
// directions action into an arbitrary redirect.
export function isGoogleMapsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'maps.app.goo.gl') return true;
    if (host === 'goo.gl') return url.pathname.startsWith('/maps');
    if (/^maps\.google\.[a-z]{2,3}(?:\.[a-z]{2})?$/u.test(host)) return true;
    if (/^(?:www\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/u.test(host))
      return url.pathname.startsWith('/maps');
    return false;
  } catch {
    return false;
  }
}

export function branchGoogleMapsLink(
  value: string | null | undefined,
): string | undefined {
  const saved = safeUrl(value ?? '');
  return saved && isGoogleMapsUrl(saved) ? saved : undefined;
}

// Opens the street-level camera view for the pin. Google may not have imagery
// for every street, but the link itself is deterministic and safe.
export function branchStreetViewUrl(branch: StoreBranch) {
  const coordinates = branchCoordinates(branch);
  if (!coordinates) return undefined;
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${coordinates.latitude},${coordinates.longitude}`;
}

export function distanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const radius = 6371;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round(km * 1000))} m away`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
}

export function branchDistance(
  branch: StoreBranch,
  position: { latitude: number; longitude: number },
): number | undefined {
  const coordinates = branchCoordinates(branch);
  return coordinates ? distanceKm(position, coordinates) : undefined;
}

export function sortBranchesByDistance(
  branches: StoreBranch[],
  position: { latitude: number; longitude: number } | null,
): StoreBranch[] {
  if (!position) return branches;
  return [...branches].sort((a, b) => {
    const distanceA = branchDistance(a, position);
    const distanceB = branchDistance(b, position);
    if (distanceA === undefined) return distanceB === undefined ? 0 : 1;
    if (distanceB === undefined) return -1;
    return distanceA - distanceB;
  });
}

export function branchHoursEntries(
  hours: Record<string, string | null> | null | undefined,
) {
  const normalized = normalizeHours(hours);
  return weekDays.map((day) => ({
    ...day,
    value: normalized.get(day.key) ?? null,
  }));
}

// Stores saved before branches existed keep their single location. This adapter
// lets the storefront show that old location without a schema-specific branch.
export function storeBranches(
  store?: Partial<Pick<Store, 'branches' | 'location' | 'socialMediaLinks'>>,
): StoreBranch[] {
  const saved = (store?.branches ?? []).filter(Boolean);
  if (saved.length > 0) return saved;
  const location = store?.location;
  if (!location) return [];
  const whatsapp =
    store?.socialMediaLinks?.whatsapp?.replace(/\D/gu, '') || undefined;
  const validWhatsApp =
    whatsapp && /^\d{7,15}$/u.test(whatsapp) ? whatsapp : null;
  return [
    {
      id: `legacy-${location.locationName ?? location.city ?? 'main'}`,
      name: location.locationName || location.city || 'Main location',
      address: location.address ?? null,
      city: location.city,
      country: location.country,
      latitude: location.latitude ?? null,
      longitude: location.longitude ?? null,
      phone: location.phone ?? null,
      whatsapp: validWhatsApp,
      whatsappUrl: validWhatsApp ? `https://wa.me/${validWhatsApp}` : null,
      openingHours: location.openingHours ?? null,
      isPrimary: true,
    },
  ];
}

export function primaryBranch(
  branches: StoreBranch[],
): StoreBranch | undefined {
  return branches.find((branch) => branch.isPrimary) ?? branches[0];
}
