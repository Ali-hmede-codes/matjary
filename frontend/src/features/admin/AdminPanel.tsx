import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import {
  ArrowUpRight,
  BadgeCheck,
  Clock3,
  Coins,
  CreditCard,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Store,
  Users,
  Package,
  Images,
} from 'lucide-react';
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
import { AdminBoost } from './AdminBoost';
import type { WebsiteSettings } from '../../lib/website';

type Resource = 'users' | 'stores' | 'products' | 'posts' | 'subscriptions';
export default function AdminPanel({ session }: { session: Session }) {
  return (
    <PanelShell session={session} admin>
      <Routes>
        <Route index element={<Overview id={session.user.id} />} />
        <Route
          path="users"
          element={
            <AdminList key="users" resource="users" id={session.user.id} />
          }
        />
        <Route
          path="stores"
          element={
            <AdminList key="stores" resource="stores" id={session.user.id} />
          }
        />
        <Route
          path="content"
          element={
            <AdminList
              key="products"
              resource="products"
              id={session.user.id}
            />
          }
        />
        <Route
          path="content/posts"
          element={
            <AdminList key="posts" resource="posts" id={session.user.id} />
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
          path="verification"
          element={<AdminVerification id={session.user.id} />}
        />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </PanelShell>
  );
}
function Overview({ id }: { id: string }) {
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
  ];
  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION"
        title="A clear view of your platform."
        description="Support your store owners. Keep the community moving."
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
      <LbpRateCard id={id} />
      <div className="panel-note">
        <ShieldCheck size={20} />
        <p>
          <strong>Owners create. You support.</strong>
          <br />
          Stores, products, and uploads are managed by their owners. This
          workspace is for oversight, subscriptions, and verification.
        </p>
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
function LbpRateCard({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['panel', id, 'website-settings'],
    queryFn: ({ signal }) =>
      getJson<WebsiteSettings>('admin/website-settings', signal),
  });
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (query.data)
      setRate(
        query.data.lbpExchangeRate ? String(query.data.lbpExchangeRate) : '',
      );
  }, [query.data]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const digits = rate.replace(/[,\s]/gu, '');
    if (!/^\d{1,8}$/u.test(digits) || Number(digits) > 10_000_000) {
      setError(
        'Enter whole pounds per dollar, up to 10,000,000. Use 0 to turn LBP prices off.',
      );
      setNotice('');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await mutate<WebsiteSettings>(
        'admin/website-settings',
        { lbpExchangeRate: Number(digits) },
        'PATCH',
      );
      setRate(saved.lbpExchangeRate ? String(saved.lbpExchangeRate) : '');
      queryClient.setQueryData(['panel', id, 'website-settings'], saved);
      // Storefront tabs read the public settings endpoint; refresh them too.
      await queryClient.invalidateQueries({ queryKey: ['website-settings'] });
      setNotice(
        saved.lbpExchangeRate
          ? `Saved. Shops can display prices at ${saved.lbpExchangeRate.toLocaleString('en-US')} LBP per $1.`
          : 'Saved. LBP prices are off on every shop.',
      );
    } catch (reason) {
      setError(panelError(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel-card lbp-rate-card">
      <h2>Lebanese pound exchange rate</h2>
      <p className="panel-muted">
        Shops that turn on LBP prices print this rate in small text under each
        US dollar price. Stored prices and orders stay in USD. Set 0 to hide LBP
        prices on every shop.
      </p>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Retry error={query.error} retry={() => void query.refetch()} />
      ) : (
        <form className="panel-form" onSubmit={(e) => void submit(e)}>
          <label>
            LBP per $1
            <input
              inputMode="numeric"
              value={rate}
              placeholder="89500"
              onChange={(event) => setRate(event.target.value)}
            />
          </label>
          <div className="lbp-rate-save">
            <span>
              {query.data.lbpExchangeRate
                ? `Current: ${query.data.lbpExchangeRate.toLocaleString('en-US')} LBP per $1`
                : 'LBP prices are currently off.'}
            </span>
            <button className="panel-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save rate'}
            </button>
          </div>
        </form>
      )}
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
    </section>
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
function AdminList({ resource, id }: { resource: Resource; id: string }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [archive, setArchive] = useState('all');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<PanelRecord>();
  const [assign, setAssign] = useState<PanelRecord | null | undefined>();
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
            : 'Find, review, and support the people behind the platform.'
        }
        action={
          resource === 'subscriptions' && (
            <button className="panel-primary" onClick={() => setAssign(null)}>
              Assign subscription
            </button>
          )
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
                                ? 'Administrator'
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
        description="Review identity details, approve a month, and keep trusted shops ticking. Each approval covers 30 days; a lapsed badge stays visible for 5 grace days."
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
                ) : (
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
  close,
  assign,
}: {
  resource: Resource;
  item: PanelRecord;
  id: string;
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
                  Change role
                </button>
              )}
            {resource === 'stores' && (
              <>
                {data.status !== 'trashed' && (
                  <Link className="panel-secondary" to={`/stores/${data.slug}`}>
                    Open storefront
                  </Link>
                )}
                {isStoreVerified(data) && (
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
  const [role, setRole] = useState<'user' | 'admin'>(current);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const client = useQueryClient();
  const label = user.displayName || user.email || 'this account';
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || role === current || reason.trim().length < 3) return;
    setBusy(true);
    setError('');
    try {
      await mutate(
        `admin/users/${user.id}/role`,
        { role, reason: reason.trim() },
        'PATCH',
      );
      await client.invalidateQueries({ queryKey: ['panel', adminId] });
      setSaved(true);
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Change user role" onClose={close} busy={busy}>
      {saved ? (
        <>
          <Notice>
            {label} is now{' '}
            {role === 'admin' ? 'an administrator' : 'a regular user'}. They
            were signed out and must sign in again.
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
                <span>
                  Full platform oversight, plans, and user management.
                </span>
              </label>
            </div>
          </fieldset>
          <p className="panel-muted">
            Changing the role signs {label} out of every session; they regain
            access after signing in again.
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
              placeholder="Why is this role changing?"
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
              disabled={busy || role === current || reason.trim().length < 3}
            >
              {busy ? 'Saving…' : 'Update role'}
            </button>
          </div>
        </form>
      )}
    </Modal>
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
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected || !planId || busy) return;
    setBusy(true);
    setError('');
    try {
      await mutate('admin/subscriptions/assign', {
        userId: selected.id,
        planId,
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
              placeholder="Search name or email"
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
            disabled={busy || !planId || current.isPending || current.isError}
          >
            {busy ? 'Assigning…' : 'Confirm subscription'}
          </button>
        </form>
      )}
    </Modal>
  );
}
