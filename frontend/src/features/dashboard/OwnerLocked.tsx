import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Clock3, Lock, Trash2 } from 'lucide-react';
import { dateLabel, mutate, panelError } from '../shared/panel-api';
import { Notice, PageTitle } from '../shared/PanelUI';
import { storeStatusLabel } from '../../lib/storefront';
import type { OwnerStore } from './OwnerPanel';

// Where a locked shop's bytes live. The archive is byte-exact, so this is a
// status line, not a warning about lost content.
const archiveLabel: Record<string, string> = {
  none: 'Photos and videos stay with the shop',
  pending: 'Photos and videos are queued for the archive',
  archived: 'Photos and videos are archived and return with a renewal',
  restoring: 'Photos and videos are being restored',
  failed: 'The archive needs an administrator check',
};

const HOUR_MS = 3_600_000;

// Trial-only shops are deleted after a short retention window that starts when
// the shop locks. Paid-plan shops never get a date: they stay archived.
function trialDeletionAt(store: OwnerStore, hours: number): Date | null {
  if (!hours || hours <= 0 || !store.subscriptionLockedAt) return null;
  const lockedAt = Date.parse(store.subscriptionLockedAt);
  return Number.isFinite(lockedAt)
    ? new Date(lockedAt + hours * HOUR_MS)
    : null;
}

export function RenewalAction({
  userId,
  requested,
  trial,
  onRequested,
}: {
  userId: string;
  requested: boolean;
  // The free trial cannot be renewed; only a paid plan reopens the shops.
  trial: boolean;
  onRequested: () => void;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function request() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await mutate('subscriptions/renewal-request');
      await client.invalidateQueries({ queryKey: ['panel', userId] });
      onRequested();
    } catch (reason) {
      setError(panelError(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="store-lifecycle-actions">
      {error && <Notice error>{error}</Notice>}
      {trial ? (
        <span className="panel-pill muted">
          The free trial cannot be renewed — choose a paid plan
        </span>
      ) : requested ? (
        <span className="panel-pill">
          Renewal requested — the team will contact you
        </span>
      ) : (
        <button
          type="button"
          className="panel-primary"
          disabled={busy}
          onClick={() => void request()}
        >
          {busy ? 'Sending…' : 'Renew my shops'}
        </button>
      )}
      <Link className="panel-secondary" to="/pricing">
        {trial ? 'Choose a plan' : 'Compare plans'} <ArrowUpRight size={15} />
      </Link>
    </div>
  );
}

function LockedCard({
  store,
  trialDeleteAfterHours,
  action,
}: {
  store: OwnerStore;
  trialDeleteAfterHours: number;
  action?: React.ReactNode;
}) {
  const deletesAt = trialDeletionAt(store, trialDeleteAfterHours);
  return (
    <article className="panel-card panel-locked-shop">
      <div>
        <span className="panel-pill muted">
          {storeStatusLabel[store.status]}
        </span>
        <h2 className="notranslate">{store.name}</h2>
        <p className="panel-muted">
          Frozen {dateLabel(store.subscriptionLockedAt)} ·{' '}
          {store.productsCount ?? 0} products · {store.postsCount ?? 0} posts
        </p>
        <p className="panel-muted">
          <Lock size={14} />{' '}
          {archiveLabel[store.mediaArchiveState ?? 'none'] ?? archiveLabel.none}
        </p>
        {deletesAt && (
          <p className="panel-muted">
            <Trash2 size={14} /> Permanent deletion on{' '}
            <strong>{dateLabel(deletesAt.toISOString())}</strong> unless a plan
            is activated.
          </p>
        )}
      </div>
      <div className="store-lifecycle-actions">
        <Link className="panel-secondary" to="/dashboard/plan">
          Plan details
        </Link>
        {action}
      </div>
    </article>
  );
}

// One page for every shop frozen by an expired plan. Team members never reach
// it: their access follows the shop owner's plan, not their own.
export function LockedShopsPage({
  shops,
  userId,
  renewalRequestedAt,
  trial,
  trialDeleteAfterHours,
}: {
  shops: OwnerStore[];
  userId: string;
  renewalRequestedAt: string | null;
  trial: boolean;
  trialDeleteAfterHours: number;
}) {
  const [notice, setNotice] = useState('');
  if (!shops.length)
    return (
      <>
        <PageTitle
          eyebrow="YOUR PERSONAL STUDIO"
          title="No shop is locked."
          description="A shop is locked only when its plan ends and the 7-day grace window passes."
        />
        <Link className="panel-secondary" to="/dashboard/plan">
          My plan <ArrowUpRight size={15} />
        </Link>
      </>
    );
  const firstDeletion = trial
    ? (shops
        .map((shop) => trialDeletionAt(shop, trialDeleteAfterHours))
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null)
    : null;
  return (
    <>
      <PageTitle
        eyebrow="YOUR PERSONAL STUDIO"
        title={
          trial
            ? 'Choose a plan to keep your shop.'
            : 'Renew to open your shops.'
        }
        description={
          trial && trialDeleteAfterHours > 0
            ? `Your free trial ended and the shop is locked. A trial shop is permanently deleted ${trialDeleteAfterHours} hours after it locks, so choose a plan before the date below.`
            : 'Your plan ended and the 7-day grace window is over. Nothing was deleted: every product, post and photo is stored and returns when the team confirms the renewal.'
        }
      />
      {notice && <Notice>{notice}</Notice>}
      <section className="panel-card panel-feature">
        <Clock3 size={26} />
        <h2>What happens while a shop is locked</h2>
        <ul className="verification-steps">
          <li>
            <Lock size={16} />
            <span>
              Shoppers cannot open the shop, its products or its posts.
            </span>
          </li>
          <li>
            <Lock size={16} />
            <span>
              Only this page and your plan page stay available to you.
            </span>
          </li>
          <li>
            {trial && firstDeletion ? (
              <>
                <Trash2 size={16} />
                <span>
                  The shop, its products, posts, photos and videos are deleted
                  on {dateLabel(firstDeletion.toISOString())} unless a plan is
                  activated.
                </span>
              </>
            ) : (
              <>
                <Clock3 size={16} />
                <span>
                  Photos and videos are kept byte for byte and restored after
                  the renewal, with their original quality.
                </span>
              </>
            )}
          </li>
        </ul>
        <RenewalAction
          userId={userId}
          requested={Boolean(renewalRequestedAt)}
          trial={trial}
          onRequested={() =>
            setNotice(
              'Your renewal request is saved. The team calls or messages you on WhatsApp to confirm the payment.',
            )
          }
        />
      </section>
      {shops.map((store) => (
        <LockedCard
          key={store.id}
          store={store}
          trialDeleteAfterHours={trialDeleteAfterHours}
          action={
            <Link className="panel-primary" to="/dashboard/locked">
              {trial ? 'Choose a plan' : 'Renew to open'}
            </Link>
          }
        />
      ))}
      <p className="panel-muted">
        Your own plan covers all your shops at once. A shop you help with as a
        team member follows its owner's plan, never yours.
      </p>
    </>
  );
}

// Shown when a direct link (?store=...) points at a locked shop, so the owner
// never lands on an editor that cannot save.
export function LockedShopNotice({
  store,
  member,
  trialDeleteAfterHours,
}: {
  store: OwnerStore;
  member: boolean;
  trialDeleteAfterHours: number;
}) {
  const deletesAt = trialDeletionAt(store, trialDeleteAfterHours);
  return (
    <>
      <PageTitle
        eyebrow={member ? 'SHOP TEAM' : 'YOUR STORE'}
        title="This shop is locked."
        description={
          member
            ? 'The plan of the account that owns this shop ended. Only the owner can renew it; your own plan does not cover someone else’s shop.'
            : deletesAt
              ? `Its free trial ended and the shop is locked. It is permanently deleted on ${dateLabel(deletesAt.toISOString())} unless a plan is activated.`
              : 'Its plan ended and the 7-day grace window is over. Renew to open it again; every product, post and photo returns with the original quality.'
        }
      />
      <LockedCard
        store={store}
        trialDeleteAfterHours={trialDeleteAfterHours}
        action={
          member ? undefined : (
            <Link className="panel-primary" to="/dashboard/locked">
              {trialDeleteAfterHours > 0 && deletesAt
                ? 'Choose a plan'
                : 'Renew to open'}
            </Link>
          )
        }
      />
    </>
  );
}
