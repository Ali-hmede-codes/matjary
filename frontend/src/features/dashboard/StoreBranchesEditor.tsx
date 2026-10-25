import { useState } from 'react';
import {
  Check,
  Clock3,
  Link2,
  LocateFixed,
  MapPin,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type { StoreBranch } from '../../lib/api';
import {
  branchMap,
  isGoogleMapsUrl,
  normalizeHours,
  parseTimeRange,
  timeInputToMinutes,
  timeInputValue,
  weekDays,
  type WeekdayKey,
} from '../../lib/branches';
import { getJson, mutate } from '../shared/panel-api';
import { Notice } from '../shared/PanelUI';

export interface DayHoursDraft {
  open: boolean;
  from: string;
  to: string;
}

export type WeekHoursDraft = Record<WeekdayKey, DayHoursDraft>;

export interface BranchDraft {
  key: string;
  id?: string;
  name: string;
  address: string;
  city: string;
  country: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  phone: string;
  whatsapp: string;
  googleMapsUrl: string;
  isPrimary: boolean;
  hours: WeekHoursDraft;
}

let draftSequence = 0;

function defaultHours(): WeekHoursDraft {
  return weekDays.reduce((hours, day) => {
    hours[day.key] = {
      open: day.key !== 'sun',
      from: '09:00',
      to: '18:00',
    };
    return hours;
  }, {} as WeekHoursDraft);
}

export function emptyBranchDraft(isPrimary = false): BranchDraft {
  draftSequence += 1;
  return {
    key: `branch-draft-${Date.now()}-${draftSequence}`,
    name: '',
    address: '',
    city: '',
    country: 'Lebanon',
    postalCode: '',
    latitude: null,
    longitude: null,
    phone: '',
    whatsapp: '',
    googleMapsUrl: '',
    isPrimary,
    hours: defaultHours(),
  };
}

export function toBranchDraft(branch: StoreBranch): BranchDraft {
  draftSequence += 1;
  const saved = normalizeHours(branch.openingHours);
  return {
    key: `branch-${branch.id || Date.now()}-${draftSequence}`,
    ...(branch.id ? { id: branch.id } : {}),
    name: branch.name,
    address: branch.address ?? '',
    city: branch.city ?? '',
    country: branch.country ?? '',
    postalCode: branch.postalCode ?? '',
    latitude:
      typeof branch.latitude === 'string'
        ? Number(branch.latitude)
        : (branch.latitude ?? null),
    longitude:
      typeof branch.longitude === 'string'
        ? Number(branch.longitude)
        : (branch.longitude ?? null),
    phone: branch.phone ?? '',
    whatsapp: branch.whatsapp ?? '',
    googleMapsUrl: branch.googleMapsUrl ?? '',
    isPrimary: Boolean(branch.isPrimary),
    hours: weekDays.reduce((hours, day) => {
      const range = parseTimeRange(saved.get(day.key));
      hours[day.key] = {
        open: Boolean(range),
        from: range ? timeInputValue(range.open) : '09:00',
        to: range ? timeInputValue(range.close) : '18:00',
      };
      return hours;
    }, {} as WeekHoursDraft),
  };
}

export function branchPayload(branch: BranchDraft) {
  const openingHours = Object.fromEntries(
    weekDays.flatMap((day) => {
      const value = branch.hours[day.key];
      const from = value?.open ? timeInputToMinutes(value.from) : null;
      const to = value?.open ? timeInputToMinutes(value.to) : null;
      return from !== null && to !== null
        ? [[day.key, `${timeInputValue(from)}-${timeInputValue(to)}`]]
        : [];
    }),
  );
  return {
    ...(branch.id ? { id: branch.id } : {}),
    name: branch.name.trim(),
    address: branch.address.trim() || null,
    city: branch.city.trim() || null,
    country: branch.country.trim() || null,
    postalCode: branch.postalCode.trim() || null,
    latitude: branch.latitude,
    longitude: branch.longitude,
    phone: branch.phone.trim() || null,
    whatsapp: branch.whatsapp.trim() || null,
    googleMapsUrl: branch.googleMapsUrl.trim() || null,
    openingHours,
    isPrimary: branch.isPrimary,
  };
}

export function branchWhatsAppDigits(value: string): string {
  return value.replace(/\D/gu, '');
}

interface LocationResult {
  success: boolean;
  data?: {
    latitude?: number;
    longitude?: number;
    address?: string;
    city?: string;
    country?: string;
    postalCode?: string;
    placeName?: string;
  };
}

function withLocation(
  branch: BranchDraft,
  result: NonNullable<LocationResult['data']>,
): BranchDraft {
  return {
    ...branch,
    ...(branch.name.trim() ? {} : { name: result.placeName ?? branch.name }),
    latitude: result.latitude ?? branch.latitude,
    longitude: result.longitude ?? branch.longitude,
    address: result.address ?? branch.address,
    city: result.city ?? branch.city,
    country: result.country ?? branch.country,
    postalCode: result.postalCode ?? branch.postalCode,
  };
}

export function StoreBranchesEditor({
  branches,
  onChange,
  disabled = false,
}: {
  branches: BranchDraft[];
  onChange: (branches: BranchDraft[]) => void;
  disabled?: boolean;
}) {
  const [busyKey, setBusyKey] = useState('');
  const [linkBusyKey, setLinkBusyKey] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [mapKey, setMapKey] = useState('');

  function patch(key: string, changes: Partial<BranchDraft>) {
    onChange(
      branches.map((branch) =>
        branch.key === key ? { ...branch, ...changes } : branch,
      ),
    );
  }

  function patchHours(
    key: string,
    day: WeekdayKey,
    changes: Partial<DayHoursDraft>,
  ) {
    onChange(
      branches.map((branch) =>
        branch.key === key
          ? {
              ...branch,
              hours: {
                ...branch.hours,
                [day]: { ...branch.hours[day], ...changes },
              },
            }
          : branch,
      ),
    );
  }

  function note(key: string, message: string) {
    setNotes((current) => ({ ...current, [key]: message }));
  }

  function makePrimary(key: string) {
    const selected = branches.find((branch) => branch.key === key);
    if (!selected) return;
    onChange([
      { ...selected, isPrimary: true },
      ...branches
        .filter((branch) => branch.key !== key)
        .map((branch) => ({ ...branch, isPrimary: false })),
    ]);
  }

  function remove(key: string) {
    const next = branches.filter((branch) => branch.key !== key);
    if (next.length > 0 && !next.some((branch) => branch.isPrimary))
      next[0] = { ...next[0]!, isPrimary: true };
    onChange(next);
  }

  function add() {
    onChange([
      ...branches,
      emptyBranchDraft(!branches.some((branch) => branch.isPrimary)),
    ]);
  }

  async function resolveMapsLink(branch: BranchDraft) {
    const link = branch.googleMapsUrl.trim();
    if (!link) {
      note(branch.key, 'Paste a Google Maps link first.');
      return;
    }
    if (!isGoogleMapsUrl(link)) {
      note(branch.key, 'Paste a Google Maps link beginning with https://.');
      return;
    }
    setLinkBusyKey(branch.key);
    note(branch.key, '');
    try {
      const result = await mutate<LocationResult>(
        'stores/location/google-maps',
        { url: link },
      );
      if (!result.success || !result.data) {
        note(
          branch.key,
          'We could not find a location in that link. Try the full Google Maps place link, or set the address below.',
        );
        return;
      }
      let next = withLocation(branch, result.data);
      if (next.latitude !== null && next.longitude !== null && !next.address) {
        try {
          const reversed = await getJson<LocationResult>(
            `stores/location/reverse-geocode?lat=${next.latitude}&lon=${next.longitude}`,
          );
          if (reversed.success && reversed.data)
            next = withLocation(next, reversed.data);
        } catch {
          // The pin is still useful when reverse geocoding is unavailable.
        }
      }
      patch(branch.key, {
        name: next.name,
        googleMapsUrl: link,
        latitude: next.latitude,
        longitude: next.longitude,
        address: next.address,
        city: next.city,
        country: next.country,
        postalCode: next.postalCode,
      });
      note(
        branch.key,
        next.latitude !== null && next.longitude !== null
          ? 'Branch location set from the Google Maps link.'
          : 'We could not find a pin in that link.',
      );
    } catch {
      note(
        branch.key,
        'The Google Maps link could not be read right now. Try again in a moment.',
      );
    } finally {
      setLinkBusyKey('');
    }
  }

  async function useMyLocation(branch: BranchDraft) {
    if (!navigator.geolocation) {
      note(branch.key, 'This browser cannot read your location.');
      return;
    }
    setBusyKey(branch.key);
    note(branch.key, '');
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        let next: BranchDraft = {
          ...branch,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        try {
          const result = await getJson<LocationResult>(
            `stores/location/reverse-geocode?lat=${position.coords.latitude}&lon=${position.coords.longitude}`,
          );
          if (result.success && result.data)
            next = withLocation(next, result.data);
        } catch {
          // Coordinates are still useful when reverse geocoding is unavailable.
        }
        patch(branch.key, {
          latitude: next.latitude,
          longitude: next.longitude,
          address: next.address,
          city: next.city,
          country: next.country,
          postalCode: next.postalCode,
        });
        note(branch.key, 'Location pinned. Adjust the address if needed.');
        setBusyKey('');
      },
      () => {
        note(
          branch.key,
          'Location permission was blocked. Allow it in your browser, or type the address and use Find on map.',
        );
        setBusyKey('');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  async function findOnMap(branch: BranchDraft) {
    const address = [branch.address, branch.city, branch.country]
      .map((value) => value.trim())
      .filter(Boolean)
      .join(', ');
    if (!address) {
      note(branch.key, 'Add an address or city first.');
      return;
    }
    setBusyKey(branch.key);
    note(branch.key, '');
    try {
      const result = await getJson<LocationResult>(
        `stores/location/geocode?address=${encodeURIComponent(address)}`,
      );
      if (!result.success || !result.data) {
        note(
          branch.key,
          'We could not find that address. Try a nearby landmark.',
        );
        return;
      }
      patch(branch.key, withLocation(branch, result.data));
      note(branch.key, 'Map pin updated from the address.');
    } catch {
      note(branch.key, 'The map lookup is unavailable right now.');
    } finally {
      setBusyKey('');
    }
  }

  return (
    <section className="panel-card store-branches-editor">
      <div className="store-branches-heading">
        <div>
          <h2>Branches & opening hours</h2>
          <p className="panel-muted">
            Add every place customers can visit or order from. Each branch has
            its own call and WhatsApp number, map pin, and weekly hours.
          </p>
        </div>
        <span className="panel-pill">{branches.length} / 10 branches</span>
      </div>
      {branches.length === 0 && (
        <div className="panel-empty store-branches-empty">
          <span className="panel-empty-mark">
            <MapPin size={26} />
          </span>
          <div>
            <h3>No branches yet</h3>
            <p>
              Add your first location so customers can find you, call, and
              choose where to pick up an order.
            </p>
          </div>
          <button
            type="button"
            className="panel-secondary"
            disabled={disabled}
            onClick={add}
          >
            <Plus size={17} /> Add a branch
          </button>
        </div>
      )}
      <div className="store-branch-list">
        {branches.map((branch, index) => {
          const mapBranch: StoreBranch = {
            id: branch.key,
            name: branch.name,
            latitude: branch.latitude,
            longitude: branch.longitude,
          };
          const map =
            branch.latitude !== null && branch.longitude !== null
              ? branchMap(mapBranch)
              : undefined;
          const busy = busyKey === branch.key;
          const linkBusy = linkBusyKey === branch.key;
          const working = busy || linkBusy;
          return (
            <article
              className={`store-branch-card ${branch.isPrimary ? 'is-primary' : ''}`}
              key={branch.key}
            >
              <header className="store-branch-card-heading">
                <span className="store-branch-number">{index + 1}</span>
                <div className="store-branch-title">
                  <strong>{branch.name.trim() || 'New branch'}</strong>
                  <span>
                    {[branch.city, branch.country]
                      .map((value) => value.trim())
                      .filter(Boolean)
                      .join(', ') || 'Location details'}
                  </span>
                </div>
                {branch.isPrimary ? (
                  <span className="panel-pill store-branch-primary">
                    <Check size={12} /> Main branch
                  </span>
                ) : (
                  <button
                    type="button"
                    className="panel-secondary store-branch-main"
                    disabled={disabled}
                    onClick={() => makePrimary(branch.key)}
                  >
                    Set as main
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button store-branch-remove"
                  aria-label={`Remove ${branch.name || 'branch'}`}
                  title="Remove branch"
                  disabled={disabled}
                  onClick={() => remove(branch.key)}
                >
                  <Trash2 size={17} />
                </button>
              </header>

              <div className="panel-two-fields">
                <label>
                  Branch name
                  <input
                    maxLength={120}
                    value={branch.name}
                    placeholder="e.g. Downtown, Seaside, Main store"
                    onChange={(event) =>
                      patch(branch.key, { name: event.target.value })
                    }
                    disabled={disabled}
                  />
                </label>
                <label>
                  Phone number
                  <input
                    type="tel"
                    maxLength={30}
                    value={branch.phone}
                    placeholder="For calls"
                    autoComplete="tel"
                    onChange={(event) =>
                      patch(branch.key, { phone: event.target.value })
                    }
                    disabled={disabled}
                  />
                </label>
              </div>
              <label>
                WhatsApp number
                <input
                  type="tel"
                  maxLength={30}
                  value={branch.whatsapp}
                  placeholder="With country code, e.g. 96170123456"
                  inputMode="tel"
                  onChange={(event) =>
                    patch(branch.key, { whatsapp: event.target.value })
                  }
                  disabled={disabled}
                />
                <small>
                  Orders started from this shop go to this number. Leave empty
                  to use the shop-level WhatsApp number.
                </small>
              </label>

              <div className="store-branch-location">
                <label className="store-branch-link-field">
                  Google Maps link
                  <div className="store-branch-link-row">
                    <input
                      type="url"
                      maxLength={1000}
                      value={branch.googleMapsUrl}
                      placeholder="https://maps.app.goo.gl/…"
                      inputMode="url"
                      autoComplete="url"
                      onChange={(event) =>
                        patch(branch.key, {
                          googleMapsUrl: event.target.value,
                        })
                      }
                      onPaste={(event) => {
                        const pasted = event.clipboardData
                          .getData('text')
                          .trim();
                        if (!pasted) return;
                        event.preventDefault();
                        patch(branch.key, { googleMapsUrl: pasted });
                        if (isGoogleMapsUrl(pasted))
                          void resolveMapsLink({
                            ...branch,
                            googleMapsUrl: pasted,
                          });
                        else
                          note(
                            branch.key,
                            'Paste a Google Maps share link beginning with https://.',
                          );
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key === 'Enter' &&
                          branch.googleMapsUrl.trim()
                        ) {
                          event.preventDefault();
                          void resolveMapsLink(branch);
                        }
                      }}
                      disabled={disabled}
                    />
                    <button
                      type="button"
                      className="panel-secondary"
                      disabled={
                        disabled || working || !branch.googleMapsUrl.trim()
                      }
                      onClick={() => void resolveMapsLink(branch)}
                    >
                      <Link2 size={16} />
                      {linkBusy ? 'Reading…' : 'Use link'}
                    </button>
                  </div>
                  <small>
                    Paste a Google Maps share link and we’ll fill the pin and
                    address automatically.
                  </small>
                </label>
                <label>
                  Address
                  <input
                    maxLength={500}
                    value={branch.address}
                    placeholder="Street, building, floor"
                    autoComplete="street-address"
                    onChange={(event) =>
                      patch(branch.key, { address: event.target.value })
                    }
                    disabled={disabled}
                  />
                </label>
                <div className="panel-two-fields">
                  <label>
                    City
                    <input
                      maxLength={100}
                      value={branch.city}
                      autoComplete="address-level2"
                      onChange={(event) =>
                        patch(branch.key, { city: event.target.value })
                      }
                      disabled={disabled}
                    />
                  </label>
                  <label>
                    Country
                    <input
                      maxLength={100}
                      value={branch.country}
                      autoComplete="country-name"
                      onChange={(event) =>
                        patch(branch.key, { country: event.target.value })
                      }
                      disabled={disabled}
                    />
                  </label>
                </div>
                <div className="store-branch-location-actions">
                  <button
                    type="button"
                    className="panel-secondary"
                    disabled={disabled || working}
                    onClick={() => void useMyLocation(branch)}
                  >
                    <LocateFixed size={16} />
                    {busy ? 'Locating…' : 'Use my location'}
                  </button>
                  <button
                    type="button"
                    className="panel-secondary"
                    disabled={disabled || working}
                    onClick={() => void findOnMap(branch)}
                  >
                    <Search size={16} />
                    Find on map
                  </button>
                  {branch.latitude !== null && branch.longitude !== null && (
                    <>
                      <button
                        type="button"
                        className="panel-secondary"
                        disabled={disabled}
                        onClick={() =>
                          setMapKey(mapKey === branch.key ? '' : branch.key)
                        }
                      >
                        <MapPin size={16} />
                        {mapKey === branch.key ? 'Hide map' : 'Preview map'}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={disabled}
                        onClick={() =>
                          patch(branch.key, {
                            latitude: null,
                            longitude: null,
                          })
                        }
                      >
                        Clear pin
                      </button>
                    </>
                  )}
                </div>
                {branch.latitude !== null && branch.longitude !== null && (
                  <p className="store-branch-coordinates">
                    <MapPin size={14} /> {branch.latitude.toFixed(5)},{' '}
                    {branch.longitude.toFixed(5)}
                  </p>
                )}
                {mapKey === branch.key && map && (
                  <iframe
                    className="store-branch-map"
                    src={map.embedUrl}
                    title={`Map preview for ${branch.name || 'branch'}`}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    sandbox="allow-scripts allow-same-origin allow-popups"
                  />
                )}
                {notes[branch.key] && <Notice>{notes[branch.key]}</Notice>}
              </div>

              <div className="store-branch-hours">
                <div className="store-branch-hours-heading">
                  <h3>
                    <Clock3 size={16} /> Opening hours
                  </h3>
                  <button
                    type="button"
                    className="text-button"
                    disabled={disabled}
                    onClick={() => {
                      const monday = branch.hours.mon;
                      onChange(
                        branches.map((entry) =>
                          entry.key === branch.key
                            ? {
                                ...entry,
                                hours: weekDays.reduce((hours, day) => {
                                  hours[day.key] = { ...monday };
                                  return hours;
                                }, {} as WeekHoursDraft),
                              }
                            : entry,
                        ),
                      );
                    }}
                  >
                    Copy Monday to all days
                  </button>
                </div>
                <div className="store-branch-hour-rows">
                  {weekDays.map((day) => {
                    const value = branch.hours[day.key];
                    return (
                      <div
                        className={`store-branch-hour-row ${value.open ? '' : 'is-closed'}`}
                        key={day.key}
                      >
                        <span className="store-branch-day">{day.label}</span>
                        <label className="store-branch-open">
                          <input
                            type="checkbox"
                            checked={value.open}
                            onChange={(event) =>
                              patchHours(branch.key, day.key, {
                                open: event.target.checked,
                              })
                            }
                            disabled={disabled}
                          />
                          Open
                        </label>
                        <div className="store-branch-times">
                          <label>
                            <span>From</span>
                            <input
                              type="time"
                              value={value.from}
                              onChange={(event) =>
                                patchHours(branch.key, day.key, {
                                  from: event.target.value,
                                })
                              }
                              disabled={disabled || !value.open}
                            />
                          </label>
                          <label>
                            <span>To</span>
                            <input
                              type="time"
                              value={value.to}
                              onChange={(event) =>
                                patchHours(branch.key, day.key, {
                                  to: event.target.value,
                                })
                              }
                              disabled={disabled || !value.open}
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {branches.length > 0 && (
        <div className="store-branches-footer">
          <button
            type="button"
            className="panel-secondary"
            disabled={disabled || branches.length >= 10}
            onClick={add}
          >
            <Plus size={17} /> Add another branch
          </button>
          <small className="panel-muted">
            The main branch is used as your shop’s primary location in search
            and previews.
          </small>
        </div>
      )}
    </section>
  );
}
