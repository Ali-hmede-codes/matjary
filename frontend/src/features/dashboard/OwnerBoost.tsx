import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  BarChart3,
  Coins,
  Megaphone,
  Pause,
  Play,
  Plus,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  dateLabel,
  getJson,
  mutate,
  panelError,
  type Page,
} from '../shared/panel-api';
import {
  Empty,
  Loading,
  Modal,
  Notice,
  PageTitle,
  Retry,
} from '../shared/PanelUI';
import type {
  BoostBalance,
  BoostCampaign,
  BoostCampaignStats,
  BoostPublicSettings,
  BoostTransaction,
} from '../../lib/api';
import { useOwner, type OwnerStore } from './OwnerPanel';

interface PostOption {
  id: string;
  title: string;
  slug: string;
  status: string;
}

const STATUS_LABELS: Record<BoostCampaign['status'], string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const CTA_LABELS = {
  visit_store: 'Visit store',
  shop_now: 'Shop now',
  learn_more: 'Learn more',
  contact: 'Get in touch',
  book_now: 'Book now',
} as const;

const coins = (value: string | number) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString() : String(value);
};

export function OwnerBoost() {
  const { session, stores, store, summary } = useOwner();
  const [notice, setNotice] = useState('');
  const [composer, setComposer] = useState<'store' | 'showcase' | undefined>();
  const client = useQueryClient();
  const balance = useQuery({
    queryKey: ['panel', session.user.id, 'boost-balance'],
    queryFn: ({ signal }) => getJson<BoostBalance>('boost/balance', signal),
  });
  const campaigns = useQuery({
    queryKey: ['panel', session.user.id, 'boost-campaigns'],
    queryFn: ({ signal }) =>
      getJson<{ campaigns: BoostCampaign[]; total: number }>(
        'boost/campaigns?limit=50',
        signal,
      ),
  });
  const transactions = useQuery({
    queryKey: ['panel', session.user.id, 'boost-transactions'],
    queryFn: ({ signal }) =>
      getJson<{ transactions: BoostTransaction[]; total: number }>(
        'boost/transactions?limit=8',
        signal,
      ),
  });
  const settings = useQuery({
    queryKey: ['panel', session.user.id, 'boost-public-settings'],
    queryFn: ({ signal }) =>
      getJson<BoostPublicSettings>('boost/settings/public', signal),
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: ['panel', session.user.id] });
  const activeStores = stores.filter((item) => item.status === 'active');
  const list = campaigns.data?.campaigns ?? [];
  const serving = list.filter((item) => item.status === 'active').length;
  const expired = summary.subscriptionState?.state === 'expired';
  async function action(id: string, path: string) {
    try {
      await mutate(`boost/campaigns/${id}/${path}`);
      await refresh();
    } catch (e) {
      setNotice(panelError(e));
    }
  }
  if (balance.isPending || campaigns.isPending) return <Loading />;
  if (balance.isError || campaigns.isError)
    return (
      <Retry
        error={balance.error || campaigns.error}
        retry={() => {
          void balance.refetch();
          void campaigns.refetch();
        }}
      />
    );
  return (
    <>
      <PageTitle
        eyebrow={store?.name || 'YOUR STUDIO'}
        title="Put your best work in front."
        description="Spend boost coins to place a post or a shop in more feeds. Administrators grant coins; you decide what deserves the spotlight."
        action={
          <button
            className="panel-primary"
            disabled={!activeStores.length || !settings.data}
            onClick={() => setComposer('showcase')}
          >
            <Plus size={16} /> New boost
          </button>
        }
      />
      {notice && <Notice>{notice}</Notice>}
      {settings.isError && (
        <Retry error={settings.error} retry={() => void settings.refetch()} />
      )}
      {expired && (
        <div className="panel-plan-banner is-expired">
          <div>
            <strong>Your trial has ended.</strong>
            <span>
              Published content stays online, but new campaigns need an active
              plan.
            </span>
          </div>
          <Link className="panel-primary" to="/pricing">
            Choose a plan <ArrowUpRight size={16} />
          </Link>
        </div>
      )}
      <div className="panel-stats">
        <div className="panel-stat">
          <span>
            Available coins <Coins size={17} />
          </span>
          <strong>{coins(balance.data.availableBalance)}</strong>
          <small>Ready to reserve for campaigns</small>
        </div>
        <div className="panel-stat">
          <span>Reserved</span>
          <strong>{coins(balance.data.pendingSpend)}</strong>
          <small>Committed to running campaigns</small>
        </div>
        <div className="panel-stat">
          <span>
            Serving now <Megaphone size={17} />
          </span>
          <strong>{serving}</strong>
          <small>
            {list.length} campaign{list.length === 1 ? '' : 's'} in total
          </small>
        </div>
      </div>
      {balance.data.availableBalanceNumber <= 0 && (
        <div className="panel-note">
          <Coins size={20} />
          <p>
            Your wallet is empty. Ask a Matjary administrator to grant boost
            coins, then come back to launch a campaign.
          </p>
        </div>
      )}
      {!activeStores.length ? (
        <Empty title="Open a shop before boosting">
          <p>Boosts are always tied to one of your active shops.</p>
          <Link className="panel-primary" to="/dashboard/stores">
            Manage my stores
          </Link>
        </Empty>
      ) : (
        <div className="panel-toolbar">
          <button
            className="panel-secondary"
            disabled={!settings.data}
            onClick={() => setComposer('showcase')}
          >
            <Sparkles size={16} /> Boost a post
          </button>
          <button
            className="panel-secondary"
            disabled={!settings.data}
            onClick={() => setComposer('store')}
          >
            <Megaphone size={16} /> Promote a shop
          </button>
        </div>
      )}
      <div className="panel-two-columns">
        <section className="panel-card panel-list-card">
          <h2>Campaigns</h2>
          {!list.length ? (
            <Empty title="No campaigns yet">
              <p>
                Choose a published post or an active shop, set a coin budget,
                and it can start reaching people right away.
              </p>
              <button
                className="panel-primary"
                disabled={!activeStores.length}
                onClick={() => setComposer('showcase')}
              >
                Create my first boost
              </button>
            </Empty>
          ) : (
            <div className="panel-record-list">
              {list.map((campaign) => (
                <article
                  className="panel-record boost-campaign"
                  key={campaign.id}
                >
                  <div className="panel-record-icon">
                    <Megaphone size={20} />
                  </div>
                  <div className="panel-record-info">
                    <h3>{campaign.name}</h3>
                    <p>
                      {campaign.targetType === 'store' ? 'Shop' : 'Post'} ·{' '}
                      {campaign.targetName || 'Your content'} ·{' '}
                      {campaign.bidStrategy.toUpperCase()}
                    </p>
                    <small>
                      Budget {coins(campaign.budgetCoins)} · spent{' '}
                      {coins(campaign.spentCoins)} · left{' '}
                      {coins(campaign.remainingCoins)}
                      {campaign.endAt
                        ? ` · ends ${dateLabel(campaign.endAt)}`
                        : ''}
                    </small>
                    {campaign.rejectionReason && (
                      <small>Review note: {campaign.rejectionReason}</small>
                    )}
                    <CampaignStatsPanel campaignId={campaign.id} />
                  </div>
                  <span
                    className={`panel-pill ${['rejected', 'cancelled', 'completed'].includes(campaign.status) ? 'muted' : ''}`}
                  >
                    {STATUS_LABELS[campaign.status]}
                  </span>
                  {campaign.status === 'active' && (
                    <button onClick={() => void action(campaign.id, 'pause')}>
                      <Pause size={14} /> Pause
                    </button>
                  )}
                  {campaign.status === 'paused' && (
                    <button
                      className="panel-primary"
                      onClick={() => void action(campaign.id, 'resume')}
                    >
                      <Play size={14} /> Resume
                    </button>
                  )}
                  {['draft', 'pending_review', 'active', 'paused'].includes(
                    campaign.status,
                  ) && (
                    <button onClick={() => void action(campaign.id, 'cancel')}>
                      <XCircle size={14} /> Cancel
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="panel-card">
          <h2>Coin activity</h2>
          {transactions.isPending ? (
            <Loading />
          ) : transactions.isError ? (
            <Retry
              error={transactions.error}
              retry={() => void transactions.refetch()}
            />
          ) : transactions.data.transactions.length ? (
            <div className="panel-record-list">
              {transactions.data.transactions.map((entry) => (
                <article className="panel-record" key={entry.id}>
                  <div className="panel-record-icon">
                    <Coins size={18} />
                  </div>
                  <div className="panel-record-info">
                    <h3>
                      {entry.type.replaceAll('_', ' ')}
                      <span
                        className={`boost-amount ${entry.amountNumber < 0 ? 'is-negative' : ''}`}
                      >
                        {entry.amountNumber > 0 ? '+' : ''}
                        {coins(entry.amount)}
                      </span>
                    </h3>
                    <p>{entry.description || 'Coin movement'}</p>
                    <small>{dateLabel(entry.createdAt)}</small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="panel-muted">
              Grants and campaign spending will appear here. Ask an
              administrator for coins to get started.
            </p>
          )}
        </section>
      </div>
      {composer && settings.data && (
        <CampaignComposer
          mode={composer}
          stores={activeStores}
          defaultStore={store}
          settings={settings.data}
          availableCoins={Number(balance.data.availableBalance)}
          close={() => setComposer(undefined)}
          done={(message) => {
            setComposer(undefined);
            setNotice(message);
            void refresh();
          }}
        />
      )}
    </>
  );
}

function CampaignStatsPanel({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['panel', 'boost-campaign-stats', campaignId],
    queryFn: ({ signal }) =>
      getJson<BoostCampaignStats>(
        `boost/campaigns/${campaignId}/performance`,
        signal,
      ),
    enabled: open,
  });
  return (
    <>
      <button
        type="button"
        className="boost-stats-toggle"
        onClick={() => setOpen(!open)}
      >
        <BarChart3 size={14} /> {open ? 'Hide performance' : 'Performance'}
      </button>
      {open &&
        (query.isPending ? (
          <small>Loading performance…</small>
        ) : query.isError ? (
          <small>Performance is unavailable right now.</small>
        ) : (
          <div className="boost-stats">
            <span>
              <strong>{query.data.totalImpressions.toLocaleString()}</strong>
              views
            </span>
            <span>
              <strong>{query.data.totalClicks.toLocaleString()}</strong>
              clicks
            </span>
            <span>
              <strong>{coins(query.data.totalSpendCoins)}</strong>
              coins spent
            </span>
            <span>
              <strong>{(query.data.avgCtr * 100).toFixed(1)}%</strong>
              CTR
            </span>
          </div>
        ))}
    </>
  );
}

function CampaignComposer({
  mode,
  stores,
  defaultStore,
  settings,
  availableCoins,
  close,
  done,
}: {
  mode: 'store' | 'showcase';
  stores: OwnerStore[];
  defaultStore?: OwnerStore;
  settings: BoostPublicSettings;
  availableCoins: number;
  close: () => void;
  done: (message: string) => void;
}) {
  const [targetType, setTargetType] = useState<'store' | 'showcase'>(mode);
  const [storeId, setStoreId] = useState(
    (defaultStore?.status === 'active' ? defaultStore.id : stores[0]?.id) || '',
  );
  const [postId, setPostId] = useState('');
  const [name, setName] = useState(
    mode === 'store' ? 'Promote my shop' : 'Boost a post',
  );
  const [budget, setBudget] = useState(String(settings.minCampaignBudgetCoins));
  const [days, setDays] = useState('7');
  const [dailyBudget, setDailyBudget] = useState('');
  const [strategy, setStrategy] = useState<'auto' | 'cpc' | 'cpm'>('auto');
  const [bid, setBid] = useState(String(settings.cpcMinBidCoins));
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  const [cta, setCta] = useState<keyof typeof CTA_LABELS>('visit_store');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const posts = useQuery({
    queryKey: ['panel', 'boost-posts', storeId],
    queryFn: ({ signal }) =>
      getJson<Page<PostOption>>(
        `dashboard/posts?storeId=${encodeURIComponent(storeId)}&status=published&limit=50`,
        signal,
      ),
    enabled: Boolean(storeId) && targetType === 'showcase',
  });
  const budgetValue = Number(budget);
  const daysValue = Number(days);
  const bidValue = Number(bid);
  const minBid =
    strategy === 'cpm' ? settings.cpmMinBidCoins : settings.cpcMinBidCoins;
  const validTarget =
    targetType === 'store' ? Boolean(storeId) : Boolean(postId);
  const valid =
    validTarget &&
    name.trim().length > 0 &&
    Number.isSafeInteger(budgetValue) &&
    budgetValue >= settings.minCampaignBudgetCoins &&
    budgetValue <= availableCoins &&
    Number.isSafeInteger(daysValue) &&
    daysValue >= 1 &&
    daysValue <= settings.maxCampaignDurationDays &&
    (!dailyBudget ||
      (Number.isSafeInteger(Number(dailyBudget)) &&
        Number(dailyBudget) > 0 &&
        Number(dailyBudget) <= budgetValue)) &&
    (strategy === 'auto' ||
      (Number.isSafeInteger(bidValue) && bidValue >= minBid));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      const endAt = new Date(Date.now() + daysValue * 86_400_000 - 60_000);
      await mutate('boost/campaigns', {
        name: name.trim(),
        targetType,
        targetId: targetType === 'store' ? storeId : postId,
        budgetCoins: String(budgetValue),
        ...(dailyBudget
          ? { dailyBudgetCoins: String(Number(dailyBudget)) }
          : {}),
        bidStrategy: strategy,
        ...(strategy === 'auto' ? {} : { bidAmountCoins: String(bidValue) }),
        targeting: {},
        ...(headline.trim() || description.trim() || cta !== 'visit_store'
          ? {
              creative: {
                ...(headline.trim() ? { headline: headline.trim() } : {}),
                ...(description.trim()
                  ? { description: description.trim() }
                  : {}),
                callToAction: cta,
              },
            }
          : {}),
        endAt: endAt.toISOString(),
      });
      done('Campaign created. It will appear in feeds while it has budget.');
    } catch (e) {
      setError(panelError(e));
      setBusy(false);
    }
  }
  const targetStore = stores.find((item) => item.id === storeId);
  return (
    <Modal
      title={targetType === 'store' ? 'Promote a shop' : 'Boost a post'}
      onClose={close}
      busy={busy}
    >
      <form className="panel-form" onSubmit={(e) => void submit(e)}>
        <fieldset>
          <legend>What should we promote?</legend>
          <div className="panel-type-options">
            <label
              className={`panel-choice ${targetType === 'showcase' ? 'selected' : ''}`}
            >
              <input
                type="radio"
                name="target"
                checked={targetType === 'showcase'}
                onChange={() => setTargetType('showcase')}
              />
              <strong>A post</strong>
              <span>Send a published photo or video into more feeds.</span>
            </label>
            <label
              className={`panel-choice ${targetType === 'store' ? 'selected' : ''}`}
            >
              <input
                type="radio"
                name="target"
                checked={targetType === 'store'}
                onChange={() => setTargetType('store')}
              />
              <strong>My shop</strong>
              <span>Appear in trending shops and sponsored placements.</span>
            </label>
          </div>
          <label>
            Shop
            <select
              value={storeId}
              onChange={(e) => {
                setStoreId(e.target.value);
                setPostId('');
              }}
            >
              {stores.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {targetType === 'showcase' && (
            <label>
              Published post
              {posts.isPending ? (
                <small>Loading posts…</small>
              ) : posts.isError ? (
                <small>Posts could not load. Try again.</small>
              ) : posts.data?.items.length ? (
                <select
                  required
                  value={postId}
                  onChange={(e) => {
                    setPostId(e.target.value);
                    const chosen = posts.data?.items.find(
                      (item) => item.id === e.target.value,
                    );
                    if (chosen) setName(`Boost ${chosen.title}`.slice(0, 100));
                  }}
                >
                  <option value="">Choose a post</option>
                  {posts.data.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              ) : (
                <small>
                  This shop has no published posts yet. Share one first, or
                  promote the shop instead.
                </small>
              )}
            </label>
          )}
        </fieldset>
        <fieldset>
          <legend>Budget and schedule</legend>
          <label>
            Campaign name
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="panel-field-grid">
            <label>
              Total budget (coins)
              <input
                type="number"
                required
                min={settings.minCampaignBudgetCoins}
                step={1}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
              <small>
                Minimum {settings.minCampaignBudgetCoins}. Budget stays reserved
                until it is spent or you cancel. Available:{' '}
                {availableCoins.toLocaleString()} coins.
              </small>
            </label>
            <label>
              Duration (days)
              <input
                type="number"
                required
                min={1}
                max={settings.maxCampaignDurationDays}
                step={1}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
              <small>Up to {settings.maxCampaignDurationDays} days.</small>
            </label>
            <label>
              Daily cap (coins, optional)
              <input
                type="number"
                min={1}
                step={1}
                value={dailyBudget}
                onChange={(e) => setDailyBudget(e.target.value)}
                placeholder="No daily cap"
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>How you pay</legend>
          <label>
            Billing
            <select
              value={strategy}
              onChange={(e) =>
                setStrategy(e.target.value as 'auto' | 'cpc' | 'cpm')
              }
            >
              <option value="auto">Automatic — pay per click</option>
              <option value="cpc">Per click (CPC)</option>
              <option value="cpm">Per 1,000 views (CPM)</option>
            </select>
          </label>
          {strategy !== 'auto' && (
            <label>
              Bid ({strategy.toUpperCase()} coins)
              <input
                type="number"
                required
                min={minBid}
                step={1}
                value={bid}
                onChange={(e) => setBid(e.target.value)}
              />
              <small>Minimum {minBid} coins.</small>
            </label>
          )}
          {strategy === 'auto' && (
            <p className="panel-muted">
              Automatic campaigns pay per click at the platform minimum of{' '}
              {settings.cpcMinBidCoins} coins.
            </p>
          )}
        </fieldset>
        <fieldset>
          <legend>Ad creative (optional)</legend>
          <label>
            Headline
            <input
              maxLength={100}
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder={targetStore?.name || 'A short, clear headline'}
            />
          </label>
          <label>
            Description
            <textarea
              maxLength={300}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why should people tap?"
            />
          </label>
          <label>
            Button
            <select
              value={cta}
              onChange={(e) =>
                setCta(e.target.value as keyof typeof CTA_LABELS)
              }
            >
              {Object.entries(CTA_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <p className="panel-muted">
          Some larger campaigns are reviewed by an administrator before they
          start. You can pause or cancel at any time.
        </p>
        {error && <Notice error>{error}</Notice>}
        <div className="panel-actions">
          <button type="button" disabled={busy} onClick={close}>
            Go back
          </button>
          <button className="panel-primary" disabled={busy || !valid}>
            {busy ? 'Creating…' : 'Create campaign'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
