import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import {
  ArrowUpRight,
  BadgeCheck,
  Coins,
  CreditCard,
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
          element={
            <AdminList
              key="verification"
              resource="stores"
              id={session.user.id}
              verification
            />
          }
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
  verification = false,
}: {
  resource: Resource;
  id: string;
  verification?: boolean;
}) {
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
  const title = verification
    ? 'Verification'
    : resource === 'products' || resource === 'posts'
      ? 'Content'
      : resource[0]!.toUpperCase() + resource.slice(1);
  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION"
        title={title}
        description={
          verification
            ? 'Recognize genuine stores with a verified badge.'
            : resource === 'subscriptions'
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
                        {recordName(item)}{' '}
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
                            item.store?.name ||
                            item.slug ||
                            'Subscription assignment'}
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
                <dd>{data.store.name}</dd>
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
