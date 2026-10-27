import { useState, type RefObject } from 'react';
import {
  ArrowUpRight,
  Camera,
  Check,
  ChevronDown,
  Clock3,
  Crosshair,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  X,
} from 'lucide-react';
import type { Store, StoreBranch } from '../lib/api';
import {
  branchAddress,
  branchDirectionsUrl,
  branchDistance,
  branchHoursEntries,
  branchMap,
  branchOpenState,
  branchPhoneHref,
  branchStreetViewUrl,
  branchWhatsAppHref,
  dayKeyFor,
  formatDistance,
  hoursLabel,
  primaryBranch,
  sortBranchesByDistance,
  storeBranches,
} from '../lib/branches';

interface VisitorPosition {
  latitude: number;
  longitude: number;
}

function BranchHours({ branch }: { branch: StoreBranch }) {
  const entries = branchHoursEntries(branch.openingHours);
  if (!entries.some((entry) => entry.value)) return null;
  const today = dayKeyFor(new Date());
  return (
    <details className="shop-branch-hours">
      <summary>
        <Clock3 size={15} aria-hidden="true" />
        Opening hours
        <ChevronDown
          size={14}
          className="shop-branch-chevron"
          aria-hidden="true"
        />
      </summary>
      <dl>
        {entries.map((entry) => (
          <div
            className={entry.key === today ? 'is-today' : ''}
            key={entry.key}
          >
            <dt>
              {entry.label}
              {entry.key === today && <span>Today</span>}
            </dt>
            <dd>{hoursLabel(entry.value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function BranchCard({
  storeName,
  branch,
  position,
  openMap,
  active,
  nearest,
  onToggleMap,
}: {
  storeName: string;
  branch: StoreBranch;
  position: VisitorPosition | null;
  openMap: boolean;
  active: boolean;
  nearest: boolean;
  onToggleMap: () => void;
}) {
  const address = branchAddress(branch);
  const phone = branchPhoneHref(branch);
  const whatsapp = branchWhatsAppHref(branch);
  const directions = branchDirectionsUrl(branch);
  const streetView = branchStreetViewUrl(branch);
  const map = branchMap(branch);
  const openState = branchOpenState(branch.openingHours);
  const distance = position ? branchDistance(branch, position) : undefined;
  const today = branchHoursEntries(branch.openingHours).find(
    (entry) => entry.key === dayKeyFor(new Date()),
  );

  return (
    <article
      className={`shop-branch-card ${active ? 'is-active' : ''} ${nearest ? 'is-nearest' : ''}`}
    >
      <header className="shop-branch-head">
        <div>
          <h3>
            {branch.name}
            {branch.isPrimary && (
              <span className="shop-branch-main">
                <Check size={11} aria-hidden="true" /> Main
              </span>
            )}
          </h3>
          <p className="shop-branch-address">
            <MapPin size={14} aria-hidden="true" />
            {address || 'Ask the shop for the exact address.'}
          </p>
        </div>
        <div className="shop-branch-chips">
          {nearest && (
            <span className="shop-branch-nearest">
              <Crosshair size={12} aria-hidden="true" /> Nearest to you
            </span>
          )}
          {distance !== undefined && (
            <span className="shop-branch-distance">
              <Navigation size={12} aria-hidden="true" />
              {formatDistance(distance)}
            </span>
          )}
          {openState && (
            <span
              className={`shop-branch-state ${openState.open ? 'is-open' : 'is-closed'}`}
              title={openState.label}
            >
              <span className="shop-state-dot" aria-hidden="true" />
              <span className="shop-branch-state-copy">
                <strong>{openState.open ? 'Open now' : 'Closed'}</strong>
                {openState.detail && <small>{openState.detail}</small>}
              </span>
            </span>
          )}
        </div>
      </header>

      <div className="shop-branch-actions">
        {phone && (
          <a className="shop-branch-action" href={phone}>
            <Phone size={15} aria-hidden="true" /> Call
          </a>
        )}
        {whatsapp && (
          <a
            className="shop-branch-action is-whatsapp"
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle size={15} aria-hidden="true" /> WhatsApp
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
        {directions && (
          <a
            className="shop-branch-action"
            href={directions}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MapPin size={15} aria-hidden="true" /> Directions
            <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        )}
        {streetView && (
          <a
            className="shop-branch-action"
            href={streetView}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open the street-level camera view for ${branch.name}`}
          >
            <Camera size={15} aria-hidden="true" /> Street view
            <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        )}
      </div>

      {today?.value && (
        <p className="shop-branch-today">
          <Clock3 size={14} aria-hidden="true" />
          Today: {hoursLabel(today.value)}
        </p>
      )}
      <BranchHours branch={branch} />

      {map && (
        <div className="shop-branch-map-wrap">
          <button
            type="button"
            className="shop-branch-map-toggle"
            aria-expanded={openMap}
            onClick={onToggleMap}
          >
            <MapPin size={14} aria-hidden="true" />
            {openMap ? 'Hide map' : 'View map'}
            <ChevronDown
              size={14}
              className={openMap ? 'is-open' : ''}
              aria-hidden="true"
            />
          </button>
          {openMap && (
            <iframe
              src={map.embedUrl}
              title={`${storeName} — ${branch.name} on OpenStreetMap`}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          )}
        </div>
      )}
    </article>
  );
}

export function ShopBranches({
  store,
  open,
  onClose,
  panelRef,
}: {
  store: Store;
  open: boolean;
  onClose: () => void;
  panelRef?: RefObject<HTMLElement | null>;
}) {
  const branches = storeBranches(store);
  const [position, setPosition] = useState<VisitorPosition | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [openMap, setOpenMap] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState(
    () => primaryBranch(branches)?.id ?? '',
  );
  const ordered = sortBranchesByDistance(branches, position);
  // With a visitor position the list is nearest-first, so its head is the
  // branch worth naming explicitly on both phone and desktop layouts. Without
  // a measured distance nothing is labelled "nearest".
  const nearestBranch = position ? ordered[0] : undefined;
  const nearestDistance =
    nearestBranch && position
      ? branchDistance(nearestBranch, position)
      : undefined;
  const nearestBranchId =
    nearestDistance === undefined ? undefined : nearestBranch?.id;
  const selectedBranch =
    ordered.find((branch) => branch.id === selectedBranchId) ?? ordered[0];
  const mapped = branches.filter((branch) => branchMap(branch)).length;

  function locate() {
    if (!navigator.geolocation) {
      setGeoError('This browser cannot read your location.');
      return;
    }
    setLocating(true);
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      (result) => {
        const nextPosition = {
          latitude: result.coords.latitude,
          longitude: result.coords.longitude,
        };
        setPosition(nextPosition);
        const nearest = sortBranchesByDistance(branches, nextPosition)[0];
        if (nearest) setSelectedBranchId(nearest.id);
        setOpenMap(null);
        setLocating(false);
      },
      (error) => {
        setGeoError(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission was blocked. You can still open a branch map below.'
            : 'We could not read your location. Try again, or open a branch map.',
        );
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 120_000 },
    );
  }

  return (
    <section
      id="shop-contact-details"
      className="shop-contact-panel shop-branches-panel"
      aria-labelledby="shop-contact-title"
      hidden={!open}
      ref={panelRef}
      tabIndex={-1}
    >
      {/* The close control lives in the panel's top-right corner on every
          screen, clear of the title and the "Find nearest branch" action. */}
      <button
        type="button"
        className="shop-branches-close-icon"
        aria-label="Close contact details"
        title="Close"
        onClick={onClose}
      >
        <X size={18} aria-hidden="true" />
      </button>
      <header className="shop-branches-head">
        <div>
          <p className="shop-branches-eyebrow">Visit & contact</p>
          <h2 id="shop-contact-title">
            {branches.length > 1 ? 'Our branches' : 'Plan your visit'}
          </h2>
          <p className="shop-branches-lede">
            {branches.length > 1
              ? 'Pick the branch that suits you, then call, message, or open directions.'
              : 'Call ahead, send a message, or open the map before you go.'}
          </p>
        </div>
        <div className="shop-branches-tools">
          {mapped > 0 && (
            <>
              {position && (
                <span className="shop-geo-chip">
                  <Navigation size={13} aria-hidden="true" /> Nearest first
                </span>
              )}
              <button
                type="button"
                className="shop-near-me"
                onClick={locate}
                disabled={locating}
              >
                {locating ? (
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                ) : (
                  <Crosshair size={16} aria-hidden="true" />
                )}
                {locating
                  ? 'Finding you…'
                  : position
                    ? 'Update my location'
                    : 'Find nearest branch'}
              </button>
            </>
          )}
        </div>
      </header>

      {geoError && (
        <p className="shop-geo-note" role="status">
          {geoError}
        </p>
      )}

      {nearestBranch && nearestDistance !== undefined && (
        <p className="shop-geo-result" role="status">
          <Crosshair size={15} aria-hidden="true" />
          <span>
            Nearest branch is <strong>{nearestBranch.name}</strong>
            {` · ${formatDistance(nearestDistance)}`}
          </span>
        </p>
      )}

      {ordered.length > 1 && (
        <div className="shop-branch-picker">
          <label>
            <span>
              <MapPin size={14} aria-hidden="true" /> Choose a branch
            </span>
            <div className="shop-branch-select">
              <select
                value={selectedBranch?.id ?? ''}
                onChange={(event) => {
                  setSelectedBranchId(event.target.value);
                  setOpenMap(null);
                }}
              >
                {ordered.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                    {branch.isPrimary ? ' · Main' : ''}
                    {branch.city ? ` · ${branch.city}` : ''}
                    {branch.id === nearestBranchId ? ' · nearest' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </div>
          </label>
          <small>{ordered.length} branches · one shown at a time</small>
        </div>
      )}

      {ordered.length > 0 ? (
        <div
          className={`shop-branch-grid ${ordered.length === 1 ? 'is-single' : ''}`}
        >
          {ordered.map((branch) => (
            <BranchCard
              key={branch.id}
              storeName={store.name}
              branch={branch}
              position={position}
              active={branch.id === selectedBranch?.id}
              nearest={branch.id === nearestBranchId}
              openMap={openMap === branch.id}
              onToggleMap={() =>
                setOpenMap((current) =>
                  current === branch.id ? null : branch.id,
                )
              }
            />
          ))}
        </div>
      ) : (
        <div className="shop-branches-empty">
          <MapPin size={26} aria-hidden="true" />
          <h3>Contact details are on their way.</h3>
          <p>
            This shop hasn’t published a branch yet. Check back soon, or reach
            out through the social links above.
          </p>
        </div>
      )}

      {branches.length > 0 && (
        <footer className="shop-branches-foot">
          <span>Maps by OpenStreetMap</span>
          <button
            type="button"
            className="text-button shop-branches-close"
            onClick={onClose}
          >
            <X size={14} aria-hidden="true" /> Close details
          </button>
        </footer>
      )}
    </section>
  );
}
