import { createContext, useContext, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import {
  ArrowUpRight,
  BadgeCheck,
  ImagePlus,
  Package,
  Palette,
  Plus,
  Store as StoreIcon,
} from 'lucide-react';
import type { Store } from '../../lib/api';
import {
  storeMediaUrl,
  isStoreVerified,
  isCurrentStore,
  readOwnerStoreId,
  rememberOwnerStore,
  selectOwnerStore,
  storeStatusLabel,
  type StoreLifecycleStatus,
} from '../../lib/storefront';
import { getJson, dateLabel, type Session } from '../shared/panel-api';
import {
  Empty,
  Loading,
  Modal,
  PageTitle,
  PanelShell,
  Retry,
} from '../shared/PanelUI';
import { StoreEditor } from './StoreEditor.tsx';
import { OwnerContent } from './OwnerContent.tsx';
import { StoreManager } from './StoreManager';

export interface OwnerStore extends Store {
  status: StoreLifecycleStatus;
  trashedAt: string | null;
  restricted?: boolean;
  enableCart: boolean;
  enableWhatsAppCheckout: boolean;
}
export interface OwnerSummary {
  stats: Record<string, number>;
  limits: Record<string, number | string | boolean | null>;
  subscription: {
    planName: string;
    expiresAt: string | null;
    status: string;
  } | null;
  subscriptionState?: {
    state: 'trial' | 'paid' | 'expired';
    planName: string | null;
    planSlug: string | null;
    expiresAt: string | null;
    daysRemaining: number | null;
  };
}
interface OwnerState {
  session: Session;
  stores: OwnerStore[];
  store?: OwnerStore;
  summary: OwnerSummary;
  savedStore: (store: OwnerStore, lifecycle?: boolean) => Promise<void>;
}
const OwnerContext = createContext<OwnerState | null>(null);
export function useOwner() {
  const value = useContext(OwnerContext);
  if (!value) throw new Error('Owner workspace unavailable');
  return value;
}
export default function OwnerPanel({ session }: { session: Session }) {
  // This panel remounts on every tab change, so the chosen store is restored
  // from device storage instead of falling back to the first store.
  const [selected, setSelected] = useState(() =>
    readOwnerStoreId(window.localStorage, session.user.id),
  );
  const [pendingStore, setPendingStore] = useState('');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const stores = useQuery({
    queryKey: ['panel', session.user.id, 'my-stores'],
    queryFn: ({ signal }) =>
      getJson<OwnerStore[]>('stores/my?includeTrashed=true', signal),
  });
  const summary = useQuery({
    queryKey: ['panel', session.user.id, 'summary'],
    queryFn: ({ signal }) => getJson<OwnerSummary>('dashboard', signal),
  });
  const requested = params.get('store');
  useEffect(() => {
    if (!requested) return;
    setSelected(requested);
    rememberOwnerStore(window.localStorage, session.user.id, requested);
  }, [requested, session.user.id]);
  const available = stores.data ?? [];
  // An explicit ?store= link wins. A remembered store falls back to the
  // default once it is archived, trashed, or restricted.
  const store = requested
    ? selectOwnerStore(available, requested)
    : (selectOwnerStore(available, selected) ?? selectOwnerStore(available));
  const selectable = available.filter(
    (s) => !s.restricted && (isCurrentStore(s) || s.id === store?.id),
  );
  const pending = selectable.find((s) => s.id === pendingStore);
  function switchStore(id: string) {
    setSelected(id);
    rememberOwnerStore(window.localStorage, session.user.id, id);
    setParams((old) => {
      const next = new URLSearchParams(old);
      next.set('store', id);
      return next;
    });
    setPendingStore('');
  }
  async function savedStore(updated: OwnerStore, lifecycle = false) {
    const key = ['panel', session.user.id, 'my-stores'];
    await client.cancelQueries({ queryKey: key });
    client.setQueryData<OwnerStore[]>(key, (old) =>
      old?.some((s) => s.id === updated.id)
        ? old.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
        : [...(old ?? []), updated],
    );
    if (!lifecycle) {
      setSelected(updated.id);
      rememberOwnerStore(window.localStorage, session.user.id, updated.id);
    } else if (store?.id === updated.id && !isCurrentStore(updated)) {
      setSelected('');
      rememberOwnerStore(window.localStorage, session.user.id, null);
      navigate(
        `/dashboard/stores?tab=${updated.status === 'trashed' ? 'trashed' : 'archived'}`,
        { replace: true },
      );
    }
    await Promise.all(
      [
        'panel',
        'stores',
        'storefront',
        'storefront-products',
        'storefront-posts',
        'explore',
        'categories',
        'shop-cart',
      ].map((prefix) => client.invalidateQueries({ queryKey: [prefix] })),
    );
  }
  return (
    <PanelShell session={session}>
      {stores.isPending || summary.isPending ? (
        <Loading />
      ) : stores.isError || summary.isError ? (
        <Retry
          error={stores.error || summary.error}
          retry={() => {
            void stores.refetch();
            void summary.refetch();
          }}
        />
      ) : (
        <OwnerContext.Provider
          value={{
            session,
            stores: stores.data,
            store,
            summary: summary.data,
            savedStore,
          }}
        >
          {selectable.length > 1 && (
            <label className="panel-store-switch">
              Your store
              <select
                value={store?.id}
                onChange={(e) => {
                  if (e.target.value !== store?.id)
                    setPendingStore(e.target.value);
                }}
              >
                {selectable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {storeStatusLabel[s.status]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {pending && (
            <Modal
              title={`Switch to ${pending.name}?`}
              onClose={() => setPendingStore('')}
            >
              <p>
                {store
                  ? `You’re working in ${store.name}. Switching opens ${pending.name} instead.`
                  : `Switching opens ${pending.name}.`}
              </p>
              <p className="panel-muted">
                Save any changes to the current store first — unsaved edits are
                discarded when you switch. Your choice is remembered on this
                device.
              </p>
              <div className="store-lifecycle-actions">
                <button
                  type="button"
                  className="panel-secondary"
                  onClick={() => setPendingStore('')}
                >
                  Stay in {store?.name ?? 'the current store'}
                </button>
                <button
                  type="button"
                  className="panel-primary"
                  onClick={() => switchStore(pending.id)}
                >
                  Switch store
                </button>
              </div>
            </Modal>
          )}
          <PlanBanner />
          <Routes>
            <Route index element={<OwnerHome />} />
            <Route path="stores" element={<StoreManager />} />
            <Route path="store/new" element={<StoreEditor key="new" />} />
            <Route
              path="store"
              element={
                store ? (
                  <StoreEditor key={store.id} store={store} />
                ) : (
                  <NoStore />
                )
              }
            />
            <Route
              path="products"
              element={
                store ? (
                  <OwnerContent key={`products-${store.id}`} kind="products" />
                ) : (
                  <NoStore />
                )
              }
            />
            <Route
              path="posts"
              element={
                store ? (
                  <OwnerContent key={`posts-${store.id}`} kind="posts" />
                ) : (
                  <NoStore />
                )
              }
            />
            <Route path="plan" element={<OwnerPlan />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </OwnerContext.Provider>
      )}
    </PanelShell>
  );
}
function PlanBanner() {
  const { summary } = useOwner();
  const state = summary.subscriptionState;
  if (!state) return null;
  const expired = state.state === 'expired';
  const endingSoon =
    state.state === 'trial' &&
    state.daysRemaining != null &&
    state.daysRemaining <= 2;
  if (!expired && !endingSoon) return null;
  const days = state.daysRemaining ?? 0;
  return (
    <section className={`panel-plan-banner ${expired ? 'is-expired' : ''}`}>
      <div>
        <strong>
          {expired
            ? 'Your free trial has ended.'
            : `Your free trial ends in ${days} day${days === 1 ? '' : 's'}.`}
        </strong>
        <span>
          {expired
            ? 'Your published content is still online. Choose a plan to keep creating.'
            : 'Choose a paid plan to keep creating without interruption.'}
        </span>
      </div>
      <Link className="panel-primary" to="/pricing">
        Choose a plan <ArrowUpRight size={16} />
      </Link>
    </section>
  );
}
function NoStore() {
  return (
    <>
      <PageTitle
        title="Let's make it yours."
        description="Your store starts with a name. Everything else can come later."
      />
      <Empty title="A home for your business">
        <p>A shop, a menu, or your next big idea. You're in control.</p>
        <Link className="panel-secondary" to="/dashboard/stores">
          Manage stores, Archived, and Trash
        </Link>
        <Link className="panel-primary" to="/dashboard/store/new">
          <Plus size={18} /> Create my store
        </Link>
      </Empty>
    </>
  );
}
function OwnerHome() {
  const { store, session, summary } = useOwner();
  if (!store) return <NoStore />;
  return (
    <>
      <PageTitle
        eyebrow="YOUR PERSONAL STUDIO"
        title={`Welcome back, ${session.user.displayName.split(' ')[0] || 'there'}.`}
        description="A little update can make a big difference."
        action={
          store.status === 'active' ? (
            <Link className="panel-secondary" to={`/stores/${store.slug}`}>
              View my store <ArrowUpRight size={16} />
            </Link>
          ) : (
            <Link className="panel-secondary" to="/dashboard/stores">
              Manage store status
            </Link>
          )
        }
      />
      <section className="panel-store-hero">
        <div>
          <span className="panel-pill">
            YOUR STORE · {storeStatusLabel[store.status]}
          </span>
          <h2>
            {store.name} {isStoreVerified(store) && <BadgeCheck size={25} />}
          </h2>
          <p>
            {store.description ||
              'Your space to share what makes your business special.'}
          </p>
          <Link className="panel-primary" to="/dashboard/store">
            Make it yours <Palette size={17} />
          </Link>
        </div>
        <div
          className="panel-hero-art"
          style={
            {
              '--store-accent': store.brandColor || '#254e40',
            } as React.CSSProperties
          }
        >
          {store.logoKey ? (
            <img src={storeMediaUrl(store.logoKey)} alt={store.name} />
          ) : (
            <StoreIcon size={72} />
          )}
          <span>
            {store.storeType === 'restaurant_menu'
              ? 'Made to savor.'
              : 'Made by you.'}
          </span>
        </div>
      </section>
      <div className="panel-stats">
        {[
          ['Products', 'totalProducts'],
          ['Posts', 'totalPosts'],
          ['Photos & videos', 'totalMedia'],
        ].map(([label, key]) => (
          <div className="panel-stat" key={key}>
            <span>{label}</span>
            <strong>{summary.stats[key!] ?? 0}</strong>
            <small>Across your stores</small>
          </div>
        ))}
      </div>
      <h2 className="panel-section-title">What would you like to do?</h2>
      <div className="panel-quick-actions">
        <Link to="/dashboard/products">
          <Package />
          <strong>Add a product</strong>
          <span>Bring your collection or menu to life.</span>
          <ArrowUpRight />
        </Link>
        <Link to="/dashboard/posts">
          <ImagePlus />
          <strong>Share something new</strong>
          <span>A photo, a moment, a new arrival.</span>
          <ArrowUpRight />
        </Link>
        <Link to="/dashboard/store">
          <Palette />
          <strong>Refresh your look</strong>
          <span>Pick colors and upload your branding.</span>
          <ArrowUpRight />
        </Link>
      </div>
      <p className="panel-muted">
        Growing another business?{' '}
        <Link to="/dashboard/store/new">Create another store</Link>
      </p>
    </>
  );
}
function OwnerPlan() {
  const { summary, store } = useOwner();
  const state = summary.subscriptionState;
  const expired = state?.state === 'expired';
  const trial = state?.state === 'trial';
  const planName = expired
    ? 'Trial ended'
    : state?.planName || summary.subscription?.planName || 'Free';
  const planDetail = expired
    ? 'Published content stays online. Choose a paid plan to start creating again.'
    : trial && state?.daysRemaining != null
      ? `${state.daysRemaining} day${state.daysRemaining === 1 ? '' : 's'} left · ends ${dateLabel(state.expiresAt)}`
      : state?.expiresAt
        ? `Expires ${dateLabel(state.expiresAt)}`
        : state?.state === 'paid'
          ? 'No expiry'
          : summary.subscription
            ? `Expires ${dateLabel(summary.subscription.expiresAt)}`
            : 'A great place to start your business.';
  const limits = [
    ['Shops', 'maxShops', 'totalStores'],
    ['Categories', 'maxCategories', 'totalCategories'],
    ['Products', 'maxProducts', 'totalProducts'],
    ['Total posts', 'maxTotalPosts', 'totalPosts'],
  ] as const;
  return (
    <>
      <PageTitle
        title="Your plan, at a glance."
        description="Simple limits. No surprises."
      />
      <div className="panel-two-columns">
        <section className="panel-card panel-feature">
          <span className="panel-pill">
            {trial ? 'FREE TRIAL' : expired ? 'TRIAL ENDED' : 'CURRENT PLAN'}
          </span>
          <h2>{planName}</h2>
          <p>{planDetail}</p>
          {limits.map(([label, limit, used]) => (
            <div className="panel-usage" key={limit}>
              <span>{label}</span>
              <strong>
                {summary.stats[used] ?? 0} /{' '}
                {summary.limits[limit] == null
                  ? 'Unlimited'
                  : String(summary.limits[limit])}
              </strong>
            </div>
          ))}
          <Link className="panel-primary" to="/pricing">
            {expired ? 'Choose a paid plan' : 'Explore plans'}{' '}
            <ArrowUpRight size={16} />
          </Link>
          <small>
            {expired
              ? 'An administrator assigns paid plans. Your published content remains online.'
              : 'Subscriptions are assigned by an administrator. There is no automatic payment or checkout.'}
          </small>
        </section>
        <section className="panel-card panel-feature">
          <BadgeCheck size={32} />
          <h2>
            {isStoreVerified(store)
              ? 'Your store is verified.'
              : 'Build a trusted presence.'}
          </h2>
          <p>
            {isStoreVerified(store)
              ? 'Your verification badge is visible on your storefront.'
              : 'Verification is reviewed and granted by an administrator. A subscription alone does not verify your store.'}
          </p>
          <div className="panel-usage">
            <span>Shopping cart</span>
            <strong>
              {summary.limits.enableCart ? 'Included' : 'Not included'}
            </strong>
          </div>
          <div className="panel-usage">
            <span>WhatsApp checkout</span>
            <strong>
              {summary.limits.enableWhatsAppCheckout
                ? 'Included'
                : 'Not included'}
            </strong>
          </div>
        </section>
      </div>
    </>
  );
}
