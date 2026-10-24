import { useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Check, Coffee, Store as StoreIcon } from 'lucide-react';
import { storeMediaUrl, storePresentation } from '../../lib/storefront';
import { mutate, panelError } from '../shared/panel-api';
import { Notice, PageTitle, useUnsaved } from '../shared/PanelUI';
import { MediaUpload } from '../shared/MediaUpload';
import { useOwner, type OwnerStore } from './OwnerPanel';

const presets = [
  ['Forest', '#254e40'],
  ['Terracotta', '#994a2c'],
  ['Ocean', '#176b87'],
  ['Indigo', '#4c4c9d'],
  ['Rose', '#a13d63'],
  ['Charcoal', '#30363b'],
] as const;
export function StoreEditor({ store }: { store?: OwnerStore }) {
  const { summary, savedStore } = useOwner();
  const navigate = useNavigate();
  const [name, setName] = useState(store?.name || '');
  const [type, setType] = useState<'ecommerce' | 'restaurant_menu'>(
    store?.storeType || 'ecommerce',
  );
  const [color, setColor] = useState(store?.brandColor || '#254e40');
  const [description, setDescription] = useState(store?.description || '');
  const [logo, setLogo] = useState(store?.logoKey || '');
  const [banner, setBanner] = useState(store?.bannerKey || '');
  const [phone, setPhone] = useState(store?.location?.phone || '');
  const [city, setCity] = useState(store?.location?.city || '');
  const [country, setCountry] = useState(store?.location?.country || '');
  const [address, setAddress] = useState(store?.location?.address || '');
  const [cart, setCart] = useState(
    Boolean(store?.enableCart && summary.limits.enableCart),
  );
  const [whatsapp, setWhatsapp] = useState(
    Boolean(
      store?.enableWhatsAppCheckout && summary.limits.enableWhatsAppCheckout,
    ),
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const snapshot = JSON.stringify({
    name,
    type,
    color,
    description,
    logo,
    banner,
    phone,
    city,
    country,
    address,
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
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || uploading || processing) return;
    if (!name.trim()) {
      setError('Please enter a store name.');
      return;
    }
    const phoneDigits = phone.replace(/\D/g, '');
    if (store && whatsapp && !/^\d{7,15}$/.test(phoneDigits)) {
      setError(
        'Add a WhatsApp phone number with its country code, or turn off WhatsApp checkout.',
      );
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = {
        name: name.trim(),
        storeType: type,
        brandColor: color,
        ...(store
          ? {
              description: description.trim() || null,
              logoKey: logo || null,
              bannerKey: banner || null,
              enableCart: cart,
              enableWhatsAppCheckout: whatsapp,
              ...(phoneDigits
                ? {
                    socialMediaLinks: {
                      ...store.socialMediaLinks,
                      whatsapp: `https://wa.me/${phoneDigits}`,
                    },
                  }
                : {}),
              location: {
                phone: phone.trim() || null,
                city: city.trim() || null,
                country: country.trim() || null,
                address: address.trim() || null,
              },
            }
          : {}),
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
          store && (
            <Link className="panel-secondary" to={`/stores/${store.slug}`}>
              View store <ArrowUpRight size={16} />
            </Link>
          )
        }
      />
      <form onSubmit={(e) => void save(e)} className="panel-editor-layout">
        <div className="panel-form">
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
              <legend>What kind of store?</legend>
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
          </section>
          {store && (
            <>
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
                  disabled={busy || uploading || processing}
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
                  disabled={busy || uploading || processing}
                  maxImageBytes={
                    typeof summary.limits.maxImageSizeBytes === 'number'
                      ? summary.limits.maxImageSizeBytes
                      : undefined
                  }
                />
              </section>
              <details className="panel-card panel-optional">
                <summary>
                  About & contact <span>Optional</span>
                </summary>
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
                <label>
                  Phone / WhatsApp number
                  <input
                    type="tel"
                    maxLength={30}
                    value={phone}
                    placeholder="Include your country code"
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                  />
                </label>
                <div className="panel-two-fields">
                  <label>
                    City
                    <input
                      maxLength={100}
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      autoComplete="address-level2"
                    />
                  </label>
                  <label>
                    Country
                    <input
                      maxLength={100}
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      autoComplete="country-name"
                    />
                  </label>
                </div>
                <label>
                  Address
                  <input
                    maxLength={500}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    autoComplete="street-address"
                  />
                </label>
              </details>
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
                      ? 'Add your phone number above so customers can reach you.'
                      : 'Available with an eligible subscription.'}
                  </small>
                </label>
              </details>
            </>
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
                    : 'Your address is generated automatically'}
            </span>
            <button
              className="panel-primary"
              disabled={
                busy ||
                uploading ||
                processing ||
                (store ? !dirty : !name.trim())
              }
            >
              {busy ? 'Saving…' : store ? 'Save changes' : 'Create my store'}
            </button>
          </div>
        </div>
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
