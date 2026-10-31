import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Clock3, Lock } from 'lucide-react';
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
  action,
}: {
  store: OwnerStore;
  action?: React.ReactNode;
}) {
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
}: {
  shops: OwnerStore[];
  userId: string;
  renewalRequestedAt: string | null;
  trial: boolean;
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
  return (
    <>
      <PageTitle
        eyebrow="YOUR PERSONAL STUDIO"
        title="Renew to open your shops."
        description="Your plan ended and the 7-day grace window is over. Nothing was deleted: every product, post and photo is stored and returns when the team confirms the renewal."
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
            <Clock3 size={16} />
            <span>
              Photos and videos are kept byte for byte and restored after the
              renewal, with their original quality.
            </span>
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
          action={
            <Link className="panel-primary" to="/dashboard/locked">
              Renew to open
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
}: {
  store: OwnerStore;
  member: boolean;
}) {
  return (
    <>
      <PageTitle
        eyebrow={member ? 'SHOP TEAM' : 'YOUR STORE'}
        title="This shop is locked."
        description={
          member
            ? 'The plan of the account that owns this shop ended. Only the owner can renew it; your own plan does not cover someone else’s shop.'
            : 'Its plan ended and the 7-day grace window is over. Renew to open it again; every product, post and photo returns with the original quality.'
        }
      />
      <LockedCard
        store={store}
        action={
          member ? undefined : (
            <Link className="panel-primary" to="/dashboard/locked">
              Renew to open
            </Link>
          )
        }
      />
    </>
  );
}
