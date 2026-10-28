import './ShopSettings.css';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  BadgeCheck,
  ImagePlus,
  Layers,
  Megaphone,
  Palette,
  ReceiptText,
  ShoppingBag,
  Wallet,
} from 'lucide-react';
import { useWebsiteSettings } from '../../hooks/useWebsiteSettings';
import { mutate, panelError } from '../shared/panel-api';
import { Notice, PageTitle, useUnsaved } from '../shared/PanelUI';
import { useOwner, type OwnerStore } from './OwnerPanel';

// Order messages follow the branch the customer picks; the social link is the
// fallback. The settings page only warns, the API keeps the real gate.
function hasOrderWhatsApp(store: OwnerStore) {
  const digits = (value: string | null | undefined) =>
    value?.replace(/\D/gu, '') ?? '';
  if (/^\d{7,15}$/u.test(digits(store.socialMediaLinks?.whatsapp))) return true;
  return (store.branches ?? []).some((branch) =>
    /^\d{7,15}$/u.test(digits(branch.whatsapp)),
  );
}

// Every other owner setting is one tap away, so this page doubles as the
// dashboard's settings hub instead of hiding features in separate editors.
const relatedSettings = [
  {
    to: '/dashboard/store',
    title: 'Store profile & photos',
    text: 'Name, logo, cover, branches and social links.',
    Icon: ImagePlus,
  },
  {
    to: '/dashboard/design',
    title: 'Shop design',
    text: 'Layouts, type and a style for each section.',
    Icon: Palette,
  },
  {
    to: '/dashboard/products',
    title: 'Products / menu',
    text: 'Items, prices, options and stock.',
    Icon: ReceiptText,
  },
  {
    to: '/dashboard/posts',
    title: 'Posts',
    text: 'Photos, videos and captions on your wall.',
    Icon: ImagePlus,
  },
  {
    to: '/dashboard/boost',
    title: 'Boost',
    text: 'Reach more people with your best posts.',
    Icon: Megaphone,
  },
  {
    to: '/dashboard/plan',
    title: 'My plan',
    text: 'Allowances, trial and verification.',
    Icon: BadgeCheck,
  },
];

function SettingsEditor({ store }: { store: OwnerStore }) {
  const { summary, savedStore } = useOwner();
  const { settings } = useWebsiteSettings(false);
  // Plan flags arrive as booleans, but an older API may omit them: only an
  // explicit true unlocks the feature.
  const cartIncluded = summary.limits.enableCart === true;
  const checkoutIncluded = summary.limits.enableWhatsAppCheckout === true;
  const [cart, setCart] = useState(Boolean(store.enableCart));
  const [whatsapp, setWhatsapp] = useState(
    Boolean(store.enableWhatsAppCheckout),
  );
  const [lbp, setLbp] = useState(Boolean(store.showPricesInLbp));
  const [postsSection, setPostsSection] = useState(
    store.enablePostsSection !== false,
  );
  const [productsSection, setProductsSection] = useState(
    store.enableProductsSection !== false,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const snapshot = JSON.stringify({
    cart,
    whatsapp,
    lbp,
    postsSection,
    productsSection,
  });
  const [baseline, setBaseline] = useState(snapshot);
  const dirty = snapshot !== baseline;
  useUnsaved(dirty);

  const itemLabel =
    store.storeType === 'restaurant_menu' ? 'menu items' : 'products';
  const sectionName =
    store.storeType === 'restaurant_menu' ? 'Menu' : 'Products';
  const sections = summary.sections;
  const postsUsage = sections?.posts;
  const productsUsage = sections?.products;
  const orderWhatsAppMissing = whatsapp && !hasOrderWhatsApp(store);

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (busy || !dirty) return;
    // Send only what changed: re-sending a saved feature the plan no longer
    // includes would be rejected instead of leaving the shop untouched.
    const patch: Record<string, boolean> = {};
    if (cart !== Boolean(store.enableCart)) patch.enableCart = cart;
    if (whatsapp !== Boolean(store.enableWhatsAppCheckout))
      patch.enableWhatsAppCheckout = whatsapp;
    if (lbp !== Boolean(store.showPricesInLbp)) patch.showPricesInLbp = lbp;
    if (postsSection !== (store.enablePostsSection !== false))
      patch.enablePostsSection = postsSection;
    if (productsSection !== (store.enableProductsSection !== false))
      patch.enableProductsSection = productsSection;
    if (!Object.keys(patch).length) {
      setBaseline(snapshot);
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await mutate<OwnerStore>(
        `stores/${encodeURIComponent(store.slug)}`,
        patch,
        'PATCH',
      );
      await savedStore(updated);
      setCart(Boolean(updated.enableCart));
      setWhatsapp(Boolean(updated.enableWhatsAppCheckout));
      setLbp(Boolean(updated.showPricesInLbp));
      setPostsSection(updated.enablePostsSection !== false);
      setProductsSection(updated.enableProductsSection !== false);
      setBaseline(snapshot);
      setNotice('Saved. Your shop now uses these settings.');
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="SHOP SETTINGS"
        title="Everything your shop does."
        description="Checkout, currency and sections in one place. Changes go live as soon as you save."
        action={
          store.status === 'active' && (
            <Link className="panel-secondary" to={`/stores/${store.slug}`}>
              View my shop <ArrowUpRight size={16} />
            </Link>
          )
        }
      />
      <form
        className="panel-form shop-settings"
        onSubmit={(event) => void save(event)}
      >
        <div className="shop-settings-main">
          <section className="panel-card shop-settings-card">
            <header className="shop-settings-head">
              <span className="shop-settings-icon">
                <ShoppingBag size={18} />
              </span>
              <div>
                <h2>Cart &amp; checkout</h2>
                <p className="panel-muted">
                  How customers collect items and send you their order.
                </p>
              </div>
            </header>
            <label className="panel-toggle">
              <input
                type="checkbox"
                checked={cart}
                disabled={busy || (!cartIncluded && !cart)}
                onChange={(event) => setCart(event.target.checked)}
              />
              Shopping cart
              <small>
                {cartIncluded
                  ? 'Let visitors collect their favourite items before ordering.'
                  : 'Not included in your current plan. Choose a plan to turn it on.'}
              </small>
            </label>
            <label className="panel-toggle">
              <input
                type="checkbox"
                checked={whatsapp}
                disabled={busy || (!checkoutIncluded && !whatsapp)}
                onChange={(event) => setWhatsapp(event.target.checked)}
              />
              WhatsApp checkout
              <small>
                {checkoutIncluded
                  ? 'Each order goes to the branch your customer chooses.'
                  : 'Available with an eligible subscription.'}
              </small>
            </label>
            {orderWhatsAppMissing && (
              <p className="panel-field-error">
                No WhatsApp number reaches this shop yet. Add one to a branch or
                set the order link under Social links —{' '}
                <Link to="/dashboard/store">open store profile</Link>.
              </p>
            )}
            {(!cartIncluded || !checkoutIncluded) && (
              <p className="panel-muted">
                <Link to="/dashboard/plan">See what your plan includes</Link>.
              </p>
            )}
          </section>
          <section className="panel-card shop-settings-card">
            <header className="shop-settings-head">
              <span className="shop-settings-icon">
                <Wallet size={18} />
              </span>
              <div>
                <h2>Prices</h2>
                <p className="panel-muted">
                  Items stay priced in US dollars; the LBP line is a display
                  helper.
                </p>
              </div>
            </header>
            <label className="panel-toggle">
              <input
                type="checkbox"
                checked={lbp}
                disabled={busy || (!settings.lbpExchangeRate && !lbp)}
                onChange={(event) => setLbp(event.target.checked)}
              />
              Show prices in Lebanese pounds
              <small>
                {settings.lbpExchangeRate
                  ? `${new Intl.NumberFormat('en-US').format(
                      settings.lbpExchangeRate,
                    )} LBP = $1. Matjary sets this rate.`
                  : 'You can turn this on once Matjary sets the LBP exchange rate.'}
              </small>
            </label>
          </section>
          <section className="panel-card shop-settings-card">
            <header className="shop-settings-head">
              <span className="shop-settings-icon">
                <Layers size={18} />
              </span>
              <div>
                <h2>Shop sections</h2>
                <p className="panel-muted">
                  Turn off a section you don’t use. Its unused plan allowance
                  moves to the section that stays on.
                </p>
              </div>
            </header>
            <label className="panel-toggle">
              <input
                type="checkbox"
                checked={postsSection}
                disabled={busy || !productsSection}
                onChange={(event) => setPostsSection(event.target.checked)}
              />
              Posts
              <small>
                The photo and video wall on your shop page. Turning it off gives
                its unused allowance to your {itemLabel}.
              </small>
            </label>
            <label className="panel-toggle">
              <input
                type="checkbox"
                checked={productsSection}
                disabled={busy || !postsSection}
                onChange={(event) => setProductsSection(event.target.checked)}
              />
              {sectionName}
              <small>
                Your {itemLabel}. Turning it off gives its unused allowance to
                Posts.
              </small>
            </label>
            <div className="shop-settings-usage">
              <div className="panel-usage">
                <span>Posts · your plan</span>
                <strong>
                  {postsSection
                    ? `${postsUsage?.used ?? summary.stats.totalPosts ?? 0} / ${
                        postsUsage?.limit ?? 'Unlimited'
                      }`
                    : 'Section off'}
                </strong>
              </div>
              <div className="panel-usage">
                <span>{sectionName} · your plan</span>
                <strong>
                  {productsSection
                    ? `${productsUsage?.used ?? summary.stats.totalProducts ?? 0} / ${
                        productsUsage?.limit ?? 'Unlimited'
                      }`
                    : 'Section off'}
                </strong>
              </div>
            </div>
            {(!postsSection || !productsSection) && (
              <p className="panel-muted">
                Turning a section back on only works while the combined
                allowance has room. If it’s full, delete some items first.
              </p>
            )}
          </section>
          {error && <Notice error>{error}</Notice>}
          {notice && <Notice>{notice}</Notice>}
          <div className="panel-save-bar">
            <span>
              {dirty ? 'You have unsaved changes' : 'Everything is up to date'}
            </span>
            <button className="panel-primary" disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
        <aside className="shop-settings-aside">
          <section className="panel-card">
            <h2>Everything else</h2>
            <nav className="shop-settings-links">
              {relatedSettings.map(({ to, title, text, Icon }) => (
                <Link key={to} to={to}>
                  <Icon size={17} />
                  <div>
                    <strong>{title}</strong>
                    <span>{text}</span>
                  </div>
                  <ArrowUpRight size={15} />
                </Link>
              ))}
            </nav>
          </section>
          <p className="panel-muted shop-settings-tip">
            Cart, checkout, prices and sections belong to{' '}
            <strong>{store.name}</strong>. Switching shops shows that shop’s
            settings.
          </p>
        </aside>
      </form>
    </>
  );
}

export function ShopSettings() {
  const { store } = useOwner();
  if (!store) return null;
  return <SettingsEditor key={store.id} store={store} />;
}
