import { createContext, useContext, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
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
  QrCode,
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
import { OwnerNotifications, OwnerRenewalBanner } from './OwnerNotifications';
import {
  LockedShopNotice,
  LockedShopsPage,
  RenewalAction,
} from './OwnerLocked';
import { StoreQr } from './StoreQr';
import { StoreManager } from './StoreManager';
import { TeamPanel } from './TeamPanel';

export interface OwnerStore extends Store {
  status: StoreLifecycleStatus;
  trashedAt: string | null;
  restricted?: boolean;
  enableCart: boolean;
  enableWhatsAppCheckout: boolean;
  // Plan lifecycle, owner view only. A locked shop is hidden from shoppers and
  // keeps only its renewal page; mediaArchiveState says where its bytes are.
  subscriptionLockedAt?: string | null;
  mediaArchiveState?: string | null;
  renewalRequestedAt?: string | null;
  productsCount?: number;
  postsCount?: number;
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
    // active → grace (7 days, public but read-only) → locked (hidden).
    phase?: 'active' | 'grace' | 'locked';
    graceEndsAt?: string | null;
    renewalRequestedAt?: string | null;
    // Hours after a trial shop locks before it is permanently deleted; 0 keeps
    // trial shops forever. Paid-plan shops are never deleted.
    trialDeleteAfterHours?: number;
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
// A lapsed plan sends the owner to the plans page once, on the dashboard home.
// The marker is per end date, so a later visit (and the locked-shop page) is
// never trapped in a redirect loop.
const planEndedMarker = (expiresAt?: string | null) =>
  `matjary:plan-ended:${expiresAt ?? 'unknown'}`;
function readPlanEndedMarker(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function PlanEndedRedirect({
  state,
  pathname,
}: {
  state?: OwnerSummary['subscriptionState'];
  pathname: string;
}) {
  const shouldRedirect =
    pathname === '/dashboard' &&
    state?.state === 'expired' &&
    state.phase === 'grace';
  const key = planEndedMarker(state?.expiresAt);
  const [alreadySent] = useState(() => readPlanEndedMarker(key));
  useEffect(() => {
    if (!shouldRedirect) return;
    try {
      window.sessionStorage.setItem(key, '1');
    } catch {
      // Private browsing can refuse storage; the redirect still happens once
      // per mount, and the plans page is reachable at any time.
    }
  }, [shouldRedirect, key]);
  if (!shouldRedirect || alreadySent) return null;
  return <Navigate to="/pricing?ended=1" replace />;
}
// A locked shop never opens an editor: its only destination is the renewal
// screen. The panel builds the gate below so it can also pass the trial
// deletion window. Members only reach active shops (the API omits locked ones).
export default function OwnerPanel({ session }: { session: Session }) {
  // This panel remounts on every tab change, so the chosen store is restored
  // from device storage instead of falling back to the first store.
  const [selected, setSelected] = useState(() =>
    readOwnerStoreId(window.localStorage, session.user.id),
  );
  const [pendingStore, setPendingStore] = useState('');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
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
    (s) =>
      !s.restricted &&
      s.status !== 'locked' &&
      (isCurrentStore(s) || s.id === store?.id),
  );
  // Shops frozen by an expired plan. The API already omits shops a member only
  // helps with; the owner renews them here instead of opening an editor.
  const lockedShops = available.filter(
    (candidate) =>
      candidate.status === 'locked' &&
      !candidate.restricted &&
      candidate.teamRole === 'owner',
  );
  const planHours = summary.data?.subscriptionState?.trialDeleteAfterHours ?? 0;
  // The render callback stays lazy so no store field is read before the status
  // is known. A locked shop only gets the renewal screen.
  const requireStore = (
    target: OwnerStore | undefined,
    isMember: boolean,
    render: (store: OwnerStore) => React.ReactNode,
  ): React.ReactNode => {
    if (!target) return <NoStore />;
    if (target.status === 'locked')
      return (
        <LockedShopNotice
          store={target}
          member={isMember}
          trialDeleteAfterHours={planHours}
        />
      );
    return render(target);
  };
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
          {!member && (
            <PlanEndedRedirect
              state={summary.data.subscriptionState}
              pathname={location.pathname}
            />
          )}
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
              element={requireStore(store, member, (current) =>
                member ? (
                  <OwnerOnly />
                ) : (
                  <StoreEditor key={current.id} store={current} />
                ),
              )}
            />
            <Route
              path="design"
              element={requireStore(store, member, (current) =>
                member ? <OwnerOnly /> : <StoreDesignStudio key={current.id} />,
              )}
            />
            <Route
              path="settings"
              element={requireStore(store, member, (current) =>
                member ? <OwnerOnly /> : <ShopSettings key={current.id} />,
              )}
            />
            <Route
              path="notifications"
              element={member ? <OwnerOnly /> : <OwnerNotifications />}
            />
            <Route
              path="locked"
              element={
                member ? (
                  <OwnerOnly />
                ) : (
                  <LockedShopsPage
                    shops={lockedShops}
                    userId={session.user.id}
                    renewalRequestedAt={
                      summary.data?.subscriptionState?.renewalRequestedAt ??
                      null
                    }
                    trial={summary.data?.subscriptionState?.planSlug === 'free'}
                    trialDeleteAfterHours={planHours}
                  />
                )
              }
            />
            <Route
              path="verification"
              element={requireStore(store, member, (current) =>
                member ? <OwnerOnly /> : <OwnerVerification key={current.id} />,
              )}
            />
            <Route
              path="qr"
              element={requireStore(store, member, (current) =>
                member ? <OwnerOnly /> : <StoreQr key={current.id} />,
              )}
            />
            <Route
              path="products"
              element={requireStore(store, member, (current) => (
                <OwnerContent key={`products-${current.id}`} kind="products" />
              ))}
            />
            <Route
              path="posts"
              element={requireStore(store, member, (current) => (
                <OwnerContent key={`posts-${current.id}`} kind="posts" />
              ))}
            />
            <Route
              path="plan"
              element={member ? <OwnerOnly /> : <OwnerPlan />}
            />
            <Route
              path="boost"
              element={requireStore(store, member, (current) =>
                member ? <OwnerOnly /> : <OwnerBoost key={current.id} />,
              )}
            />
            <Route
              path="team"
              element={requireStore(store, member, (current) =>
                member ? <OwnerOnly /> : <TeamPanel key={current.id} />,
              )}
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
  const phase = state.phase ?? (state.state === 'expired' ? 'grace' : 'active');
  // A trial can only be upgraded; a paid plan can be renewed. The CTA must say
  // which one the owner is looking at.
  const offerPlan = state.planSlug === 'free';
  const renewLabel = offerPlan ? 'Choose a plan' : 'Renew my shops';
  const renewTarget = offerPlan ? '/pricing' : '/dashboard/locked';
  const trialHours = state.trialDeleteAfterHours ?? 0;
  const trialDeletion =
    trialHours > 0 ? ` and deleted ${trialHours} hours later` : '';
  if (phase === 'locked')
    return (
      <section className="panel-plan-banner is-expired">
        <div>
          <strong>
            {offerPlan
              ? 'Your free trial ended and your shop is locked.'
              : 'Your plan ended and your shops are locked.'}
          </strong>
          <span>
            {offerPlan
              ? `A trial shop is permanently deleted ${trialHours > 0 ? `${trialHours} hours` : 'shortly'} after it locks. Choose a plan to keep it.`
              : 'Nothing was deleted. Renew to reopen them; every product, post, photo and video returns with its original quality.'}
          </span>
        </div>
        <Link className="panel-primary" to={renewTarget}>
          {renewLabel} <ArrowUpRight size={16} />
        </Link>
      </section>
    );
  if (phase === 'grace')
    return (
      <section className="panel-plan-banner is-expired">
        <div>
          <strong>
            {offerPlan ? 'Your free trial ended.' : 'Your plan ended.'} Your
            shops stay online until {dateLabel(state.graceEndsAt)}.
          </strong>
          <span>
            After the 7-day grace window they are locked and hidden from
            shoppers{trialDeletion}.{' '}
            {offerPlan ? 'Choose a paid plan' : 'Renew'} to keep editing and
            stay online.
          </span>
        </div>
        <Link className="panel-primary" to={renewTarget}>
          {renewLabel} <ArrowUpRight size={16} />
        </Link>
      </section>
    );
  const endingSoon =
    state.state === 'trial' &&
    state.daysRemaining != null &&
    state.daysRemaining <= 2;
  if (!endingSoon) return null;
  const days = state.daysRemaining ?? 0;
  return (
    <section className="panel-plan-banner">
      <div>
        <strong>
          {`Your free trial ends in ${days} day${days === 1 ? '' : 's'}.`}
        </strong>
        <span>
          Choose a paid plan to keep creating. Your shop stays online during the
          7-day grace window after the trial ends, then it locks{trialDeletion}.
        </span>
      </div>
      <Link className="panel-primary" to="/pricing">
        Choose a plan <ArrowUpRight size={16} />
      </Link>
    </section>
  );
}
// A new account meets its plan limits on the store-creation screens, so the
// trial and the upgrade path are stated there. PlanBanner takes over in the
// final days with a stronger warning, which keeps the two from stacking.
export function TrialOffer() {
  const { summary, store } = useOwner();
  if (store?.teamRole === 'member') return null;
  const state = summary.subscriptionState;
  if (
    state?.state !== 'trial' ||
    state.daysRemaining == null ||
    state.daysRemaining <= 2
  )
    return null;
  const days = state.daysRemaining;
  return (
    <section className="panel-plan-banner trial-offer">
      <div>
        <strong>
          Your free trial is active — {days} day{days === 1 ? '' : 's'} left.
        </strong>
        <span>
          Build your store now. Want more shops, products, and posts? Upgrade
          anytime. After the trial ends your shop stays online for a 7-day grace
          window, then it locks and is deleted unless you choose a plan.
        </span>
      </div>
      <Link className="panel-primary" to="/pricing">
        Compare plans <ArrowUpRight size={16} />
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
      <TrialOffer />
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
  const { store, session, summary, stores } = useOwner();
  // A locked shop has exactly one destination; opening the studio here would
  // only show forms the API refuses.
  if (store?.status === 'locked')
    return (
      <LockedShopNotice
        store={store}
        member={store.teamRole === 'member'}
        trialDeleteAfterHours={
          summary.subscriptionState?.trialDeleteAfterHours ?? 0
        }
      />
    );
  // A plan belongs to the account, so its renewal reminder must stay visible
  // even when the owner currently has no shop to open.
  if (!store) {
    const lockedShops = stores.filter(
      (candidate) =>
        candidate.status === 'locked' && candidate.teamRole === 'owner',
    );
    return (
      <>
        <OwnerRenewalBanner />
        {lockedShops.length ? (
          <LockedShopsPage
            shops={lockedShops}
            userId={session.user.id}
            renewalRequestedAt={
              summary.subscriptionState?.renewalRequestedAt ?? null
            }
            trial={summary.subscriptionState?.planSlug === 'free'}
            trialDeleteAfterHours={
              summary.subscriptionState?.trialDeleteAfterHours ?? 0
            }
          />
        ) : (
          <NoStore />
        )}
      </>
    );
  }
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
      <OwnerRenewalBanner />
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
        {!member && (
          <Link to="/dashboard/qr">
            <QrCode />
            <strong>Shop QR code</strong>
            <span>Download a printable code with your logo.</span>
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
  const { summary, store, session } = useOwner();
  const state = summary.subscriptionState;
  const expired = state?.state === 'expired';
  const trial = state?.state === 'trial';
  const phase = state?.phase ?? (expired ? 'grace' : 'active');
  // The newest row still names the plan that ended: a trial is upgraded, a
  // paid plan is renewed.
  const trialPlan = state?.planSlug === 'free';
  const trialHours = state?.trialDeleteAfterHours ?? 0;
  const trialDeletion =
    trialHours > 0 ? ` and deleted ${trialHours} hours later` : '';
  const planName =
    phase === 'locked'
      ? 'Locked'
      : expired
        ? 'Plan ended'
        : state?.planName || summary.subscription?.planName || 'Free';
  const planDetail =
    phase === 'locked'
      ? trialPlan
        ? `Your free trial ended and the shop is locked. A trial shop is permanently deleted ${trialHours > 0 ? `${trialHours} hours` : 'shortly'} after it locks, so choose a plan to keep it.`
        : 'Your shops are hidden from shoppers and their media is archived. Renew to reopen them; nothing was deleted.'
      : phase === 'grace'
        ? `Ended ${dateLabel(state?.expiresAt)} · your shops stay online until ${dateLabel(state?.graceEndsAt)}, then they are locked${trialPlan ? trialDeletion : ''}.`
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
            {trial
              ? 'FREE TRIAL'
              : phase === 'locked'
                ? 'LOCKED'
                : phase === 'grace'
                  ? 'GRACE PERIOD'
                  : 'CURRENT PLAN'}
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
          {(phase === 'grace' || phase === 'locked') && !trialPlan && (
            <RenewalAction
              userId={session.user.id}
              requested={Boolean(state?.renewalRequestedAt)}
              trial={false}
              onRequested={() => undefined}
            />
          )}
          <small>
            {phase === 'locked'
              ? trialPlan
                ? `A trial shop is deleted ${trialHours > 0 ? `${trialHours} hours` : 'shortly'} after it locks; a paid plan opens it again.`
                : 'A renewal reopens every locked shop and restores its photos and videos with their original quality.'
              : phase === 'grace'
                ? trialPlan
                  ? 'After the 7-day grace window the shop locks and is deleted unless a plan is activated.'
                  : 'After the 7-day grace window your shops are locked and hidden until the team confirms a renewal.'
                : expired
                  ? 'An administrator assigns paid plans. Renew to keep creating; your shops stay online during the 7-day grace window.'
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
