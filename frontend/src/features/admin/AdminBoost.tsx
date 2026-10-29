import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, Megaphone, Search, Users } from 'lucide-react';
import {
  getJson,
  mutate,
  panelError,
  type Page,
  type PanelRecord,
  type Person,
} from '../shared/panel-api';
import {
  Empty,
  Loading,
  Modal,
  Notice,
  PageTitle,
  Pagination,
  Retry,
} from '../shared/PanelUI';

type Tab = 'wallets' | 'campaigns' | 'settings';

interface WalletRow {
  userId: string;
  balance: string;
  updatedAt?: string;
  owner?: Person;
}

interface CampaignRow {
  id: string;
  name: string;
  targetType: 'store' | 'showcase';
  status: string;
  budgetCoins: string;
  spentCoins: string;
  bidStrategy: string;
  targetName?: string | null;
  targetStoreSlug?: string | null;
  rejectionReason?: string | null;
  createdAt?: string;
  owner?: Person;
}

interface TransactionRow {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  description?: string | null;
  createdAt: string;
}

interface BoostSettings {
  coinPriceCents: number;
  minPurchaseCoins: number;
  maxPurchaseCoins: number;
  defaultDailyBudgetCoins: number;
  minCampaignBudgetCoins: number;
  maxCampaignDurationDays: number;
  campaignReviewRequired: boolean;
  autoApproveThresholdCoins: number;
  cpcMinBidCoins: number;
  cpmMinBidCoins: number;
  platformFeePercent: number;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const coinLabel = (value: string | number) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString() : String(value);
};

const whenLabel = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';

export function AdminBoost({ id }: { id: string }) {
  const [tab, setTab] = useState<Tab>('wallets');
  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION"
        title="Boost & advertising"
        description="Grant coins to owners, review promoted posts and shops, and tune the rules that keep advertising fair."
      />
      <div className="panel-tabs" role="tablist" aria-label="Boost sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'wallets'}
          className={tab === 'wallets' ? 'active' : ''}
          onClick={() => setTab('wallets')}
        >
          Coin wallets
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'campaigns'}
          className={tab === 'campaigns' ? 'active' : ''}
          onClick={() => setTab('campaigns')}
        >
          Campaigns
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'settings'}
          className={tab === 'settings' ? 'active' : ''}
          onClick={() => setTab('settings')}
        >
          Settings
        </button>
      </div>
      {tab === 'wallets' && <Wallets id={id} />}
      {tab === 'campaigns' && <Campaigns id={id} />}
      {tab === 'settings' && <Settings id={id} />}
    </>
  );
}

function Wallets({ id }: { id: string }) {
  const [offset, setOffset] = useState(0);
  const [grant, setGrant] = useState<WalletRow | null | undefined>();
  const [history, setHistory] = useState<WalletRow>();
  const query = useQuery({
    queryKey: ['panel', id, 'boost-wallets', offset],
    queryFn: ({ signal }) =>
      getJson<Page<WalletRow>>(
        `admin/data/wallets?limit=20&offset=${offset}`,
        signal,
      ),
  });
  return (
    <>
      <div className="panel-toolbar">
        <span className="panel-pill">
          <Coins size={13} /> Boost coins
        </span>
        <button className="panel-primary" onClick={() => setGrant(null)}>
          <Coins size={16} /> Give coins
        </button>
      </div>
      <div className="panel-note">
        <Coins size={20} />
        <p>
          Coins let owners promote their own published posts and shops. Grants
          and deductions are permanent, idempotent, and recorded in the
          administrative activity log.
        </p>
      </div>
      <section className="panel-card panel-list-card">
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <Retry error={query.error} retry={() => void query.refetch()} />
        ) : query.data.items.length ? (
          <>
            <div className="panel-record-list">
              {query.data.items.map((wallet) => (
                <article className="panel-record" key={wallet.userId}>
                  <div className="panel-record-icon">
                    <Coins size={20} />
                  </div>
                  <div className="panel-record-info">
                    <h3>{wallet.owner?.displayName || 'Account'}</h3>
                    <p>{wallet.owner?.email || wallet.userId}</p>
                    <small>Updated {whenLabel(wallet.updatedAt)}</small>
                  </div>
                  <span className="panel-pill">
                    {coinLabel(wallet.balance)} coins
                  </span>
                  <button onClick={() => setGrant(wallet)}>Adjust</button>
                  <button onClick={() => setHistory(wallet)}>History</button>
                </article>
              ))}
            </div>
            <Pagination
              offset={offset}
              total={query.data.total}
              onChange={setOffset}
            />
          </>
        ) : (
          <Empty title="No coin wallets yet">
            <p>
              Give coins to an owner to open their wallet. They can then boost a
              post or shop from their studio.
            </p>
            <button className="panel-primary" onClick={() => setGrant(null)}>
              Give the first coins
            </button>
          </Empty>
        )}
      </section>
      {grant !== undefined && (
        <CoinGrant
          adminId={id}
          wallet={grant}
          close={() => setGrant(undefined)}
          done={() => setGrant(undefined)}
        />
      )}
      {history && (
        <WalletHistory wallet={history} close={() => setHistory(undefined)} />
      )}
    </>
  );
}

function CoinGrant({
  adminId,
  wallet,
  close,
  done,
}: {
  adminId: string;
  wallet: WalletRow | null;
  close: () => void;
  done: () => void;
}) {
  const [picked, setPicked] = useState<WalletRow | null>(wallet);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [mode, setMode] = useState<'add' | 'deduct'>('add');
  const [amount, setAmount] = useState('100');
  const [reason, setReason] = useState('Promotional boost coins');
  const [operationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const client = useQueryClient();
  const users = useQuery({
    queryKey: ['panel', adminId, 'boost-user-picker', search, offset],
    queryFn: ({ signal }) =>
      getJson<Page<PanelRecord>>(
        `admin/data/users?limit=20&offset=${offset}&archive=active&search=${encodeURIComponent(search)}`,
        signal,
      ),
    enabled: !picked,
  });
  const value = Number(amount);
  const valid =
    Number.isSafeInteger(value) && value > 0 && reason.trim().length >= 3;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!picked || !valid || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await mutate<{ newBalance: string }>(
        'boost/admin/balance/adjust',
        {
          userId: picked.userId,
          amount: mode === 'add' ? value : -value,
          description: reason.trim(),
          operationId,
        },
      );
      await client.invalidateQueries({ queryKey: ['panel', adminId] });
      setSaved(result.newBalance);
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={saved ? 'Balance updated' : 'Adjust boost coins'}
      onClose={close}
      busy={busy}
    >
      {saved ? (
        <>
          <Notice>
            {picked?.owner?.displayName || 'This account'} now holds{' '}
            {coinLabel(saved)} boost coins.
          </Notice>
          <div className="panel-actions">
            <button className="panel-primary" onClick={done}>
              Done
            </button>
          </div>
        </>
      ) : !picked ? (
        <>
          <p>Choose the account that should receive or lose coins.</p>
          <form
            className="panel-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(input.trim());
              setOffset(0);
            }}
          >
            <label className="panel-search">
              <Search size={18} />
              <input
                aria-label="Find a user"
                placeholder="Search name or email"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={100}
              />
            </label>
            <button type="submit">Search</button>
          </form>
          {users.isPending ? (
            <Loading />
          ) : users.isError ? (
            <Retry error={users.error} retry={() => void users.refetch()} />
          ) : (
            <>
              {users.data.items.map((user) => (
                <button
                  className="panel-picker-row"
                  key={user.id}
                  onClick={() =>
                    setPicked({
                      userId: user.id,
                      balance: '0',
                      owner: {
                        id: user.id,
                        displayName: user.displayName || 'Account',
                        email: user.email || '',
                      },
                    })
                  }
                >
                  <strong>{user.displayName || 'Account'}</strong>
                  <small>{user.email}</small>
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
              <strong>{picked.owner?.displayName || 'Account'}</strong>
              <small>{picked.owner?.email || picked.userId}</small>
            </div>
            {!wallet && (
              <button type="button" onClick={() => setPicked(null)}>
                Change
              </button>
            )}
          </div>
          <fieldset>
            <legend>Adjustment</legend>
            <div className="panel-type-options">
              <label
                className={`panel-choice ${mode === 'add' ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'add'}
                  onChange={() => setMode('add')}
                />
                <strong>Give coins</strong>
                <span>Credit the wallet. Use for promotions or support.</span>
              </label>
              <label
                className={`panel-choice ${mode === 'deduct' ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'deduct'}
                  onChange={() => setMode('deduct')}
                />
                <strong>Deduct coins</strong>
                <span>
                  Correct a mistake. Reserved campaign budgets stay protected.
                </span>
              </label>
            </div>
            <label>
              Amount (coins)
              <input
                type="number"
                required
                min={1}
                step={1}
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <div className="panel-toolbar">
              {[50, 100, 500, 1000].map((preset) => (
                <button
                  type="button"
                  key={preset}
                  onClick={() => setAmount(String(preset))}
                >
                  {preset}
                </button>
              ))}
            </div>
            <label>
              Reason
              <textarea
                required
                minLength={3}
                maxLength={500}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why are these coins changing?"
              />
              <small>Recorded in the administrative activity log.</small>
            </label>
          </fieldset>
          {error && <Notice error>{error}</Notice>}
          <div className="panel-actions">
            <button type="button" disabled={busy} onClick={close}>
              Go back
            </button>
            <button className="panel-primary" disabled={busy || !valid}>
              {busy
                ? 'Saving…'
                : mode === 'add'
                  ? 'Give coins'
                  : 'Deduct coins'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function WalletHistory({
  wallet,
  close,
}: {
  wallet: WalletRow;
  close: () => void;
}) {
  const query = useQuery({
    queryKey: ['panel', 'boost-history', wallet.userId],
    queryFn: ({ signal }) =>
      getJson<Page<TransactionRow>>(
        `admin/data/transactions?limit=50&ownerId=${wallet.userId}`,
        signal,
      ),
  });
  return (
    <Modal title="Coin history" onClose={close}>
      <p className="panel-muted">
        {wallet.owner?.displayName || wallet.userId} ·{' '}
        {coinLabel(wallet.balance)} coins
      </p>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Retry error={query.error} retry={() => void query.refetch()} />
      ) : query.data.items.length ? (
        <div className="panel-record-list">
          {query.data.items.map((entry) => (
            <article className="panel-record" key={entry.id}>
              <div className="panel-record-icon">
                <Coins size={20} />
              </div>
              <div className="panel-record-info">
                <h3>
                  {entry.type.replaceAll('_', ' ')}
                  <span
                    className={`boost-amount ${Number(entry.amount) < 0 ? 'is-negative' : ''}`}
                  >
                    {Number(entry.amount) > 0 ? '+' : ''}
                    {coinLabel(entry.amount)}
                  </span>
                </h3>
                <p>{entry.description || 'Coin movement'}</p>
                <small>{whenLabel(entry.createdAt)}</small>
              </div>
              <span className="panel-pill">
                {coinLabel(entry.balanceAfter)}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="No coin movements yet">
          <p>Grants, spending, and corrections will appear here.</p>
        </Empty>
      )}
    </Modal>
  );
}

function Campaigns({ id }: { id: string }) {
  const [status, setStatus] = useState('pending_review');
  const [offset, setOffset] = useState(0);
  const [review, setReview] = useState<{
    campaign: CampaignRow;
    action: 'approve' | 'reject';
  }>();
  const params = new URLSearchParams({
    limit: '20',
    offset: String(offset),
  });
  if (status) params.set('status', status);
  const query = useQuery({
    queryKey: ['panel', id, 'boost-campaigns', params.toString()],
    queryFn: ({ signal }) =>
      getJson<Page<CampaignRow>>(`admin/data/campaigns?${params}`, signal),
  });
  return (
    <>
      <div className="panel-toolbar">
        <label>
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="pending_review">Pending review</option>
            <option value="">All campaigns</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>
      <section className="panel-card panel-list-card">
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <Retry error={query.error} retry={() => void query.refetch()} />
        ) : query.data.items.length ? (
          <>
            <div className="panel-record-list">
              {query.data.items.map((campaign) => (
                <article className="panel-record" key={campaign.id}>
                  <div className="panel-record-icon">
                    <Megaphone size={20} />
                  </div>
                  <div className="panel-record-info">
                    <h3 className="notranslate">{campaign.name}</h3>
                    <p>
                      {campaign.owner?.displayName || 'Owner'} ·{' '}
                      {campaign.targetType === 'store' ? 'Shop' : 'Post'} boost
                      {campaign.targetName
                        ? ` · ${campaign.targetName}`
                        : ''} · {campaign.bidStrategy.toUpperCase()}
                    </p>
                    <small>
                      Budget {coinLabel(campaign.budgetCoins)} · spent{' '}
                      {coinLabel(campaign.spentCoins)} ·{' '}
                      {whenLabel(campaign.createdAt)}
                    </small>
                    {campaign.rejectionReason && (
                      <small>Rejected: {campaign.rejectionReason}</small>
                    )}
                  </div>
                  <span
                    className={`panel-pill ${['rejected', 'cancelled', 'completed'].includes(campaign.status) ? 'muted' : ''}`}
                  >
                    {STATUS_LABELS[campaign.status] || campaign.status}
                  </span>
                  {campaign.status === 'pending_review' && (
                    <>
                      <button
                        className="panel-primary"
                        onClick={() =>
                          setReview({ campaign, action: 'approve' })
                        }
                      >
                        Approve
                      </button>
                      <button
                        onClick={() =>
                          setReview({ campaign, action: 'reject' })
                        }
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {campaign.targetStoreSlug && (
                    <a
                      className="panel-secondary"
                      href={`/stores/${encodeURIComponent(campaign.targetStoreSlug)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Preview
                    </a>
                  )}
                </article>
              ))}
            </div>
            <Pagination
              offset={offset}
              total={query.data.total}
              onChange={setOffset}
            />
          </>
        ) : (
          <Empty title="Nothing waiting for review">
            <p>
              Campaigns appear here when an owner boosts a post or shop and the
              review threshold applies.
            </p>
          </Empty>
        )}
      </section>
      {review && (
        <ReviewCampaign
          adminId={id}
          campaign={review.campaign}
          action={review.action}
          close={() => setReview(undefined)}
        />
      )}
    </>
  );
}

function ReviewCampaign({
  adminId,
  campaign,
  action,
  close,
}: {
  adminId: string;
  campaign: CampaignRow;
  action: 'approve' | 'reject';
  close: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const client = useQueryClient();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || (action === 'reject' && reason.trim().length < 3)) return;
    setBusy(true);
    setError('');
    try {
      await mutate(`boost/admin/campaigns/${campaign.id}/review`, {
        action,
        ...(action === 'reject' ? { rejectionReason: reason.trim() } : {}),
      });
      await client.invalidateQueries({ queryKey: ['panel', adminId] });
      close();
    } catch (e) {
      setError(panelError(e));
      setBusy(false);
    }
  }
  return (
    <Modal
      title={action === 'approve' ? 'Approve campaign' : 'Reject campaign'}
      onClose={close}
      busy={busy}
    >
      <form className="panel-form" onSubmit={(e) => void submit(e)}>
        <p>
          {action === 'approve'
            ? `${campaign.name} will start appearing in feeds and trending shops.`
            : `${campaign.name} will stop before delivery. Its reserved budget is released.`}
        </p>
        {action === 'reject' && (
          <label>
            Reason shown to the owner
            <textarea
              required
              minLength={3}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What should the owner fix before trying again?"
            />
          </label>
        )}
        {error && <Notice error>{error}</Notice>}
        <div className="panel-actions">
          <button type="button" disabled={busy} onClick={close}>
            Go back
          </button>
          <button
            className={
              action === 'approve'
                ? 'panel-primary'
                : 'panel-primary store-trash-confirm'
            }
            disabled={busy || (action === 'reject' && reason.trim().length < 3)}
          >
            {busy
              ? 'Saving…'
              : action === 'approve'
                ? 'Approve campaign'
                : 'Reject campaign'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Settings({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ['panel', id, 'boost-settings'],
    queryFn: ({ signal }) =>
      getJson<BoostSettings>('boost/admin/settings', signal),
  });
  return (
    <section className="panel-card">
      <h2>Advertising rules</h2>
      <p className="panel-muted">
        These limits apply to every owner. Coins are granted by administrators;
        owners spend them on campaigns.
      </p>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Retry error={query.error} retry={() => void query.refetch()} />
      ) : (
        <SettingsForm adminId={id} settings={query.data} />
      )}
    </section>
  );
}

function SettingsForm({
  adminId,
  settings,
}: {
  adminId: string;
  settings: BoostSettings;
}) {
  const [values, setValues] = useState({
    coinPriceCents: String(settings.coinPriceCents),
    minPurchaseCoins: String(settings.minPurchaseCoins),
    maxPurchaseCoins: String(settings.maxPurchaseCoins),
    defaultDailyBudgetCoins: String(settings.defaultDailyBudgetCoins),
    minCampaignBudgetCoins: String(settings.minCampaignBudgetCoins),
    maxCampaignDurationDays: String(settings.maxCampaignDurationDays),
    autoApproveThresholdCoins: String(settings.autoApproveThresholdCoins),
    cpcMinBidCoins: String(settings.cpcMinBidCoins),
    cpmMinBidCoins: String(settings.cpmMinBidCoins),
    platformFeePercent: String(settings.platformFeePercent),
  });
  const [reviewRequired, setReviewRequired] = useState(
    settings.campaignReviewRequired,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const client = useQueryClient();
  const numericKeys = Object.keys(values) as (keyof typeof values)[];
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const payload: Record<string, number | boolean> = {
        campaignReviewRequired: reviewRequired,
      };
      for (const key of numericKeys) {
        const value = Number(values[key]);
        const zeroAllowed =
          key === 'autoApproveThresholdCoins' || key === 'platformFeePercent';
        const tooLarge =
          (key === 'maxCampaignDurationDays' && value > 365) ||
          (key === 'platformFeePercent' && value > 100);
        if (
          !Number.isSafeInteger(value) ||
          value < (zeroAllowed ? 0 : 1) ||
          tooLarge
        ) {
          setError(
            'Check every limit: whole numbers within the allowed range.',
          );
          setBusy(false);
          return;
        }
        payload[key] = value;
      }
      await mutate('boost/admin/settings', payload, 'PATCH');
      await client.invalidateQueries({ queryKey: ['panel', adminId] });
      setSaved(true);
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel-form" onSubmit={(e) => void submit(e)}>
      {saved && <Notice>Advertising rules updated.</Notice>}
      <fieldset>
        <legend>Review</legend>
        <label className="panel-toggle">
          <input
            type="checkbox"
            checked={reviewRequired}
            onChange={(e) => {
              setReviewRequired(e.target.checked);
              setSaved(false);
            }}
          />
          <span>
            <strong>Review larger campaigns</strong>
            <small>
              Campaigns above the auto-approval threshold wait for an
              administrator before serving.
            </small>
          </span>
        </label>
        <div className="panel-field-grid">
          <label>
            Auto-approve up to (coins)
            <input
              type="number"
              min={0}
              step={1}
              value={values.autoApproveThresholdCoins}
              onChange={(e) =>
                setValues({
                  ...values,
                  autoApproveThresholdCoins: e.target.value,
                })
              }
            />
          </label>
          <label>
            Maximum duration (days)
            <input
              type="number"
              min={1}
              max={365}
              step={1}
              value={values.maxCampaignDurationDays}
              onChange={(e) =>
                setValues({
                  ...values,
                  maxCampaignDurationDays: e.target.value,
                })
              }
            />
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Budgets</legend>
        <div className="panel-field-grid">
          <label>
            Minimum campaign (coins)
            <input
              type="number"
              min={1}
              step={1}
              value={values.minCampaignBudgetCoins}
              onChange={(e) =>
                setValues({
                  ...values,
                  minCampaignBudgetCoins: e.target.value,
                })
              }
            />
          </label>
          <label>
            Default daily budget (coins)
            <input
              type="number"
              min={1}
              step={1}
              value={values.defaultDailyBudgetCoins}
              onChange={(e) =>
                setValues({
                  ...values,
                  defaultDailyBudgetCoins: e.target.value,
                })
              }
            />
          </label>
          <label>
            Minimum CPC bid (coins)
            <input
              type="number"
              min={1}
              step={1}
              value={values.cpcMinBidCoins}
              onChange={(e) =>
                setValues({ ...values, cpcMinBidCoins: e.target.value })
              }
            />
          </label>
          <label>
            Minimum CPM bid (coins)
            <input
              type="number"
              min={1}
              step={1}
              value={values.cpmMinBidCoins}
              onChange={(e) =>
                setValues({ ...values, cpmMinBidCoins: e.target.value })
              }
            />
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Coin purchases</legend>
        <p className="panel-muted">
          Purchases are informational in this build. Coins still enter a wallet
          through an administrator grant.
        </p>
        <div className="panel-field-grid">
          <label>
            Price per coin (cents)
            <input
              type="number"
              min={1}
              step={1}
              value={values.coinPriceCents}
              onChange={(e) =>
                setValues({ ...values, coinPriceCents: e.target.value })
              }
            />
          </label>
          <label>
            Minimum purchase (coins)
            <input
              type="number"
              min={1}
              step={1}
              value={values.minPurchaseCoins}
              onChange={(e) =>
                setValues({ ...values, minPurchaseCoins: e.target.value })
              }
            />
          </label>
          <label>
            Maximum purchase (coins)
            <input
              type="number"
              min={1}
              step={1}
              value={values.maxPurchaseCoins}
              onChange={(e) =>
                setValues({ ...values, maxPurchaseCoins: e.target.value })
              }
            />
          </label>
          <label>
            Platform fee (%)
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={values.platformFeePercent}
              onChange={(e) =>
                setValues({ ...values, platformFeePercent: e.target.value })
              }
            />
          </label>
        </div>
      </fieldset>
      {error && <Notice error>{error}</Notice>}
      <div className="panel-actions">
        <button className="panel-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save advertising rules'}
        </button>
      </div>
    </form>
  );
}
