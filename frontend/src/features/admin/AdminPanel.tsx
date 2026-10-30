import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import {
  ArrowUpRight,
  BadgeCheck,
  Clock3,
  Coins,
  CreditCard,
  Palette,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Store,
  Users,
  Package,
  Images,
} from 'lucide-react';
import type { ShopCategoryCatalog } from '../../lib/api';
import {
  getJson,
  mutate,
  panelError,
  recordName,
  dateLabel,
  type Page,
  type PanelRecord,
  type Session,
} from '../shared/panel-api';
import {
  Empty,
  Loading,
  Modal,
  Notice,
  PageTitle,
  Pagination,
  PanelShell,
  Retry,
} from '../shared/PanelUI';
import {
  storeMediaUrl,
  formatProductPrice,
  isStoreVerified,
} from '../../lib/storefront';
import { BILLING_LABELS, PlanEditor, planSummary } from './PlanEditor';
import { PHONE_COUNTRIES, dialCodeFor, phoneDraft } from '../../lib/phone';
import { AdminBoost } from './AdminBoost';
import { AdminSettings } from './AdminSettings';
import { AdminSeo } from './AdminSeo';

type Resource = 'users' | 'stores' | 'products' | 'posts' | 'subscriptions';
export default function AdminPanel({ session }: { session: Session }) {
  const scoped = session.user.adminScope === 'stores';
  const { pathname } = useLocation();
  // Direct links to platform-wide sections are closed for a store-scoped
  // administrator even though the workspace itself stays available.
  const reachable =
    pathname === '/admin' ||
    pathname === '/admin/' ||
    pathname.startsWith('/admin/stores') ||
    pathname.startsWith('/admin/content');
  if (scoped && !reachable) return <Navigate to="/admin" replace />;
  return (
    <PanelShell session={session} admin>
      <Routes>
        <Route
          index
          element={<Overview id={session.user.id} scoped={scoped} />}
        />
        <Route
          path="users"
          element={
            <AdminList key="users" resource="users" id={session.user.id} />
          }
        />
        <Route
          path="stores"
          element={
            <AdminList
              key="stores"
              resource="stores"
              id={session.user.id}
              scoped={scoped}
            />
          }
        />
        <Route
          path="content"
          element={
            <AdminList
              key="products"
              resource="products"
              id={session.user.id}
              scoped={scoped}
            />
          }
        />
        <Route
          path="content/posts"
          element={
            <AdminList
              key="posts"
              resource="posts"
              id={session.user.id}
              scoped={scoped}
            />
          }
        />
        <Route
          path="subscriptions"
          element={
            <AdminList
              key="subscriptions"
              resource="subscriptions"
              id={session.user.id}
            />
          }
        />
        <Route
          path="subscriptions/plans"
          element={<AdminPlans id={session.user.id} />}
        />
        <Route path="boost" element={<AdminBoost id={session.user.id} />} />
        <Route
          path="settings"
          element={<AdminSettings id={session.user.id} />}
        />
        <Route path="seo" element={<AdminSeo id={session.user.id} />} />
        <Route
          path="verification"
          element={<AdminVerification id={session.user.id} />}
        />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </PanelShell>
  );
}
function Overview({ id, scoped }: { id: string; scoped: boolean }) {
  const query = useQuery({
    queryKey: ['panel', id, 'overview'],
    queryFn: ({ signal }) =>
      getJson<Record<string, number>>('admin/overview', signal),
  });
  const cards = [
    { label: 'Users', key: 'users', href: 'users', icon: Users },
    { label: 'Stores', key: 'stores', href: 'stores', icon: Store },
    { label: 'Products', key: 'products', href: 'content', icon: Package },
    { label: 'Posts', key: 'posts', href: 'content/posts', icon: Images },
    { label: 'Boost wallets', key: 'wallets', href: 'boost', icon: Coins },
    {
      label: 'Active ads',
      key: 'activeCampaigns',
      href: 'boost',
      icon: Coins,
    },
  ].filter((card) =>
    scoped ? ['stores', 'products', 'posts'].includes(card.key) : true,
  );
  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION"
        title={
          scoped ? 'Your assigned shops.' : 'A clear view of your platform.'
        }
        description={
          scoped
            ? 'Review the shops an administrator trusted you with. Platform-wide tools stay with the website team.'
            : 'Support your store owners. Keep the community moving.'
        }
      />
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Retry error={query.error} retry={() => void query.refetch()} />
      ) : (
        <div className="panel-stats">
          {cards.map((card) => (
            <Link
              className="panel-stat"
              to={`/admin/${card.href}`}
              key={card.key}
            >
              <span>
                <card.icon size={20} />
                {card.label}
                <ArrowUpRight size={16} />
              </span>
              <strong>{query.data[card.key]?.toLocaleString() ?? 0}</strong>
              <small>View all {card.label.toLowerCase()}</small>
            </Link>
          ))}
        </div>
      )}
      {!scoped && (
        <div className="panel-two-columns">
          <section className="panel-card panel-feature">
            <CreditCard size={28} />
            <h2>The right plan, for every owner.</h2>
            <p>
              Create plans, adjust limits, and assign subscriptions with expiry
              dates in one place.
            </p>
            <Link className="panel-primary" to="/admin/subscriptions">
              Manage subscriptions <ArrowUpRight size={16} />
            </Link>
          </section>
          <section className="panel-card panel-feature">
            <BadgeCheck size={28} />
            <h2>Help trusted stores stand out.</h2>
            <p>Review a store and manage its verification badge.</p>
            <Link className="panel-secondary" to="/admin/verification">
              Review verification <ArrowUpRight size={16} />
            </Link>
          </section>
        </div>
      )}
      {!scoped && (
        <section className="panel-note">
          <Palette size={20} />
          <p>
            <strong>Name, description, logo and colors.</strong>
            <br />
            Update the branding every visitor sees, the contact email, and the
            LBP exchange rate.
          </p>
          <Link className="panel-secondary" to="/admin/settings">
            Website settings <ArrowUpRight size={16} />
          </Link>
        </section>
      )}
      <div className="panel-note">
        <ShieldCheck size={20} />
        {scoped ? (
          <p>
            <strong>Only your assigned shops.</strong>
            <br />
            You can hide or restore content inside these shops. The website team
            keeps plans, verification, branding, and shop creation.
          </p>
        ) : (
          <p>
            <strong>Owners create. You support.</strong>
            <br />
            Stores, products, and uploads are managed by their owners. This
            workspace is for oversight, subscriptions, verification, and opening
            shops on an owner's behalf.
          </p>
        )}
      </div>
    </>
  );
}
function SubscriptionTabs() {
  return (
    <nav className="panel-tabs" aria-label="Subscriptions">
      <NavLink end to="/admin/subscriptions">
        Assignments
      </NavLink>
      <NavLink to="/admin/subscriptions/plans">Plans</NavLink>
    </nav>
  );
}
function AdminPlans({ id }: { id: string }) {
  const [editing, setEditing] = useState<PanelRecord | 'new'>();
  const [deactivating, setDeactivating] = useState<PanelRecord>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['panel', id, 'plans'],
    queryFn: ({ signal }) =>
      getJson<Page<PanelRecord>>('admin/data/plans?limit=100', signal),
  });
  const plans = [...(query.data?.items ?? [])].sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      (a.name ?? '').localeCompare(b.name ?? ''),
  );
  async function activate(plan: PanelRecord) {
    if (busy) return;
    setBusy(plan.id);
    setError('');
    try {
      await mutate(`admin/plans/${plan.id}`, { isActive: true }, 'PATCH');
      await client.invalidateQueries({ queryKey: ['panel', id] });
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION"
        title="Plans"
        description="Add a plan, change limits, or retire an old one. Owners only see active plans."
        action={
          <button className="panel-primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Add plan
          </button>
        }
      />
      <SubscriptionTabs />
      {error && <Notice error>{error}</Notice>}
      <section className="panel-card panel-list-card">
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <Retry error={query.error} retry={() => void query.refetch()} />
        ) : plans.length ? (
          <div className="panel-record-list">
            {plans.map((plan) => (
              <article className="panel-record" key={plan.id}>
                <div className="panel-record-icon">
                  <CreditCard size={20} />
                </div>
                <div className="panel-record-info">
                  <h3>{plan.name}</h3>
                  <p>
                    {formatProductPrice(
                      plan.priceCents || '0',
                      plan.currency || 'USD',
                    )}
                    {' · '}
                    {BILLING_LABELS[plan.billingCycle ?? 'monthly'] ??
                      plan.billingCycle}
                  </p>
                  <small>{planSummary(plan.limits)}</small>
                </div>
                <span
                  className={`panel-pill ${plan.isActive === false ? 'muted' : ''}`}
                >
                  {plan.isActive === false ? 'Inactive' : 'Active'}
                </span>
                <button onClick={() => setEditing(plan)}>
                  Edit <ArrowUpRight size={15} />
                </button>
                {plan.slug !== 'free' &&
                  (plan.isActive === false ? (
                    <button
                      disabled={busy === plan.id}
                      onClick={() => void activate(plan)}
                    >
                      {busy === plan.id ? 'Activating…' : 'Reactivate'}
                    </button>
                  ) : (
                    <button onClick={() => setDeactivating(plan)}>
                      Deactivate
                    </button>
                  ))}
              </article>
            ))}
          </div>
        ) : (
          <Empty title="No plans yet">
            <p>Create your first plan to start assigning subscriptions.</p>
          </Empty>
        )}
      </section>
      {editing !== undefined && (
        <PlanEditor
          plan={editing === 'new' ? undefined : editing}
          adminId={id}
          close={() => setEditing(undefined)}
        />
      )}
      {deactivating && (
        <ConfirmAction
          path={`admin/plans/${deactivating.id}/deactivate`}
          title={`Deactivate ${deactivating.name}`}
          reasons={[
            'Replaced by a newer plan',
            'Pricing changed for new owners',
            'Plan retired',
          ]}
          id={id}
          close={() => setDeactivating(undefined)}
          done={() => setDeactivating(undefined)}
        />
      )}
    </>
  );
}
function AdminList({
  resource,
  id,
  scoped = false,
}: {
  resource: Resource;
  id: string;
  scoped?: boolean;
}) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [archive, setArchive] = useState('all');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<PanelRecord>();
  const [assign, setAssign] = useState<PanelRecord | null | undefined>();
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams({
    limit: '20',
    offset: String(offset),
    archive,
  });
  if (search) params.set('search', search);
  if (resource === 'stores' && status !== 'all') params.set('status', status);
  const query = useQuery({
    queryKey: ['panel', id, resource, params.toString()],
    queryFn: ({ signal }) =>
      getJson<Page<PanelRecord>>(`admin/data/${resource}?${params}`, signal),
  });
  const title =
    resource === 'products' || resource === 'posts'
      ? 'Content'
      : resource[0]!.toUpperCase() + resource.slice(1);
  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION"
        title={title}
        description={
          resource === 'subscriptions'
            ? 'Assign a plan to a user. They take care of their store.'
            : resource === 'stores' && scoped
              ? 'The shops assigned to you. Open a shop to review its content.'
              : resource === 'stores'
                ? 'Find a shop, open it, or create one for an owner without leaving the admin workspace.'
                : 'Find, review, and support the people behind the platform.'
        }
        action={
          resource === 'subscriptions' ? (
            <button className="panel-primary" onClick={() => setAssign(null)}>
              Assign subscription
            </button>
          ) : resource === 'stores' && !scoped ? (
            <button className="panel-primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> Create store
            </button>
          ) : undefined
        }
      />
      {(resource === 'products' || resource === 'posts') && (
        <nav className="panel-tabs" aria-label="Content type">
          <NavLink end to="/admin/content">
            Products
          </NavLink>
          <NavLink to="/admin/content/posts">Posts</NavLink>
        </nav>
      )}
      {resource === 'subscriptions' && <SubscriptionTabs />}
      <section className="panel-card panel-list-card">
        <form
          className="panel-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
            setOffset(0);
          }}
        >
          <label className="panel-search">
            <Search size={18} />
            <input
              aria-label={`Search ${title}`}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={
                resource === 'subscriptions'
                  ? 'Search owner name, email or plan'
                  : `Search ${title.toLowerCase()}…`
              }
              maxLength={100}
            />
          </label>
          <button type="submit">Search</button>
          {resource !== 'subscriptions' && (
            <select
              aria-label="Visibility filter"
              value={archive}
              onChange={(e) => {
                setArchive(e.target.value);
                setOffset(0);
              }}
            >
              <option value="all">All records</option>
              <option value="active">
                {resource === 'users' ? 'Active accounts' : 'Not hidden'}
              </option>
              <option value="archived">
                {resource === 'users' ? 'Suspended accounts' : 'Hidden'}
              </option>
            </select>
          )}
          {resource === 'stores' && (
            <select
              aria-label="Store status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setOffset(0);
              }}
            >
              <option value="all">All statuses</option>
              <option value="active">Online</option>
              <option value="offline">Off</option>
              <option value="archived">Archived</option>
              <option value="trashed">In Trash</option>
            </select>
          )}
        </form>
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <Retry error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            {query.data.items.length ? (
              <div className="panel-record-list">
                {query.data.items.map((item) => (
                  <article className="panel-record" key={item.id}>
                    <div className="panel-record-icon">
                      {item.logoKey ? (
                        <img src={storeMediaUrl(item.logoKey)} alt="" />
                      ) : resource === 'users' ? (
                        <Users size={20} />
                      ) : resource === 'subscriptions' ? (
                        <CreditCard size={20} />
                      ) : (
                        <Store size={20} />
                      )}
                    </div>
                    <div className="panel-record-info">
                      <h3>
                        <span className="notranslate">{recordName(item)}</span>{' '}
                        {isStoreVerified(item) && (
                          <BadgeCheck
                            size={17}
                            className="panel-verified"
                            aria-label="Verified"
                          />
                        )}
                      </h3>
                      <p>
                        {item.owner
                          ? `${item.owner.displayName} · ${item.owner.email}`
                          : item.email ||
                            (item.store?.name ? (
                              <span className="notranslate">
                                {item.store.name}
                              </span>
                            ) : (
                              item.slug || 'Subscription assignment'
                            ))}
                      </p>
                      {resource === 'users' && item.phone && (
                        <small>
                          <span className="notranslate">{item.phone}</span>
                        </small>
                      )}
                      {resource === 'subscriptions' && (
                        <small>Expires {dateLabel(item.expiresAt)}</small>
                      )}
                    </div>
                    <span
                      className={`panel-pill ${item.adminArchivedAt || item.suspendedAt ? 'muted' : ''}`}
                    >
                      {item.adminArchivedAt
                        ? 'Hidden'
                        : item.suspendedAt
                          ? 'Suspended'
                          : resource === 'stores'
                            ? item.status === 'trashed'
                              ? 'In Trash'
                              : isStoreVerified(item)
                                ? 'Verified'
                                : 'Not verified'
                            : resource === 'users'
                              ? item.role === 'admin'
                                ? item.adminScope === 'stores'
                                  ? 'Store admin'
                                  : 'Administrator'
                                : 'User'
                              : item.status || 'Active'}
                    </span>
                    <button onClick={() => setSelected(item)}>
                      View details <ArrowUpRight size={15} />
                    </button>
                    {resource === 'users' && (
                      <button onClick={() => setAssign(item)}>
                        Assign plan
                      </button>
                    )}
                    {resource === 'subscriptions' && item.owner && (
                      <button
                        onClick={() =>
                          setAssign({
                            id: item.userId ?? item.owner!.id,
                            displayName: item.owner?.displayName,
                            email: item.owner?.email,
                            phone: item.owner?.phone,
                          })
                        }
                      >
                        Reassign
                      </button>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="Nothing here yet">
                <p>
                  {search
                    ? 'Try another search or clear your filters.'
                    : 'New activity will appear here.'}
                </p>
              </Empty>
            )}
            <Pagination
              offset={offset}
              total={query.data.total}
              onChange={setOffset}
            />
          </>
        )}
      </section>
      {selected && (
        <Detail
          resource={resource}
          item={selected}
          id={id}
          scoped={scoped}
          close={() => setSelected(undefined)}
          assign={(user) => {
            setSelected(undefined);
            setAssign(user);
          }}
        />
      )}
      {assign !== undefined && (
        <AssignSubscription
          user={assign}
          id={id}
          close={() => setAssign(undefined)}
        />
      )}
      {creating && <CreateStore id={id} close={() => setCreating(false)} />}
    </>
  );
}

interface VerificationQueueRequest {
  id: string;
  status: string;
  applicantName: string;
  phone: string;
  note: string | null;
  includedInPlan: boolean;
  priceCents: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  store: {
    id: string;
    name: string;
    slug: string;
    logoKey: string | null;
    state: string;
    visible: boolean;
    expiresAt: string | null;
    graceEndsAt: string | null;
    daysRemaining: number | null;
    included: boolean;
  } | null;
  owner: { displayName: string; email: string } | null;
}

interface VerificationQueueStore {
  id: string;
  name: string;
  slug: string;
  logoKey: string | null;
  owner: { displayName: string; email: string } | null;
  state: string;
  visible: boolean;
  expiresAt: string | null;
  graceEndsAt: string | null;
  daysRemaining: number | null;
  included: boolean;
}

const badgeStateLabel = (state: string) =>
  state === 'active'
    ? 'Active'
    : state === 'grace'
      ? 'Renewal window'
      : state === 'expired'
        ? 'Ended'
        : 'Not verified';

// The verification queue: pending applications on top, then every store that
// holds a badge with its monthly end date and one-click renewal.
function AdminVerification({ id }: { id: string }) {
  const [action, setAction] = useState<{
    path: string;
    title: string;
    description?: string;
    reasons: string[];
  }>();
  const requests = useQuery({
    queryKey: ['panel', id, 'verification-requests'],
    queryFn: ({ signal }) =>
      getJson<Page<VerificationQueueRequest>>(
        'admin/verification/requests?status=pending&limit=50',
        signal,
      ),
  });
  const stores = useQuery({
    queryKey: ['panel', id, 'verification-stores'],
    queryFn: ({ signal }) =>
      getJson<Page<VerificationQueueStore>>(
        'admin/verification/stores?limit=100',
        signal,
      ),
  });
  const pending = requests.data?.items ?? [];
  const shops = stores.data?.items ?? [];
  const visibleBadges = shops.filter((store) => store.visible).length;
  const lapsing = shops.filter(
    (store) => store.state === 'grace' || store.state === 'expired',
  ).length;
  const priceText = (request: VerificationQueueRequest) =>
    request.includedInPlan
      ? 'Included in the plan'
      : `${formatProductPrice(request.priceCents, 'USD')} per month`;
  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION"
        title="Verification"
        description="Review identity details, approve a month, and keep trusted shops ticking. Each approval covers 30 days; a lapsed badge stays visible for 5 grace days. Special shops can be verified with no end date."
      />
      <div className="panel-stats">
        <div className="panel-stat">
          <span>
            Waiting for review <Clock3 size={17} />
          </span>
          <strong>{requests.data?.total ?? 0}</strong>
          <small>Shop owners who sent their details</small>
        </div>
        <div className="panel-stat">
          <span>
            Visible blue ticks <BadgeCheck size={17} />
          </span>
          <strong>{visibleBadges}</strong>
          <small>Paid months and renewal windows</small>
        </div>
        <div className="panel-stat">
          <span>Ended or in grace</span>
          <strong>{lapsing}</strong>
          <small>Give another month with one click</small>
        </div>
      </div>
      <section className="panel-card panel-list-card">
        <h2>Requests waiting for review</h2>
        {requests.isPending ? (
          <Loading />
        ) : requests.isError ? (
          <Retry error={requests.error} retry={() => void requests.refetch()} />
        ) : pending.length ? (
          <div className="panel-record-list">
            {pending.map((request) => (
              <article className="panel-record" key={request.id}>
                <div className="panel-record-icon">
                  {request.store?.logoKey ? (
                    <img src={storeMediaUrl(request.store.logoKey)} alt="" />
                  ) : (
                    <BadgeCheck size={20} />
                  )}
                </div>
                <div className="panel-record-info">
                  <h3 className="notranslate">
                    {request.store?.name ?? 'Shop'}
                  </h3>
                  <p>
                    {request.owner
                      ? `${request.owner.displayName} · ${request.owner.email}`
                      : 'Shop owner'}
                  </p>
                  <small>
                    {request.applicantName} ·{' '}
                    <a href={`tel:${request.phone}`}>
                      <Phone size={12} />{' '}
                      <span className="notranslate">{request.phone}</span>
                    </a>{' '}
                    · Requested {dateLabel(request.createdAt)}
                  </small>
                  {request.note && <small>{request.note}</small>}
                </div>
                <span className="panel-pill">{priceText(request)}</span>
                <button
                  className="panel-primary"
                  onClick={() =>
                    setAction({
                      path: `admin/verification/requests/${request.id}/approve`,
                      title: `Approve verification for ${request.store?.name ?? 'this shop'}`,
                      description: request.includedInPlan
                        ? `Included in the owner's plan, so the badge ends when the subscription ends. Call ${request.applicantName} on ${request.phone} to confirm.`
                        : `One month starts on approval. Call ${request.applicantName} on ${request.phone}. ${priceText(request)}.`,
                      reasons: [
                        'Payment received',
                        'Identity and business confirmed',
                        'Included in the plan',
                      ],
                    })
                  }
                >
                  Approve month
                </button>
                <button
                  onClick={() =>
                    setAction({
                      path: `admin/verification/requests/${request.id}/reject`,
                      title: `Reject verification for ${request.store?.name ?? 'this shop'}`,
                      description:
                        'The owner will see this reason on their Verification tab and can send new details.',
                      reasons: [
                        'Details could not be verified',
                        'Phone number unreachable',
                        'Required business details missing',
                      ],
                    })
                  }
                >
                  Reject
                </button>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="No requests waiting">
            <p>
              New applications from shop Verification tabs appear here with the
              owner's name and Lebanese phone number.
            </p>
          </Empty>
        )}
      </section>
      <section className="panel-card panel-list-card">
        <h2>Verified shops</h2>
        {stores.isPending ? (
          <Loading />
        ) : stores.isError ? (
          <Retry error={stores.error} retry={() => void stores.refetch()} />
        ) : shops.length ? (
          <div className="panel-record-list">
            {shops.map((store) => (
              <article className="panel-record" key={store.id}>
                <div className="panel-record-icon">
                  {store.logoKey ? (
                    <img src={storeMediaUrl(store.logoKey)} alt="" />
                  ) : (
                    <Store size={20} />
                  )}
                </div>
                <div className="panel-record-info">
                  <h3 className="notranslate">
                    {store.name}{' '}
                    {store.visible && (
                      <BadgeCheck
                        size={17}
                        className="panel-verified"
                        aria-label="Visible verification badge"
                      />
                    )}
                  </h3>
                  <p>
                    {store.owner
                      ? `${store.owner.displayName} · ${store.owner.email}`
                      : 'Shop owner'}
                  </p>
                  <small>
                    {store.included ? 'Included in the plan' : 'Monthly add-on'}
                    {' · '}
                    {store.expiresAt
                      ? store.state === 'active'
                        ? `Renews ${dateLabel(store.expiresAt)} · ${store.daysRemaining ?? 0} days left`
                        : store.state === 'grace'
                          ? `Ended ${dateLabel(store.expiresAt)} · tick hides ${dateLabel(store.graceEndsAt)}`
                          : `Ended ${dateLabel(store.expiresAt)} · tick hidden`
                      : 'Lifetime grant with no end date'}
                  </small>
                </div>
                <span className={`panel-pill ${store.visible ? '' : 'muted'}`}>
                  {badgeStateLabel(store.state)}
                </span>
                {store.included ? (
                  <span className="panel-pill muted">
                    Follows the subscription end
                  </span>
                ) : store.expiresAt ? (
                  <>
                    <button
                      className="panel-primary"
                      onClick={() =>
                        setAction({
                          path: `admin/verification/stores/${store.id}/extend`,
                          title: `Give ${store.name} another month`,
                          description:
                            'The new month starts where the current one ends, or today if it already lapsed. Any pending renewal from this shop is approved too.',
                          reasons: [
                            'Monthly renewal paid',
                            'Payment received by transfer',
                            'Administrator adjustment',
                          ],
                        })
                      }
                    >
                      +1 month
                    </button>
                    <button
                      onClick={() =>
                        setAction({
                          path: `admin/verification/stores/${store.id}/unlimited`,
                          title: `Give ${store.name} unlimited verification`,
                          description:
                            'The blue tick stays with no end date until an administrator revokes it. It is not tied to the plan or subscription.',
                          reasons: [
                            'Lifetime partner shop',
                            'Special arrangement',
                            'Administrator adjustment',
                          ],
                        })
                      }
                    >
                      Forever
                    </button>
                  </>
                ) : (
                  <span className="panel-pill muted">Unlimited</span>
                )}
                <button
                  onClick={() =>
                    setAction({
                      path: `admin/verification/stores/${store.id}/revoke`,
                      title: `Revoke ${store.name}'s blue tick`,
                      description:
                        'The tick disappears immediately and pending renewal requests for this shop are closed.',
                      reasons: [
                        'Verification no longer valid',
                        'Owner requested removal',
                        'Identity concern',
                      ],
                    })
                  }
                >
                  Revoke
                </button>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="No verified shops yet">
            <p>Approve a request above to start the first monthly badge.</p>
          </Empty>
        )}
      </section>
      {action && (
        <ConfirmAction
          {...action}
          id={id}
          close={() => setAction(undefined)}
          done={() => setAction(undefined)}
        />
      )}
    </>
  );
}
function Detail({
  resource,
  item,
  id,
  scoped = false,
  close,
  assign,
}: {
  resource: Resource;
  item: PanelRecord;
  id: string;
  scoped?: boolean;
  close: () => void;
  assign: (user: PanelRecord) => void;
}) {
  const query = useQuery({
    queryKey: ['panel', id, resource, item.id],
    queryFn: ({ signal }) =>
      getJson<PanelRecord>(`admin/data/${resource}/${item.id}`, signal),
  });
  const data = query.data ?? item;
  const [changingRole, setChangingRole] = useState(false);
  const [editingStore, setEditingStore] = useState(false);
  const [action, setAction] = useState<{
    path: string;
    title: string;
    description?: string;
    body?: object;
    reasons: string[];
  }>();
  const imageKeys = [
    ...(data.imageKeys ?? []),
    data.logoKey,
    data.bannerKey,
  ].filter((key): key is string => Boolean(key));
  return (
    <Modal title={recordName(data)} onClose={close}>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Retry error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <p className="panel-muted">
            {data.description || 'No description provided.'}
          </p>
          <dl className="panel-details">
            <div>
              <dt>Owner</dt>
              <dd>
                {data.owner?.displayName || data.displayName || '—'}
                <small>{data.owner?.email || data.email}</small>
              </dd>
            </div>
            {data.store && (
              <div>
                <dt>Store</dt>
                <dd className="notranslate">{data.store.name}</dd>
              </div>
            )}
            {data.plan && (
              <div>
                <dt>Plan</dt>
                <dd>{data.plan.name}</dd>
              </div>
            )}
            {data.priceCents != null && (
              <div>
                <dt>Price</dt>
                <dd>
                  {formatProductPrice(data.priceCents, data.currency || 'USD')}
                </dd>
              </div>
            )}
            <div>
              <dt>Created</dt>
              <dd>{dateLabel(data.createdAt)}</dd>
            </div>
            {resource === 'users' && data.phone && (
              <div>
                <dt>Phone</dt>
                <dd>
                  <a href={`tel:${data.phone}`} className="notranslate">
                    {data.phone}
                  </a>
                </dd>
              </div>
            )}
            {resource === 'users' && (
              <div>
                <dt>Role</dt>
                <dd>
                  {data.role === 'admin' ? 'Administrator' : 'User'}
                  {data.roleManagedByEnvironment && (
                    <small>Managed by server configuration</small>
                  )}
                </dd>
              </div>
            )}
            {resource === 'users' && data.role === 'admin' && (
              <div>
                <dt>Store access</dt>
                <dd>
                  {data.adminScope === 'stores'
                    ? data.adminStores?.length
                      ? data.adminStores.map((shop) => shop.name).join(', ')
                      : 'No shops assigned'
                    : 'All stores'}
                  {data.adminScope === 'stores' && (
                    <small>Limited to the assigned shops</small>
                  )}
                </dd>
              </div>
            )}
            {resource === 'stores' && (
              <>
                <div>
                  <dt>Owner status</dt>
                  <dd>
                    {data.status === 'active'
                      ? 'Online'
                      : data.status === 'offline'
                        ? 'Off'
                        : data.status === 'trashed'
                          ? 'In Trash'
                          : 'Archived'}
                  </dd>
                </div>
                <div>
                  <dt>Administrator restriction</dt>
                  <dd>
                    {data.adminArchivedAt ? 'Hidden by administrator' : 'None'}
                  </dd>
                </div>
                <div>
                  <dt>Verification</dt>
                  <dd>
                    {isStoreVerified(data)
                      ? data.verificationBadgeExpiresAt
                        ? `Active until ${dateLabel(data.verificationBadgeExpiresAt)}`
                        : 'Lifetime grant'
                      : 'Not active'}
                  </dd>
                </div>
              </>
            )}
            {resource === 'subscriptions' && (
              <>
                <div>
                  <dt>Status</dt>
                  <dd>{data.status}</dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>{dateLabel(data.expiresAt)}</dd>
                </div>
              </>
            )}
          </dl>
          {!!imageKeys.length && (
            <div className="panel-photo-grid">
              {imageKeys.map((key) => (
                <img
                  key={key}
                  src={storeMediaUrl(key)}
                  alt="Store content"
                  loading="lazy"
                />
              ))}
            </div>
          )}
          {data.media?.map((media) =>
            media.key ? (
              media.kind === 'video' ? (
                <video
                  className="panel-preview-media"
                  key={media.id}
                  controls
                  preload="metadata"
                  src={storeMediaUrl(media.key)}
                />
              ) : (
                <img
                  className="panel-preview-media"
                  key={media.id}
                  src={storeMediaUrl(media.key)}
                  alt="Post content"
                />
              )
            ) : (
              <p key={media.id}>Media: {media.status}</p>
            ),
          )}
          <div className="panel-actions">
            {resource === 'users' && (
              <button className="panel-primary" onClick={() => assign(data)}>
                Assign subscription
              </button>
            )}
            {resource === 'users' &&
              data.roleManagedByEnvironment !== true &&
              data.id !== id && (
                <button onClick={() => setChangingRole(true)}>
                  Change role &amp; store access
                </button>
              )}
            {resource === 'stores' && (
              <>
                {data.status !== 'trashed' && (
                  <Link className="panel-secondary" to={`/stores/${data.slug}`}>
                    Open storefront
                  </Link>
                )}
                {!scoped && data.status !== 'trashed' && (
                  <button onClick={() => setEditingStore(true)}>
                    Edit shop details
                  </button>
                )}
                {!scoped && (
                  <>
                    {isStoreVerified(data) &&
                      data.verificationBadgeExpiresAt && (
                        <button
                          onClick={() =>
                            setAction({
                              path: `admin/verification/stores/${data.id}/extend`,
                              title: `Give ${recordName(data)} another month`,
                              description:
                                'The new month starts where the current one ends. Any pending renewal from this shop is approved too.',
                              reasons: [
                                'Monthly renewal paid',
                                'Payment received by transfer',
                                'Administrator adjustment',
                              ],
                            })
                          }
                        >
                          +1 month
                        </button>
                      )}
                    {!(
                      isStoreVerified(data) && !data.verificationBadgeExpiresAt
                    ) && (
                      <button
                        onClick={() =>
                          setAction({
                            path: `admin/verification/stores/${data.id}/unlimited`,
                            title: `Give ${recordName(data)} unlimited verification`,
                            description:
                              'The blue tick stays with no end date until an administrator revokes it. It is not tied to the plan or subscription.',
                            reasons: [
                              'Lifetime partner shop',
                              'Special arrangement',
                              'Administrator adjustment',
                            ],
                          })
                        }
                      >
                        {isStoreVerified(data)
                          ? 'Make unlimited'
                          : 'Grant forever'}
                      </button>
                    )}
                    <button
                      className="panel-primary"
                      onClick={() =>
                        setAction({
                          path: `admin/stores/${data.id}/badge`,
                          title: isStoreVerified(data)
                            ? 'Revoke verification badge'
                            : 'Grant verification badge',
                          body: { enabled: !isStoreVerified(data) },
                          reasons: isStoreVerified(data)
                            ? [
                                'Verification no longer valid',
                                'Owner requested removal',
                              ]
                            : [
                                'Store identity reviewed',
                                'Business ownership confirmed',
                              ],
                        })
                      }
                    >
                      {isStoreVerified(data) ? 'Revoke badge' : 'Grant badge'}
                    </button>
                    {data.status === 'trashed' && (
                      <button
                        className="store-trash-action"
                        onClick={() =>
                          setAction({
                            path: `admin/stores/${data.id}/purge`,
                            title: `Permanently delete ${recordName(data)}`,
                            description:
                              'This removes the store, its products, posts, and uploaded media permanently. This cannot be undone.',
                            reasons: [
                              'Owner requested permanent deletion',
                              'Store abandoned',
                              'Content policy removal',
                            ],
                          })
                        }
                      >
                        Delete permanently
                      </button>
                    )}
                  </>
                )}
              </>
            )}
            {['stores', 'products', 'posts'].includes(resource) && (
              <button
                onClick={() =>
                  setAction({
                    path: `admin/${resource}/${data.id}/${data.adminArchivedAt ? 'restore' : 'archive'}`,
                    title: data.adminArchivedAt
                      ? 'Restore visibility'
                      : 'Hide this content',
                    reasons: data.adminArchivedAt
                      ? ['Review completed', 'Issue resolved']
                      : [
                          'Community guidelines concern',
                          'Owner requested removal',
                        ],
                  })
                }
              >
                {data.adminArchivedAt ? 'Restore visibility' : 'Hide content'}
              </button>
            )}
            {resource === 'subscriptions' && data.status === 'active' && (
              <button
                onClick={() =>
                  setAction({
                    path: `admin/subscriptions/${data.id}/cancel`,
                    title: 'Cancel subscription',
                    reasons: [
                      'Owner requested cancellation',
                      'Subscription assigned in error',
                    ],
                  })
                }
              >
                Cancel subscription
              </button>
            )}
            {resource === 'subscriptions' && data.status === 'active' && (
              <button
                className="panel-primary"
                onClick={() =>
                  assign({
                    id: data.userId ?? data.owner?.id ?? '',
                    displayName: data.owner?.displayName,
                    email: data.owner?.email,
                    phone: data.owner?.phone,
                  })
                }
              >
                Change plan
              </button>
            )}
          </div>
        </>
      )}
      {action && (
        <ConfirmAction
          {...action}
          id={id}
          close={() => setAction(undefined)}
          done={close}
        />
      )}
      {changingRole && <ChangeRole user={data} adminId={id} close={close} />}
      {editingStore && (
        <EditStore
          store={data}
          adminId={id}
          close={() => setEditingStore(false)}
        />
      )}
    </Modal>
  );
}
function ConfirmAction({
  path,
  title,
  description,
  body = {},
  reasons,
  id,
  close,
  done,
}: {
  path: string;
  title: string;
  description?: string;
  body?: object;
  reasons: string[];
  id: string;
  close: () => void;
  done: () => void;
}) {
  const [reason, setReason] = useState(reasons[0] || 'Reviewed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const client = useQueryClient();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await mutate(path, { ...body, reason });
      await client.invalidateQueries({ queryKey: ['panel', id] });
      done();
    } catch (e) {
      setError(panelError(e));
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={close} busy={busy}>
      <form onSubmit={(e) => void submit(e)} className="panel-form">
        {description && <p>{description}</p>}
        <p>This change is recorded in the administrative activity log.</p>
        <label>
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {reasons.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        {error && <Notice error>{error}</Notice>}
        <div className="panel-actions">
          <button disabled={busy} type="button" onClick={close}>
            Go back
          </button>
          <button
            disabled={busy}
            className={
              path.endsWith('/purge')
                ? 'panel-primary store-trash-confirm'
                : 'panel-primary'
            }
          >
            {busy ? 'Saving…' : 'Confirm change'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ChangeRole({
  user,
  adminId,
  close,
}: {
  user: PanelRecord;
  adminId: string;
  close: () => void;
}) {
  const current = user.role === 'admin' ? 'admin' : 'user';
  const currentScope = user.adminScope === 'stores' ? 'stores' : 'all';
  const currentStores = user.adminStoreIds ?? [];
  const [role, setRole] = useState<'user' | 'admin'>(current);
  const [scope, setScope] = useState<'all' | 'stores'>(currentScope);
  const [storeIds, setStoreIds] = useState<string[]>(currentStores);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const client = useQueryClient();
  const label = user.displayName || user.email || 'this account';
  const scopeChanged =
    role === 'admin' &&
    (scope !== currentScope ||
      [...storeIds].sort().join(',') !== [...currentStores].sort().join(','));
  const changed = role !== current || scopeChanged;
  const missingShops =
    role === 'admin' && scope === 'stores' && storeIds.length === 0;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !changed || missingShops || reason.trim().length < 3) return;
    setBusy(true);
    setError('');
    try {
      // An existing administrator only changes the shop reach; the role
      // endpoint is reserved for actual promotions and demotions.
      if (current === 'admin' && role === 'admin') {
        await mutate(
          `admin/users/${user.id}/scope`,
          {
            scope,
            ...(scope === 'stores' ? { storeIds } : {}),
            reason: reason.trim(),
          },
          'PATCH',
        );
      } else {
        await mutate(
          `admin/users/${user.id}/role`,
          {
            role,
            reason: reason.trim(),
            ...(role === 'admin' ? { scope } : {}),
            ...(role === 'admin' && scope === 'stores' ? { storeIds } : {}),
          },
          'PATCH',
        );
      }
      await client.invalidateQueries({ queryKey: ['panel', adminId] });
      setSaved(true);
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Change role and store access" onClose={close} busy={busy}>
      {saved ? (
        <>
          <Notice>
            {current === 'admin' && role === 'admin' ? (
              <>Store access for {label} is updated.</>
            ) : (
              <>
                {label} is now{' '}
                {role === 'admin' ? 'an administrator' : 'a regular user'}. They
                were signed out and must sign in again.
              </>
            )}
          </Notice>
          <div className="panel-actions">
            <button className="panel-primary" onClick={close}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form className="panel-form" onSubmit={(e) => void submit(e)}>
          <div className="panel-note">
            <Users size={20} />
            <div>
              <strong>{user.displayName || 'Account'}</strong>
              <small>{user.email}</small>
            </div>
          </div>
          <fieldset>
            <legend>Role</legend>
            <div className="panel-plan-options">
              <label
                className={`panel-choice ${role === 'user' ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="role"
                  value="user"
                  checked={role === 'user'}
                  onChange={() => setRole('user')}
                />
                <strong>User</strong>
                <span>Own storefront, products, and posts only.</span>
              </label>
              <label
                className={`panel-choice ${role === 'admin' ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="role"
                  value="admin"
                  checked={role === 'admin'}
                  onChange={() => setRole('admin')}
                />
                <strong>Administrator</strong>
                <span>Admin workspace access. Choose their reach below.</span>
              </label>
            </div>
          </fieldset>
          {role === 'admin' && (
            <fieldset>
              <legend>Store access</legend>
              <div className="panel-plan-options">
                <label
                  className={`panel-choice ${scope === 'all' ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="scope"
                    value="all"
                    checked={scope === 'all'}
                    onChange={() => setScope('all')}
                  />
                  <strong>All stores</strong>
                  <span>
                    Full platform oversight: users, plans, subscriptions,
                    verification, boost, branding, and SEO.
                  </span>
                </label>
                <label
                  className={`panel-choice ${scope === 'stores' ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="scope"
                    value="stores"
                    checked={scope === 'stores'}
                    onChange={() => setScope('stores')}
                  />
                  <strong>Only selected stores</strong>
                  <span>
                    They see only these shops and their content. Plans,
                    verification, branding, and shop creation stay with you.
                  </span>
                </label>
              </div>
              {scope === 'stores' && (
                <StorePicker
                  adminId={adminId}
                  value={storeIds}
                  onChange={setStoreIds}
                />
              )}
              {missingShops && (
                <p className="panel-muted">
                  Choose at least one store, or switch back to all stores.
                </p>
              )}
            </fieldset>
          )}
          <p className="panel-muted">
            {current === 'admin' && role === 'admin'
              ? 'New shop access applies the next time they load the admin workspace.'
              : `Changing the role signs ${label} out of every session; they regain access after signing in again.`}
          </p>
          <label>
            Reason
            <textarea
              required
              minLength={3}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this access changing?"
            />
            <small>Recorded in the administrative activity log.</small>
          </label>
          {error && <Notice error>{error}</Notice>}
          <div className="panel-actions">
            <button type="button" disabled={busy} onClick={close}>
              Go back
            </button>
            <button
              className="panel-primary"
              disabled={
                busy || !changed || missingShops || reason.trim().length < 3
              }
            >
              {busy ? 'Saving…' : 'Save access'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// Searchable multi-select of shops for a store-scoped administrator. The
// server still enforces the same boundary; this picker only shapes the request.
function StorePicker({
  adminId,
  value,
  onChange,
}: {
  adminId: string;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ['panel', adminId, 'admin-store-picker', search, offset],
    queryFn: ({ signal }) =>
      getJson<Page<PanelRecord>>(
        `admin/data/stores?limit=10&offset=${offset}&archive=all${
          search ? `&search=${encodeURIComponent(search)}` : ''
        }`,
        signal,
      ),
  });
  const toggle = (storeId: string) =>
    onChange(
      value.includes(storeId)
        ? value.filter((item) => item !== storeId)
        : [...value, storeId],
    );
  return (
    <div className="panel-muted">
      <p>
        {value.length
          ? `${value.length} ${value.length === 1 ? 'store' : 'stores'} selected`
          : 'No stores selected yet'}
      </p>
      <div className="panel-toolbar">
        <label className="panel-search">
          <Search size={18} />
          <input
            aria-label="Find a store"
            placeholder="Search shops by name"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              setSearch(input);
              setOffset(0);
            }}
            maxLength={100}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setSearch(input);
            setOffset(0);
          }}
        >
          Search
        </button>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Retry error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <div className="panel-plan-options">
            {query.data.items
              .filter((store) => store.status !== 'trashed')
              .map((store) => (
                <label
                  className={`panel-choice ${value.includes(store.id) ? 'selected' : ''}`}
                  key={store.id}
                >
                  <input
                    type="checkbox"
                    checked={value.includes(store.id)}
                    onChange={() => toggle(store.id)}
                  />
                  <strong className="notranslate">
                    {store.name || 'Shop'}
                  </strong>
                  <span>{store.slug}</span>
                </label>
              ))}
          </div>
          {!query.data.items.some((store) => store.status !== 'trashed') && (
            <p>No matching stores.</p>
          )}
          <Pagination
            total={query.data.total}
            offset={offset}
            onChange={setOffset}
          />
        </>
      )}
    </div>
  );
}
function AssignSubscription({
  user,
  id,
  close,
}: {
  user: PanelRecord | null;
  id: string;
  close: () => void;
}) {
  const [selected, setSelected] = useState(user);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [planId, setPlanId] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('LB');
  const [date, setDate] = useState('');
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const client = useQueryClient();
  const users = useQuery({
    queryKey: ['panel', id, 'user-picker', search, offset],
    queryFn: ({ signal }) =>
      getJson<Page<PanelRecord>>(
        `admin/data/users?limit=20&offset=${offset}&search=${encodeURIComponent(search)}&archive=active`,
        signal,
      ),
    enabled: !selected,
  });
  const plans = useQuery({
    queryKey: ['panel', id, 'plans'],
    queryFn: ({ signal }) =>
      getJson<Page<PanelRecord>>('admin/data/plans?limit=100', signal),
  });
  const current = useQuery({
    queryKey: ['panel', id, 'user-subscription', selected?.id],
    queryFn: ({ signal }) =>
      getJson<Page<PanelRecord>>(
        `admin/data/subscriptions?ownerId=${selected!.id}&status=active&limit=20`,
        signal,
      ),
    enabled: Boolean(selected),
  });
  const freePlan =
    plans.data?.items.find((plan) => plan.id === planId)?.slug === 'free';
  // Re-assigning shows the number already on record. The country list only
  // supplies the dial code for a national format; a typed + number stands alone.
  useEffect(() => {
    const draft = phoneDraft(selected?.phone);
    setCountry(draft.country);
    setPhone(draft.number);
  }, [selected?.id, selected?.phone]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected || !planId || !phone.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await mutate('admin/subscriptions/assign', {
        userId: selected.id,
        planId,
        phone: phone.trim(),
        phoneCountryCode: dialCodeFor(country),
        ...(custom
          ? { expiresAt: new Date(`${date}T23:59:59`).toISOString() }
          : {}),
      });
      await client.invalidateQueries({ queryKey: ['panel', id] });
      setSaved(true);
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Assign a subscription" onClose={close} busy={busy}>
      {saved ? (
        <>
          <Notice>Subscription assigned successfully.</Notice>
          <button className="panel-primary" onClick={close}>
            Done
          </button>
        </>
      ) : !selected ? (
        <>
          <p>First, choose the store owner.</p>
          <form
            className="panel-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(input);
              setOffset(0);
            }}
          >
            <input
              aria-label="Find a user"
              placeholder="Search name, email or phone"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={100}
            />
            <button>Search</button>
          </form>
          {users.isPending ? (
            <Loading />
          ) : users.isError ? (
            <Retry error={users.error} retry={() => void users.refetch()} />
          ) : (
            <>
              {users.data.items.map((u) => (
                <button
                  className="panel-picker-row"
                  key={u.id}
                  onClick={() => setSelected(u)}
                >
                  <strong>{u.displayName}</strong>
                  <small>{u.email}</small>
                  {u.phone && <small className="notranslate">{u.phone}</small>}
                </button>
              ))}
              {!users.data.items.length && <p>No matching users.</p>}
              <Pagination
                total={users.data.total}
                offset={offset}
                onChange={setOffset}
              />
            </>
          )}
        </>
      ) : (
        <form className="panel-form" onSubmit={(e) => void submit(e)}>
          <div className="panel-note">
            <Users size={20} />
            <div>
              <strong>{selected.displayName}</strong>
              <small>{selected.email}</small>
            </div>
            <button type="button" onClick={() => setSelected(null)}>
              Change
            </button>
          </div>
          {current.isPending ? (
            <Loading />
          ) : current.isError ? (
            <Retry error={current.error} retry={() => void current.refetch()} />
          ) : (
            <p className="panel-muted">
              Current:{' '}
              {current.data.items.find(
                (s) =>
                  (!s.expiresAt || Date.parse(s.expiresAt) > Date.now()) &&
                  (!s.startsAt || Date.parse(s.startsAt) <= Date.now()),
              )?.plan?.name || 'Free plan'}
              . A new assignment replaces the current subscription.
            </p>
          )}
          <fieldset>
            <legend>Contact phone</legend>
            <div className="panel-field-grid">
              <label>
                Country
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                >
                  {PHONE_COUNTRIES.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name} ({item.dialCode})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Phone number
                <input
                  required
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={30}
                  placeholder={country === 'LB' ? '03 123 456' : '50 123 4567'}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
            </div>
            <p className="panel-muted">
              No Lebanese number? Choose the person&apos;s country above, or
              type the complete number starting with + for any other country.
              Only administrators can see it.
            </p>
          </fieldset>
          <fieldset>
            <legend>Choose a plan</legend>
            {plans.isPending ? (
              <Loading />
            ) : plans.isError ? (
              <Retry error={plans.error} retry={() => void plans.refetch()} />
            ) : (
              <div className="panel-plan-options">
                {plans.data.items
                  .filter((p) => p.isActive)
                  .map((p) => (
                    <label
                      className={`panel-choice ${planId === p.id ? 'selected' : ''}`}
                      key={p.id}
                    >
                      <input
                        required
                        type="radio"
                        name="plan"
                        value={p.id}
                        checked={planId === p.id}
                        onChange={() => {
                          setPlanId(p.id);
                          // Free assignments are always trials; a custom end
                          // date beyond the trial cap is rejected by the API.
                          if (p.slug === 'free') setCustom(false);
                        }}
                      />
                      <strong>{p.name}</strong>
                      <span>
                        {formatProductPrice(
                          p.priceCents || '0',
                          p.currency || 'USD',
                        )}{' '}
                        / {p.billingCycle}
                      </span>
                    </label>
                  ))}
                {!plans.data.items.some((p) => p.isActive) && (
                  <p>No active plans are available.</p>
                )}
              </div>
            )}
          </fieldset>
          <label>
            Duration
            <select
              value={freePlan ? 'default' : custom ? 'custom' : 'default'}
              disabled={freePlan}
              onChange={(e) => setCustom(e.target.value === 'custom')}
            >
              <option value="default">
                {freePlan
                  ? 'Use the configured trial length'
                  : "Use the plan's normal duration"}
              </option>
              <option value="custom">Choose an expiry date</option>
            </select>
          </label>
          {freePlan && (
            <p className="panel-muted">
              Free-plan assignments are a trial and are capped to the configured
              trial length. Assign a paid plan for longer access.
            </p>
          )}
          {custom && (
            <label>
              Expires on
              <input
                type="date"
                required
                min={new Date().toLocaleDateString('en-CA')}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          )}
          {error && <Notice error>{error}</Notice>}
          <button
            className="panel-primary"
            disabled={
              busy ||
              !planId ||
              !phone.trim() ||
              current.isPending ||
              current.isError
            }
          >
            {busy ? 'Assigning…' : 'Confirm subscription'}
          </button>
        </form>
      )}
    </Modal>
  );
}

// A platform administrator can open a shop for any account. The shop counts
// toward nobody's plan, so the owner can start from an empty shop even after
// their own quota is full.
function CreateStore({ id, close }: { id: string; close: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [type, setType] = useState<'ecommerce' | 'restaurant_menu'>(
    'ecommerce',
  );
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState<PanelRecord | null>(null);
  const [picking, setPicking] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ name: string; slug: string }>();
  const client = useQueryClient();
  const catalog = useQuery({
    queryKey: ['panel', id, 'store-categories'],
    queryFn: ({ signal }) =>
      getJson<ShopCategoryCatalog>('stores/categories', signal),
  });
  const users = useQuery({
    queryKey: ['panel', id, 'owner-picker', search, offset],
    queryFn: ({ signal }) =>
      getJson<Page<PanelRecord>>(
        `admin/data/users?limit=10&offset=${offset}&search=${encodeURIComponent(search)}&archive=active`,
        signal,
      ),
    enabled: picking,
  });
  const slugValid = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim());
  const ready =
    name.trim().length > 0 &&
    Boolean(category) &&
    (!slug.trim() || slugValid) &&
    !busy;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      const created = await mutate<{ name: string; slug: string }>(
        'admin/stores',
        {
          ownerId: owner?.id ?? id,
          name: name.trim(),
          ...(slug.trim() ? { slug: slug.trim() } : {}),
          storeType: type,
          businessCategory: category,
          description: description.trim() || null,
        },
      );
      await client.invalidateQueries({ queryKey: ['panel', id] });
      setSaved(created);
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Create a store" onClose={close} busy={busy}>
      {saved ? (
        <>
          <Notice>
            <span className="notranslate">{saved.name}</span> is open.
          </Notice>
          <div className="panel-actions">
            <Link
              className="panel-secondary"
              to={`/stores/${saved.slug}`}
              target="_blank"
            >
              Open storefront <ArrowUpRight size={15} />
            </Link>
            <button className="panel-primary" onClick={close}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form className="panel-form" onSubmit={(e) => void submit(e)}>
          <p className="panel-muted">
            The shop is created for the owner you choose and does not use any of
            their plan's shop allowance.
          </p>
          <div className="panel-note">
            <Users size={20} />
            <div>
              <strong>{owner?.displayName || 'You (the administrator)'}</strong>
              <small>{owner?.email || 'Owner of the new shop'}</small>
            </div>
            <button type="button" onClick={() => setPicking((open) => !open)}>
              {owner ? 'Change owner' : 'Choose another owner'}
            </button>
          </div>
          {picking && (
            <>
              <div className="panel-toolbar">
                <label className="panel-search">
                  <Search size={18} />
                  <input
                    aria-label="Find an owner"
                    placeholder="Search name or email"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      setSearch(searchInput);
                      setOffset(0);
                    }}
                    maxLength={100}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setSearch(searchInput);
                    setOffset(0);
                  }}
                >
                  Search
                </button>
              </div>
              {users.isPending ? (
                <Loading />
              ) : users.isError ? (
                <Retry error={users.error} retry={() => void users.refetch()} />
              ) : (
                <>
                  {users.data.items.map((account) => (
                    <button
                      className="panel-picker-row"
                      type="button"
                      key={account.id}
                      onClick={() => {
                        setOwner(account);
                        setPicking(false);
                      }}
                    >
                      <strong>{account.displayName}</strong>
                      <small>{account.email}</small>
                    </button>
                  ))}
                  {!users.data.items.length && <p>No matching users.</p>}
                  <Pagination
                    total={users.data.total}
                    offset={offset}
                    onChange={setOffset}
                  />
                </>
              )}
            </>
          )}
          <label>
            Store name
            <input
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="A name people will remember"
            />
          </label>
          <label>
            Web address (optional)
            <input
              maxLength={191}
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="my-new-shop"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
            />
            <small>
              Leave it empty to build one from the store name. Use lowercase
              letters, numbers, and dashes.
            </small>
          </label>
          <fieldset>
            <legend>Shop type</legend>
            <div className="panel-plan-options">
              <label
                className={`panel-choice ${type === 'ecommerce' ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="store-type"
                  checked={type === 'ecommerce'}
                  onChange={() => setType('ecommerce')}
                />
                <strong>Shop</strong>
                <span>Products with prices and a cart.</span>
              </label>
              <label
                className={`panel-choice ${type === 'restaurant_menu' ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="store-type"
                  checked={type === 'restaurant_menu'}
                  onChange={() => setType('restaurant_menu')}
                />
                <strong>Restaurant / menu</strong>
                <span>A menu-first storefront.</span>
              </label>
            </div>
          </fieldset>
          <label>
            Business category
            <select
              required
              value={category}
              disabled={!catalog.data}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">
                {catalog.data ? 'Choose a category…' : 'Loading categories…'}
              </option>
              {catalog.data?.groups.map((group) => (
                <optgroup key={group.slug} label={group.label}>
                  {catalog.data.categories
                    .filter((item) => item.group === group.slug)
                    .map((item) => (
                      <option key={item.slug} value={item.slug}>
                        {item.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            {catalog.isError && (
              <small>
                Categories could not load. Retry in a moment or set one from the
                owner's store editor.
              </small>
            )}
          </label>
          <label>
            Description (optional)
            <textarea
              rows={3}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should visitors know?"
            />
          </label>
          {error && <Notice error>{error}</Notice>}
          <div className="panel-actions">
            <button type="button" disabled={busy} onClick={close}>
              Go back
            </button>
            <button className="panel-primary" disabled={!ready}>
              {busy ? 'Creating…' : 'Create store'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// Owners cannot change their shop's public address, so an administrator
// corrects it here together with the identity fields that shape the storefront.
// Lifecycle status, plans, verification, and moderation keep their own
// audited operations; this form only rewrites what visitors see.
function EditStore({
  store,
  adminId,
  close,
}: {
  store: PanelRecord;
  adminId: string;
  close: () => void;
}) {
  const initialName = store.name ?? '';
  const initialSlug = store.slug ?? '';
  const initialDescription = store.description ?? '';
  const initialType =
    store.storeType === 'restaurant_menu' ? 'restaurant_menu' : 'ecommerce';
  const initialCategory = store.businessCategory ?? '';
  const initialColor = store.brandColor || '#254e40';
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  const [description, setDescription] = useState(initialDescription);
  const [type, setType] = useState<'ecommerce' | 'restaurant_menu'>(
    initialType,
  );
  const [category, setCategory] = useState(initialCategory);
  const [color, setColor] = useState(initialColor);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ name: string; slug: string }>();
  const client = useQueryClient();
  const catalog = useQuery({
    queryKey: ['panel', adminId, 'store-categories'],
    queryFn: ({ signal }) =>
      getJson<ShopCategoryCatalog>('stores/categories', signal),
  });
  const slugValid = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim());
  const changed =
    name.trim() !== initialName ||
    slug.trim() !== initialSlug ||
    description.trim() !== initialDescription ||
    type !== initialType ||
    category !== initialCategory ||
    color !== initialColor;
  const ready =
    changed &&
    Boolean(name.trim()) &&
    Boolean(category) &&
    slugValid &&
    reason.trim().length >= 3 &&
    !busy;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      const result = await mutate<{ name: string; slug: string }>(
        `admin/stores/${store.id}`,
        {
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim() || null,
          brandColor: color,
          storeType: type,
          businessCategory: category,
          reason: reason.trim(),
        },
        'PATCH',
      );
      await client.invalidateQueries({ queryKey: ['panel', adminId] });
      setSaved({ name: result.name, slug: result.slug });
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy(false);
    }
  }
  const addressChanged = slug.trim() !== initialSlug;
  return (
    <Modal title="Edit shop details" onClose={close} busy={busy}>
      {saved ? (
        <>
          <Notice>
            <span className="notranslate">{saved.name}</span> is updated. Public
            links now use the address <strong>{saved.slug}</strong>.
            {addressChanged &&
              ' Links to the previous address no longer open this shop.'}
          </Notice>
          <div className="panel-actions">
            <Link
              className="panel-secondary"
              to={`/stores/${saved.slug}`}
              target="_blank"
            >
              Open storefront <ArrowUpRight size={15} />
            </Link>
            <button className="panel-primary" onClick={close}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form className="panel-form" onSubmit={(e) => void submit(e)}>
          <p className="panel-muted">
            Changes take effect on the public storefront immediately and are
            recorded in the administrative activity log.
          </p>
          <label>
            Store name
            <input
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="A name people will remember"
            />
          </label>
          <label>
            Web address
            <input
              required
              maxLength={191}
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="my-shop"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
            />
            <small>
              Lowercase letters, numbers, and dashes. The shop lives at /stores/
              {slug.trim() || '…'}; old links stop working when this changes.
            </small>
          </label>
          <fieldset>
            <legend>Shop type</legend>
            <div className="panel-plan-options">
              <label
                className={`panel-choice ${type === 'ecommerce' ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="edit-store-type"
                  checked={type === 'ecommerce'}
                  onChange={() => setType('ecommerce')}
                />
                <strong>Shop</strong>
                <span>Products with prices and a cart.</span>
              </label>
              <label
                className={`panel-choice ${type === 'restaurant_menu' ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="edit-store-type"
                  checked={type === 'restaurant_menu'}
                  onChange={() => setType('restaurant_menu')}
                />
                <strong>Restaurant / menu</strong>
                <span>A menu-first storefront.</span>
              </label>
            </div>
          </fieldset>
          <label>
            Business category
            <select
              required
              value={category}
              disabled={!catalog.data}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">
                {catalog.data ? 'Choose a category…' : 'Loading categories…'}
              </option>
              {catalog.data?.groups.map((group) => (
                <optgroup key={group.slug} label={group.label}>
                  {catalog.data.categories
                    .filter((item) => item.group === group.slug)
                    .map((item) => (
                      <option key={item.slug} value={item.slug}>
                        {item.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            {catalog.isError && (
              <small>
                Categories could not load. The current category is kept, and you
                can retry by reopening this form.
              </small>
            )}
          </label>
          <label className="panel-color-picker">
            Signature color
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              rows={4}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should visitors know?"
            />
          </label>
          <label>
            Reason
            <textarea
              required
              minLength={3}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this shop changing?"
            />
            <small>Recorded in the administrative activity log.</small>
          </label>
          {error && <Notice error>{error}</Notice>}
          <div className="panel-actions">
            <button type="button" disabled={busy} onClick={close}>
              Go back
            </button>
            <button className="panel-primary" disabled={!ready}>
              {busy ? 'Saving…' : 'Save shop'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
