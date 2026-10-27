import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Check,
  Coffee,
  MapPin,
  Store as StoreIcon,
} from 'lucide-react';
import { getJson, type ShopCategoryCatalog } from '../../lib/api';
import {
  storeMediaUrl,
  storePresentation,
  storeStatusLabel,
} from '../../lib/storefront';
import {
  isGoogleMapsUrl,
  timeInputToMinutes,
  weekDays,
} from '../../lib/branches';
import { mutate, panelError } from '../shared/panel-api';
import { Notice, PageTitle, useUnsaved } from '../shared/PanelUI';
import { MediaUpload } from '../shared/MediaUpload';
import { SocialIcon, socialNetworks } from '../../components/SocialIcon';
import { useOwner, type OwnerStore } from './OwnerPanel';
import { StoreLifecycleControls } from './StoreManager';
import {
  StoreBranchesEditor,
  branchPayload,
  branchWhatsAppDigits,
  emptyBranchDraft,
  toBranchDraft,
  type BranchDraft,
} from './StoreBranchesEditor';

const presets = [
  ['Forest', '#254e40'],
  ['Terracotta', '#994a2c'],
  ['Ocean', '#176b87'],
  ['Indigo', '#4c4c9d'],
  ['Rose', '#a13d63'],
  ['Charcoal', '#30363b'],
] as const;

const socialHosts: Record<string, string> = {
  instagram: 'instagram.com',
  facebook: 'facebook.com',
  twitter: 'x.com',
  tiktok: 'tiktok.com',
  youtube: 'youtube.com',
  telegram: 't.me',
};

function initialSocials(store?: OwnerStore): Record<string, string> {
  const saved = store?.socialMediaLinks ?? {};
  return Object.fromEntries(
    socialNetworks.map(({ network }) => [
      network,
      typeof saved[network] === 'string' ? saved[network] : '',
    ]),
  );
}

function legacyBranch(store: OwnerStore): BranchDraft | undefined {
  const location = store.location;
  if (!location) return undefined;
  const whatsapp = store.socialMediaLinks?.whatsapp?.replace(/\D/gu, '') ?? '';
  const draft = toBranchDraft({
    id: '',
    name:
      location.locationName ||
      location.city ||
      location.address ||
      'Main location',
    address: location.address ?? null,
    city: location.city ?? null,
    country: location.country ?? null,
    postalCode: null,
    latitude: location.latitude ?? null,
    longitude: location.longitude ?? null,
    phone: location.phone ?? null,
    whatsapp: /^\d{7,15}$/u.test(whatsapp) ? whatsapp : null,
    openingHours: location.openingHours ?? null,
    isPrimary: true,
  });
  return { ...draft, key: 'legacy-branch' };
}

function initialBranches(store?: OwnerStore): BranchDraft[] {
  if (store?.branches?.length) return store.branches.map(toBranchDraft);
  const legacy = store ? legacyBranch(store) : undefined;
  if (legacy) return [legacy];
  // New shops start with one friendly draft; existing shops can add branches.
  return store ? [] : [emptyBranchDraft(true)];
}

function normalizeSocialUrl(network: string, raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (network === 'whatsapp' && /^[+\d\s().-]+$/u.test(value)) {
    const digits = value.replace(/\D/gu, '');
    return /^\d{7,15}$/u.test(digits) ? `https://wa.me/${digits}` : undefined;
  }
  if (/^https?:\/\//iu.test(value)) return value;
  if (network === 'website' || value.includes('.'))
    return `https://${value.replace(/^\/+/u, '')}`;
  const host = socialHosts[network];
  if (!host) return undefined;
  const handle = value.replace(/^@/u, '').replace(/^\/+/u, '');
  return handle ? `https://${host}/${handle}` : undefined;
}

export function StoreEditor({ store }: { store?: OwnerStore }) {
  const { summary, savedStore } = useOwner();
  const navigate = useNavigate();
  const [name, setName] = useState(store?.name || '');
  const [type, setType] = useState<'ecommerce' | 'restaurant_menu'>(
    store?.storeType || 'ecommerce',
  );
  const [businessCategory, setBusinessCategory] = useState(
    store?.businessCategory || '',
  );
  const [catalog, setCatalog] = useState<ShopCategoryCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [color, setColor] = useState(store?.brandColor || '#254e40');
  const [description, setDescription] = useState(store?.description || '');
  const [logo, setLogo] = useState(store?.logoKey || '');
  const [banner, setBanner] = useState(store?.bannerKey || '');
  const [socials, setSocials] = useState<Record<string, string>>(() =>
    initialSocials(store),
  );
  const [branches, setBranches] = useState<BranchDraft[]>(() =>
    initialBranches(store),
  );
  const [cart, setCart] = useState(
    Boolean(store?.enableCart && summary.limits.enableCart),
  );
  const [whatsapp, setWhatsapp] = useState(
    Boolean(
      store?.enableWhatsAppCheckout && summary.limits.enableWhatsAppCheckout,
    ),
  );
  const [busy, setBusy] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const branchDrafts = branches.filter(
    (branch) =>
      branch.name.trim() ||
      branch.address.trim() ||
      branch.city.trim() ||
      branch.phone.trim() ||
      branch.whatsapp.trim() ||
      branch.googleMapsUrl.trim() ||
      branch.latitude !== null ||
      branch.longitude !== null,
  );

  // The catalog is static and public, so the editor can load it before the
  // owner has saved anything (a new shop has no id yet).
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setCatalogError('');
    getJson<ShopCategoryCatalog>('stores/categories', controller.signal)
      .then((data) => {
        if (active) setCatalog(data);
      })
      .catch(() => {
        if (active)
          setCatalogError(
            'Shop types could not load. Check your connection and try again.',
          );
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [catalogAttempt]);
  const snapshot = JSON.stringify({
    name,
    type,
    businessCategory,
    color,
    description,
    logo,
    banner,
    socials,
    branches: branchDrafts.map((branch) => branchPayload(branch)),
    cart,
    whatsapp,
  });
  const [baseline, setBaseline] = useState(snapshot);
  const dirty = snapshot !== baseline;
  useUnsaved(dirty || uploading || processing);
  const presentation = storePresentation({
    storeType: type,
    brandColor: color,
  });
  const socialEntries = socialNetworks.map((entry) => ({
    ...entry,
    value: socials[entry.network] ?? '',
  }));
  const storeOrderWhatsApp = normalizeSocialUrl(
    'whatsapp',
    socials.whatsapp ?? '',
  );
  const branchWhatsAppMissing =
    whatsapp &&
    !storeOrderWhatsApp &&
    !branchDrafts.some((branch) =>
      /^\d{7,15}$/u.test(branchWhatsAppDigits(branch.whatsapp)),
    );

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || lifecycleBusy || uploading || processing) return;
    if (!name.trim()) {
      setError('Please enter a store name.');
      return;
    }
    if (!businessCategory) {
      setError('Choose the business category that fits your shop.');
      return;
    }
    for (const [index, branch] of branchDrafts.entries()) {
      if (!branch.name.trim()) {
        setError(`Branch ${index + 1} needs a name.`);
        return;
      }
      if (
        branch.whatsapp.trim() &&
        (!/^[+\d\s().-]+$/u.test(branch.whatsapp.trim()) ||
          !/^\d{7,15}$/u.test(branchWhatsAppDigits(branch.whatsapp)))
      ) {
        setError(
          `Branch ${index + 1}: add a WhatsApp number with its country code, or leave it empty.`,
        );
        return;
      }
      if (
        branch.phone.trim() &&
        !/^[+\d\s().-]{7,30}$/u.test(branch.phone.trim())
      ) {
        setError(`Branch ${index + 1}: check the phone number.`);
        return;
      }
      const mapsLink = branch.googleMapsUrl.trim();
      if (mapsLink && !isGoogleMapsUrl(mapsLink)) {
        setError(
          `Branch ${index + 1}: enter a valid Google Maps link, or clear it.`,
        );
        return;
      }
      if (
        mapsLink &&
        branch.latitude === null &&
        !branch.address.trim() &&
        !branch.city.trim()
      ) {
        setError(
          `Branch ${index + 1}: use the Google Maps link to set the pin, or add the address.`,
        );
        return;
      }
      for (const day of weekDays) {
        const hours = branch.hours[day.key];
        if (
          hours.open &&
          (timeInputToMinutes(hours.from) === null ||
            timeInputToMinutes(hours.to) === null)
        ) {
          setError(
            `Branch ${index + 1}: add valid ${day.label.toLowerCase()} hours, or mark the day closed.`,
          );
          return;
        }
      }
    }
    const socialMediaLinks: Record<string, string> = {};
    for (const entry of socialEntries) {
      const href = normalizeSocialUrl(entry.network, entry.value);
      if (entry.value.trim() && !href) {
        setError(`Enter a valid link for ${entry.label}.`);
        return;
      }
      if (href) socialMediaLinks[entry.network] = href;
    }
    if (whatsapp && branchWhatsAppMissing) {
      setError(
        'Add a WhatsApp number to a branch, or set the order WhatsApp link under Social links, so customers can send orders.',
      );
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const branchBodies = branchDrafts.map((branch) => branchPayload(branch));
      const body = {
        name: name.trim(),
        storeType: type,
        businessCategory,
        brandColor: color,
        description: description.trim() || null,
        socialMediaLinks,
        ...(store
          ? {
              logoKey: logo || null,
              bannerKey: banner || null,
              enableCart: cart,
              enableWhatsAppCheckout: whatsapp,
            }
          : {}),
        ...(store || branchBodies.length ? { branches: branchBodies } : {}),
      };
      const updated = await mutate<OwnerStore>(
        store ? `stores/${encodeURIComponent(store.slug)}` : 'stores',
        body,
        store ? 'PATCH' : 'POST',
      );
      setBaseline(snapshot);
      await savedStore(updated);
      setNotice('Your store has been saved.');
      if (!store) navigate('/dashboard/store', { replace: true });
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle
        eyebrow={store ? 'YOUR STORE' : 'A SIMPLE FIRST STEP'}
        title={store ? 'Make it feel like you.' : "Let's open your store."}
        description={
          store
            ? 'A few thoughtful touches. A space that is entirely yours.'
            : 'Just a name and a store type. You can add everything else later.'
        }
        action={
          store &&
          store.status === 'active' && (
            <Link className="panel-secondary" to={`/stores/${store.slug}`}>
              View store <ArrowUpRight size={16} />
            </Link>
          )
        }
      />
      {store && (
        <section className="panel-card store-lifecycle-panel">
          <div className="store-lifecycle-actions">
            <strong>Store status</strong>
            <span className="panel-pill">{storeStatusLabel[store.status]}</span>
            <Link to="/dashboard/stores">All my stores</Link>
          </div>
          {store.status !== 'active' && (
            <p className="panel-muted">
              Hidden from visitors. Your edits stay private until you turn this
              store on.
            </p>
          )}
          <StoreLifecycleControls
            store={store}
            disabled={busy || uploading || processing}
            dirty={dirty}
            onBusyChange={setLifecycleBusy}
          />
        </section>
      )}
      <form onSubmit={(e) => void save(e)} className="panel-editor-layout">
        <fieldset
          className="panel-form store-editor-fields"
          disabled={busy || lifecycleBusy}
        >
          <section className="panel-card">
            <h2>The essentials</h2>
            <label>
              Store name
              <input
                required
                maxLength={200}
                value={name}
                placeholder="e.g. Olive & Oak"
                onChange={(e) => setName(e.target.value)}
                autoComplete="organization"
              />
            </label>
            <fieldset>
              <legend>How should your shop look?</legend>
              <div className="panel-type-options">
                {(
                  [
                    [
                      'ecommerce',
                      'Shop',
                      'Products, collections, and great finds.',
                    ],
                    [
                      'restaurant_menu',
                      'Restaurant / café',
                      'A delicious menu, easy to explore.',
                    ],
                  ] as const
                ).map(([value, title, text]) => (
                  <label
                    className={`panel-choice ${type === value ? 'selected' : ''}`}
                    key={value}
                  >
                    <input
                      type="radio"
                      name="store-type"
                      value={value}
                      checked={type === value}
                      onChange={() => setType(value)}
                    />
                    {value === 'ecommerce' ? <StoreIcon /> : <Coffee />}
                    <strong>{title}</strong>
                    <span>{text}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </section>
          <section className="panel-card">
            <h2>Where should people find you?</h2>
            <p className="panel-muted">
              Your business category powers the shop-type filters and the “For
              you” ranking. You can change it anytime.
            </p>
            {catalogError ? (
              <Notice error>
                {catalogError}{' '}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setCatalogAttempt((attempt) => attempt + 1)}
                >
                  Retry
                </button>
              </Notice>
            ) : (
              <label>
                Business category
                <select
                  required
                  value={businessCategory}
                  disabled={!catalog}
                  onChange={(event) => setBusinessCategory(event.target.value)}
                >
                  <option value="">
                    {catalog ? 'Choose a category…' : 'Loading categories…'}
                  </option>
                  {catalog?.groups.map((group) => (
                    <optgroup key={group.slug} label={group.label}>
                      {catalog.categories
                        .filter((category) => category.group === group.slug)
                        .map((category) => (
                          <option key={category.slug} value={category.slug}>
                            {category.label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
          </section>
          <section className="panel-card">
            <h2>Your signature color</h2>
            <p className="panel-muted">
              Pick a palette. We take care of readable text and matching
              accents.
            </p>
            <div className="panel-swatches">
              {presets.map(([label, value]) => (
                <button
                  type="button"
                  key={value}
                  title={label}
                  aria-label={`${label} color`}
                  aria-pressed={color === value}
                  onClick={() => setColor(value)}
                >
                  <span style={{ backgroundColor: value }}>
                    {color === value && <Check size={19} color="white" />}
                  </span>
                  {label}
                </button>
              ))}
            </div>
            <label className="panel-color-picker">
              Or choose your own
              <input
                type="color"
                value={color.length === 7 ? color : '#254e40'}
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
            <p className="panel-muted">
              Want layouts, type and a style for each menu section?{' '}
              <Link to="/dashboard/design">Open shop design</Link>.
            </p>
          </section>
          {store && (
            <section className="panel-card">
              <h2>Give your store a face</h2>
              <p className="panel-muted">
                Optional. Your initials and chosen color look great too.
              </p>
              <MediaUpload
                targetId={store.id}
                purpose="store_logo"
                label="Store logo"
                keys={logo ? [logo] : []}
                onChange={(keys) => setLogo(keys[0] || '')}
                onBusy={setUploading}
                onPending={setProcessing}
                disabled={busy || lifecycleBusy || uploading || processing}
                maxImageBytes={
                  typeof summary.limits.maxImageSizeBytes === 'number'
                    ? summary.limits.maxImageSizeBytes
                    : undefined
                }
              />
              <MediaUpload
                targetId={store.id}
                purpose="store_banner"
                label="Cover photo"
                keys={banner ? [banner] : []}
                onChange={(keys) => setBanner(keys[0] || '')}
                onBusy={setUploading}
                onPending={setProcessing}
                disabled={busy || lifecycleBusy || uploading || processing}
                maxImageBytes={
                  typeof summary.limits.maxImageSizeBytes === 'number'
                    ? summary.limits.maxImageSizeBytes
                    : undefined
                }
              />
            </section>
          )}
          <section className="panel-card panel-optional store-description-card">
            <h2>About your store</h2>
            <label>
              A little about your store
              <textarea
                maxLength={3000}
                rows={3}
                value={description}
                placeholder="What makes your business special?"
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </section>
          <StoreBranchesEditor
            branches={branches}
            onChange={setBranches}
            disabled={busy || lifecycleBusy || uploading || processing}
          />
          <section className="panel-card store-socials-card">
            <div className="store-socials-heading">
              <div>
                <h2>Social links</h2>
                <p className="panel-muted">
                  These icons appear on your shop page. Use full links or just
                  your handle.
                </p>
              </div>
              <div className="store-socials-preview" aria-hidden="true">
                {socialEntries
                  .filter((entry) => entry.value.trim())
                  .map((entry) => (
                    <span key={entry.network} title={entry.label}>
                      <SocialIcon network={entry.network} size={16} />
                    </span>
                  ))}
              </div>
            </div>
            <div className="store-socials-fields">
              {socialEntries.map((entry) => (
                <label key={entry.network}>
                  <span>
                    <SocialIcon network={entry.network} size={15} />
                    {entry.label}
                  </span>
                  <input
                    type="text"
                    value={entry.value}
                    placeholder={entry.placeholder}
                    inputMode={entry.network === 'whatsapp' ? 'tel' : 'url'}
                    autoComplete="url"
                    onChange={(event) =>
                      setSocials((current) => ({
                        ...current,
                        [entry.network]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <p className="panel-muted store-socials-hint">
              <MapPin size={14} /> Tip: if no branch has a WhatsApp number, the
              order WhatsApp link here receives checkout messages.
            </p>
          </section>
          {store && (
            <details className="panel-card panel-optional">
              <summary>
                Shopping options <span>Optional</span>
              </summary>
              <label className="panel-toggle">
                <input
                  type="checkbox"
                  checked={cart}
                  disabled={!summary.limits.enableCart}
                  onChange={(e) => setCart(e.target.checked)}
                />
                Enable shopping cart{' '}
                <small>
                  {summary.limits.enableCart
                    ? 'Let visitors collect their favorite items.'
                    : 'Not included in your current plan.'}
                </small>
              </label>
              <label className="panel-toggle">
                <input
                  type="checkbox"
                  checked={whatsapp}
                  disabled={!summary.limits.enableWhatsAppCheckout}
                  onChange={(e) => setWhatsapp(e.target.checked)}
                />
                Enable WhatsApp checkout{' '}
                <small>
                  {summary.limits.enableWhatsAppCheckout
                    ? 'Each order goes to the branch your customer chooses.'
                    : 'Available with an eligible subscription.'}
                </small>
              </label>
              {whatsapp && branchWhatsAppMissing && (
                <p className="panel-field-error">
                  Add a WhatsApp number to at least one branch, or set the order
                  WhatsApp link above, before customers can check out.
                </p>
              )}
            </details>
          )}
          {error && <Notice error>{error}</Notice>}
          {notice && <Notice>{notice}</Notice>}
          <div className="panel-save-bar">
            <span>
              {uploading
                ? 'Finishing your upload…'
                : dirty
                  ? 'You have unsaved changes'
                  : store
                    ? 'Everything is up to date'
                    : 'You can add branches and social links anytime'}
            </span>
            <button
              className="panel-primary"
              disabled={
                busy ||
                uploading ||
                processing ||
                (store ? !dirty : !name.trim() || !businessCategory)
              }
            >
              {busy ? 'Saving…' : store ? 'Save changes' : 'Create my store'}
            </button>
          </div>
        </fieldset>
        <aside className="panel-live-preview">
          <p className="panel-eyebrow">LIVE PREVIEW</p>
          <div
            className="panel-shop-preview"
            style={presentation.theme as CSSProperties}
          >
            <div className="panel-preview-cover">
              {banner ? (
                <img src={storeMediaUrl(banner)} alt="Cover preview" />
              ) : (
                <span>Welcome to something special.</span>
              )}
            </div>
            <div className="panel-preview-body">
              <div className="panel-preview-logo">
                {logo ? (
                  <img src={storeMediaUrl(logo)} alt="Logo preview" />
                ) : (
                  name.slice(0, 1) || 'M'
                )}
              </div>
              <small>{presentation.label}</small>
              <h2>{name || 'Your store name'}</h2>
              <p>{description || 'A little home for what you do best.'}</p>
              {branchDrafts.length > 0 && (
                <span className="panel-preview-branches">
                  <MapPin size={12} />
                  {branchDrafts.length}{' '}
                  {branchDrafts.length === 1 ? 'branch' : 'branches'}
                </span>
              )}
              <span className="panel-preview-button">
                {presentation.catalogAction}
              </span>
              <div className="panel-preview-products">
                <div />
                <div />
                <div />
              </div>
            </div>
          </div>
          <p className="panel-muted">
            Your store, your style. This preview uses the same colors as your
            live storefront.
          </p>
        </aside>
      </form>
    </>
  );
}
