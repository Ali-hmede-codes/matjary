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
  Megaphone,
  Package,
  Palette,
  Plus,
  Settings2,
  Store as StoreIcon,
  Users,
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
import {
  getJson,
  dateLabel,
  mutate,
  panelError,
  type Session,
} from '../shared/panel-api';
import {
  Empty,
  Loading,
  Modal,
  Notice,
  PageTitle,
  PanelShell,
  Retry,
} from '../shared/PanelUI';
import { StoreEditor } from './StoreEditor.tsx';
import { StoreDesignStudio } from './StoreDesignStudio';
import { ShopSettings } from './ShopSettings';
import { OwnerContent } from './OwnerContent.tsx';
import { OwnerBoost } from './OwnerBoost';
import { OwnerVerification } from './OwnerVerification';
import { StoreManager } from './StoreManager';
import { TeamPanel } from './TeamPanel';

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
  // Effective allowance per content section after a turned-off section donates
  // its unused plan quota. Older API responses may omit this block.
  sections?: {
    posts: { enabled: boolean; used: number; limit: number | null };
    products: { enabled: boolean; used: number; limit: number | null };
  };
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
  removedStore: (store: OwnerStore) => Promise<void>;
}
interface TeamInvitationSummary {
  id: string;
  store: { id: string; name: string; slug: string; logoKey: string | null };
  invitedByName: string;
  expiresAt: string;
}
const panelQueryPrefixes = [
  'panel',
  'stores',
  'storefront',
  'storefront-products',
  'storefront-posts',
  'explore',
  'categories',
  'shop-cart',
];
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
  const refresh = () =>
    Promise.all(
      panelQueryPrefixes.map((prefix) =>
        client.invalidateQueries({ queryKey: [prefix] }),
      ),
    );
  const stores = useQuery({
    queryKey: ['panel', session.user.id, 'my-stores'],
    queryFn: ({ signal }) =>
      getJson<OwnerStore[]>('stores/my?includeTrashed=true', signal),
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
  const member = store?.teamRole === 'member';
  // A member's summary is scoped to the shop they help with; its plan belongs
  // to the owner, so the request asks for that shop explicitly.
  const summary = useQuery({
    queryKey: ['panel', session.user.id, 'summary', member ? store!.id : 'all'],
    queryFn: ({ signal }) =>
      getJson<OwnerSummary>(
        member
          ? `dashboard?storeId=${encodeURIComponent(store!.id)}`
          : 'dashboard',
        signal,
      ),
    enabled: stores.isSuccess,
  });
  const invitations = useQuery({
    queryKey: ['panel', session.user.id, 'team-invitations'],
    queryFn: ({ signal }) =>
      getJson<TeamInvitationSummary[]>('team/invitations', signal),
  });
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
    await refresh();
  }
  async function removedStore(removed: OwnerStore) {
    const key = ['panel', session.user.id, 'my-stores'];
    await client.cancelQueries({ queryKey: key });
    client.setQueryData<OwnerStore[]>(key, (old) =>
      old?.filter((item) => item.id !== removed.id),
    );
    // A deleted shop must not stay selected or linger in the ?store= address.
    if (selected === removed.id || requested === removed.id) {
      setSelected('');
      rememberOwnerStore(window.localStorage, session.user.id, null);
      setParams(
        (old) => {
          const next = new URLSearchParams(old);
          next.delete('store');
          next.set('tab', 'trashed');
          return next;
        },
        { replace: true },
      );
    }
    await refresh();
  }
  return (
    <PanelShell session={session} member={member}>
      {stores.isError || summary.isError ? (
        <Retry
          error={stores.error || summary.error}
          retry={() => {
            void stores.refetch();
            void summary.refetch();
          }}
        />
      ) : stores.isPending || summary.isPending ? (
        <Loading />
      ) : (
        <OwnerContext.Provider
          value={{
            session,
            stores: stores.data,
            store,
            summary: summary.data,
            savedStore,
            removedStore,
          }}
        >
          {selectable.length > 1 && (
            <label className="panel-store-switch">
              {member ? 'Your shop' : 'Your store'}
              <select
                value={store?.id}
                onChange={(e) => {
                  if (e.target.value !== store?.id)
                    setPendingStore(e.target.value);
                }}
              >
                {selectable.map((s) => (
                  <option className="notranslate" key={s.id} value={s.id}>
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
          {invitations.data && invitations.data.length > 0 && (
            <InvitationBanner
              items={invitations.data}
              onResolved={() => void refresh()}
            />
          )}
          {!member && <PlanBanner />}
          <Routes>
            <Route index element={<OwnerHome />} />
            <Route path="stores" element={<StoreManager />} />
            <Route path="store/new" element={<StoreEditor key="new" />} />
            <Route
              path="store"
              element={
                store ? (
                  member ? (
                    <OwnerOnly />
                  ) : (
                    <StoreEditor key={store.id} store={store} />
                  )
                ) : (
                  <NoStore />
                )
              }
            />
            <Route
              path="design"
              element={
                store ? (
                  member ? (
                    <OwnerOnly />
                  ) : (
                    <StoreDesignStudio key={store.id} />
                  )
                ) : (
                  <NoStore />
                )
              }
            />
            <Route
              path="settings"
              element={
                store ? (
                  member ? (
                    <OwnerOnly />
                  ) : (
                    <ShopSettings key={store.id} />
                  )
                ) : (
                  <NoStore />
                )
              }
            />
            <Route
              path="verification"
              element={
                store ? (
                  member ? (
                    <OwnerOnly />
                  ) : (
                    <OwnerVerification key={store.id} />
                  )
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
            <Route
              path="plan"
              element={member ? <OwnerOnly /> : <OwnerPlan />}
            />
            <Route
              path="boost"
              element={
                store ? (
                  member ? (
                    <OwnerOnly />
                  ) : (
                    <OwnerBoost key={store.id} />
                  )
                ) : (
                  <NoStore />
                )
              }
            />
            <Route
              path="team"
              element={
                store ? (
                  member ? (
                    <OwnerOnly />
                  ) : (
                    <TeamPanel key={store.id} />
                  )
                ) : (
                  <NoStore />
                )
              }
            />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </OwnerContext.Provider>
      )}
    </PanelShell>
  );
}
function PlanBanner() {
  const { summary, store } = useOwner();
  // The plan belongs to the shop owner; a team member never decides it.
  if (store?.teamRole === 'member') return null;
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
function OwnerOnly() {
  return (
    <>
      <PageTitle
        title="This part belongs to the shop owner."
        description="Your team access covers the content, not the shop account."
      />
      <Empty title="Owner-only settings">
        <p>
          You can still add and edit products, posts, and stories for this shop.
        </p>
        <Link className="panel-primary" to="/dashboard/products">
          <Package size={17} /> Go to products
        </Link>
        <Link className="panel-secondary" to="/dashboard/posts">
          Go to posts
        </Link>
      </Empty>
    </>
  );
}
function InvitationBanner({
  items,
  onResolved,
}: {
  items: TeamInvitationSummary[];
  onResolved: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function accept(item: TeamInvitationSummary) {
    setBusy(item.id);
    setError('');
    try {
      const result = await mutate<{ store: { id: string; name: string } }>(
        `team/invitations/${item.id}/accept`,
      );
      onResolved();
      navigate(`/dashboard?store=${encodeURIComponent(result.store.id)}`);
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy('');
    }
  }
  async function decline(item: TeamInvitationSummary) {
    setBusy(item.id);
    setError('');
    try {
      await mutate(`team/invitations/${item.id}/decline`, {}, 'POST');
      onResolved();
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      {items.map((item) => (
        <section
          className="panel-plan-banner panel-invite-banner"
          key={item.id}
        >
          <div>
            <strong>
              You're invited to help with{' '}
              <span className="notranslate">{item.store.name}</span>.
            </strong>
            <span>
              {item.invitedByName} invited your Gmail. Accept to add products,
              posts, and stories for this shop.
            </span>
            {error && <span role="alert">{error}</span>}
          </div>
          <div className="store-lifecycle-actions">
            <button
              type="button"
              className="panel-secondary"
              disabled={busy === item.id}
              onClick={() => void decline(item)}
            >
              Decline
            </button>
            <button
              type="button"
              className="panel-primary"
              disabled={busy === item.id}
              onClick={() => void accept(item)}
            >
              {busy === item.id ? 'Joining…' : 'Accept invitation'}
            </button>
          </div>
        </section>
      ))}
    </>
  );
}
function TeamAccessCard({ store }: { store: OwnerStore }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function leave() {
    if (
      !window.confirm(
        `Leave ${store.name}? You will lose access to its products, posts, and stories.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await mutate(`team/memberships/${store.id}`, {}, 'DELETE');
      await client.invalidateQueries({ queryKey: ['panel'] });
      await client.invalidateQueries({ queryKey: ['stores'] });
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError(panelError(e));
      setBusy(false);
    }
  }
  return (
    <section className="panel-card panel-team-access">
      <h2>
        <Users size={20} /> Team access
      </h2>
      {error && <Notice error>{error}</Notice>}
      <p className="panel-muted">
        You can add and edit products, posts, and stories here. Only the shop
        owner can change settings, design, plan, or delete the shop.
      </p>
      <button
        type="button"
        className="panel-secondary"
        disabled={busy}
        onClick={() => void leave()}
      >
        {busy ? 'Leaving…' : 'Leave this shop'}
      </button>
    </section>
  );
}
function OwnerHome() {
  const { store, session, summary } = useOwner();
  if (!store) return <NoStore />;
  const member = store.teamRole === 'member';
  return (
    <>
      <PageTitle
        eyebrow={member ? 'SHOP TEAM' : 'YOUR PERSONAL STUDIO'}
        title={`Welcome back, ${session.user.displayName.split(' ')[0] || 'there'}.`}
        description={
          member ? (
            <>
              You're helping <span className="notranslate">{store.name}</span>{' '}
              grow.
            </>
          ) : (
            'A little update can make a big difference.'
          )
        }
        action={
          store.status === 'active' ? (
            <Link className="panel-secondary" to={`/stores/${store.slug}`}>
              View {member ? 'shop' : 'my store'} <ArrowUpRight size={16} />
            </Link>
          ) : member ? (
            <span className="panel-pill muted">
              {storeStatusLabel[store.status]}
            </span>
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
            {member ? 'SHOP TEAM' : 'YOUR STORE'} ·{' '}
            {storeStatusLabel[store.status]}
          </span>
          <h2>
            <span className="notranslate">{store.name}</span>{' '}
            {isStoreVerified(store) && <BadgeCheck size={25} />}
          </h2>
          <p>
            {store.description ? (
              <span className="notranslate">{store.description}</span>
            ) : (
              'Your space to share what makes your business special.'
            )}
          </p>
          {member ? (
            <Link className="panel-primary" to="/dashboard/products">
              Add a product <Package size={17} />
            </Link>
          ) : (
            <Link className="panel-primary" to="/dashboard/store">
              Make it yours <Palette size={17} />
            </Link>
          )}
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
            <small>{member ? 'For this shop' : 'Across your stores'}</small>
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
        {!member && (
          <Link to="/dashboard/design">
            <Palette />
            <strong>Refresh your look</strong>
            <span>Pick a look, layouts and per-section styles.</span>
            <ArrowUpRight />
          </Link>
        )}
        {!member && (
          <Link to="/dashboard/settings">
            <Settings2 />
            <strong>Shop settings</strong>
            <span>Cart, checkout, prices and sections.</span>
            <ArrowUpRight />
          </Link>
        )}
        {!member && (
          <Link to="/dashboard/boost">
            <Megaphone />
            <strong>Boost a post</strong>
            <span>Use coins to reach more people.</span>
            <ArrowUpRight />
          </Link>
        )}
        {!member && (
          <Link to="/dashboard/verification">
            <BadgeCheck />
            <strong>
              {isStoreVerified(store) ? 'Renew verification' : 'Get verified'}
            </strong>
            <span>Send your details for the blue tick.</span>
            <ArrowUpRight />
          </Link>
        )}
      </div>
      {member ? (
        <TeamAccessCard store={store} />
      ) : (
        <p className="panel-muted">
          Growing another business?{' '}
          <Link to="/dashboard/store/new">Create another store</Link>
        </p>
      )}
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
  const sections = summary.sections;
  const sectionLimits = [
    {
      label: 'Shops',
      used: summary.stats.totalStores ?? 0,
      limit:
        typeof summary.limits.maxShops === 'number'
          ? summary.limits.maxShops
          : null,
      enabled: true,
    },
    {
      label: 'Categories',
      used: summary.stats.totalCategories ?? 0,
      limit:
        typeof summary.limits.maxCategories === 'number'
          ? summary.limits.maxCategories
          : null,
      enabled: true,
    },
    {
      label: 'Products',
      used: sections?.products.used ?? summary.stats.totalProducts ?? 0,
      limit:
        sections?.products.limit ??
        (typeof summary.limits.maxProducts === 'number'
          ? summary.limits.maxProducts
          : null),
      enabled: sections?.products.enabled ?? true,
    },
    {
      label: 'Total posts',
      used: sections?.posts.used ?? summary.stats.totalPosts ?? 0,
      limit:
        sections?.posts.limit ??
        (typeof summary.limits.maxTotalPosts === 'number'
          ? summary.limits.maxTotalPosts
          : null),
      enabled: sections?.posts.enabled ?? true,
    },
  ];
  const sectionsOff = Boolean(
    sections && (!sections.posts.enabled || !sections.products.enabled),
  );
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
          {sectionLimits.map(({ label, used, limit, enabled }) => (
            <div className="panel-usage" key={label}>
              <span>{label}</span>
              <strong>
                {enabled
                  ? `${used} / ${limit == null ? 'Unlimited' : limit}`
                  : `${used} saved · section off`}
              </strong>
            </div>
          ))}
          {sectionsOff && sections && (
            <p className="panel-muted">
              {sections.posts.enabled
                ? 'Products are turned off in all your shops, so their unused allowance is available for posts.'
                : sections.products.enabled
                  ? 'Posts are turned off in all your shops, so their unused allowance is available for products.'
                  : 'Both sections are turned off.'}
            </p>
          )}
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
              ? 'Your verification badge is visible on your storefront. Renew it month by month from its own tab.'
              : 'Verification is reviewed and granted by an administrator. Apply from the Verification tab of your shop.'}
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
          <Link className="panel-secondary" to="/dashboard/verification">
            Manage verification <ArrowUpRight size={16} />
          </Link>
        </section>
      </div>
    </>
  );
}
