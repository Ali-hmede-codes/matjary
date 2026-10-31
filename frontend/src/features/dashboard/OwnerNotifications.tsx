import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  BadgeCheck,
  Bell,
  Check,
  CreditCard,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatProductPrice } from '../../lib/storefront';
import { dateLabel, getJson, mutate, panelError } from '../shared/panel-api';
import {
  Empty,
  Loading,
  Modal,
  Notice,
  PageTitle,
  Retry,
} from '../shared/PanelUI';
import { useOwner } from './OwnerPanel';

type RenewalKind = 'subscription' | 'verification';

interface OwnerRenewalNotice {
  id: string;
  kind: RenewalKind;
  dueAt: string;
  seenAt: string | null;
  declinedAt: string | null;
  plan: {
    id: string;
    name: string;
    priceCents: string;
    currency: string;
  } | null;
  store: {
    id: string;
    name: string;
    slug: string;
    state: string;
    graceEndsAt: string | null;
    daysRemaining: number | null;
    priceCents: string;
    currency: string;
  } | null;
}

interface OwnerNotificationPage {
  unread: number;
  total: number;
  items: OwnerRenewalNotice[];
}

function useOwnerNotices(userId: string) {
  return useQuery({
    queryKey: ['panel', userId, 'notifications'],
    queryFn: ({ signal }) =>
      getJson<OwnerNotificationPage>('notifications?limit=50', signal),
    staleTime: 30_000,
  });
}

function priceLabel(notice: OwnerRenewalNotice): string | null {
  const price = notice.plan ?? notice.store;
  if (!price) return null;
  const cents = Number(price.priceCents);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  return formatProductPrice(price.priceCents, price.currency);
}

function noticeTitle(notice: OwnerRenewalNotice): string {
  if (notice.kind === 'subscription')
    return `Your ${notice.plan?.name ?? 'subscription'} plan`;
  return notice.store?.name ?? 'Your shop';
}

function dueText(notice: OwnerRenewalNotice): string {
  const past = new Date(notice.dueAt).getTime() <= Date.now();
  if (notice.kind === 'subscription')
    return past
      ? `ended ${dateLabel(notice.dueAt)}`
      : `ends ${dateLabel(notice.dueAt)}`;
  if (notice.store?.state === 'grace')
    return `ended ${dateLabel(notice.dueAt)} — the tick hides ${dateLabel(notice.store.graceEndsAt)}`;
  if (notice.store?.state === 'expired')
    return `ended ${dateLabel(notice.dueAt)} — the tick is hidden`;
  return `ends ${dateLabel(notice.dueAt)}`;
}

function reviewLink(notice: OwnerRenewalNotice): string {
  return notice.kind === 'subscription'
    ? '/dashboard/plan'
    : `/dashboard/verification?store=${encodeURIComponent(notice.store?.id ?? '')}`;
}

// One card is shared by the dashboard banner and the full tab so the wording,
// price, and decline rules never drift between the two places.
function RenewalCard({
  notice,
  compact = false,
  busy,
  onDecline,
  onDismiss,
}: {
  notice: OwnerRenewalNotice;
  compact?: boolean;
  busy: boolean;
  onDecline: (notice: OwnerRenewalNotice) => void;
  onDismiss: (notice: OwnerRenewalNotice) => void;
}) {
  const declined = Boolean(notice.declinedAt);
  const price = priceLabel(notice);
  const kindLabel =
    notice.kind === 'subscription' ? 'Plan renewal' : 'Verification renewal';
  return (
    <article
      className={`panel-renewal-card ${notice.seenAt ? '' : 'is-unread'} ${
        declined ? 'is-declined' : ''
      }`}
    >
      <div className="panel-renewal-icon">
        {notice.kind === 'subscription' ? (
          <CreditCard size={20} />
        ) : (
          <BadgeCheck size={20} />
        )}
      </div>
      <div className="panel-renewal-info">
        <small className="panel-renewal-kind">
          {kindLabel}
          {!notice.seenAt && <span className="panel-renewal-dot">New</span>}
        </small>
        <h3 className="notranslate">{noticeTitle(notice)}</h3>
        <p>
          <span className={notice.kind === 'verification' ? 'notranslate' : ''}>
            {dueText(notice)}
          </span>
          {price ? ` · ${price} per month` : ' · price arranged with the team'}
        </p>
        {declined ? (
          <small>
            You told us you will not renew. Your current period stays active
            until it ends.
          </small>
        ) : compact ? null : (
          <small>
            The team confirms renewals by phone or WhatsApp. Declining only
            stops reminders.
          </small>
        )}
      </div>
      <div className="panel-renewal-actions">
        <Link className="panel-secondary" to={reviewLink(notice)}>
          Review <ArrowUpRight size={15} />
        </Link>
        {!notice.seenAt && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDismiss(notice)}
          >
            Dismiss
          </button>
        )}
        {declined ? (
          <button
            type="button"
            className="panel-primary"
            disabled={busy}
            onClick={() => onDecline(notice)}
          >
            I want to renew
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecline(notice)}
          >
            I don't want to renew
          </button>
        )}
      </div>
    </article>
  );
}

// A quiet banner on the dashboard home. It shows live reminders even after they
// are read so the renewal stays visible until the plan or badge is renewed.
export function OwnerRenewalBanner() {
  const { session, store } = useOwner();
  const client = useQueryClient();
  const query = useOwnerNotices(session.user.id);
  const [busy, setBusy] = useState('');
  const [confirming, setConfirming] = useState<OwnerRenewalNotice | null>(null);
  const [error, setError] = useState('');
  if (store?.teamRole === 'member') return null;
  const items = query.data?.items ?? [];
  if (!items.length) {
    if (query.isError)
      return (
        <Notice error>
          Renewal reminders could not be loaded. Refresh to try again.
        </Notice>
      );
    return null;
  }
  const unread = query.data?.unread ?? 0;
  async function dismiss(notice: OwnerRenewalNotice) {
    setBusy(notice.id);
    setError('');
    try {
      await mutate(`notifications/${notice.id}/read`);
      await client.invalidateQueries({
        queryKey: ['panel', session.user.id],
      });
    } catch (reason) {
      setError(panelError(reason));
    } finally {
      setBusy('');
    }
  }
  async function respond(notice: OwnerRenewalNotice, declined: boolean) {
    setBusy(notice.id);
    setError('');
    try {
      await mutate(
        `notifications/${notice.id}/${declined ? 'decline' : 'resume'}`,
      );
      await client.invalidateQueries({
        queryKey: ['panel', session.user.id],
      });
    } catch (reason) {
      setError(panelError(reason));
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="panel-renewal-banner" aria-label="Renewal reminders">
      <header>
        <div>
          <strong>
            <Bell size={18} /> You have {items.length} renewal
            {items.length === 1 ? '' : 's'} to review
            {unread ? ` · ${unread} new` : ''}
          </strong>
          <span>
            Plans and add-on verification badges are renewed month by month.
          </span>
        </div>
        <Link className="panel-secondary" to="/dashboard/notifications">
          All notifications <ArrowUpRight size={15} />
        </Link>
      </header>
      {error && <Notice error>{error}</Notice>}
      {items.slice(0, 2).map((notice) => (
        <RenewalCard
          key={notice.id}
          notice={notice}
          compact
          busy={busy === notice.id}
          onDecline={(value) =>
            value.declinedAt ? void respond(value, false) : setConfirming(value)
          }
          onDismiss={(value) => void dismiss(value)}
        />
      ))}
      {items.length > 2 && (
        <Link className="panel-renewal-more" to="/dashboard/notifications">
          {items.length - 2} more renewal
          {items.length - 2 === 1 ? '' : 's'} <ArrowUpRight size={15} />
        </Link>
      )}
      {confirming && (
        <DecisionDialog
          notice={confirming}
          busy={busy === confirming.id}
          close={() => setConfirming(null)}
          confirm={() => {
            const value = confirming;
            setConfirming(null);
            void respond(value, true);
          }}
        />
      )}
    </section>
  );
}

function DecisionDialog({
  notice,
  busy,
  close,
  confirm,
}: {
  notice: OwnerRenewalNotice;
  busy: boolean;
  close: () => void;
  confirm: () => void;
}) {
  return (
    <Modal
      title={
        notice.kind === 'subscription'
          ? 'Do not renew this plan?'
          : 'Do not renew this badge?'
      }
      onClose={close}
      busy={busy}
    >
      <p>
        <strong className="notranslate">{noticeTitle(notice)}</strong> stays
        active until {dateLabel(notice.dueAt)}. The team will not call you about
        a renewal.
      </p>
      <p className="panel-muted">
        You can change your mind from Notifications at any time. Declining never
        removes your published content or shortens the paid period.
      </p>
      <div className="panel-actions">
        <button type="button" className="panel-secondary" onClick={close}>
          Keep renewal
        </button>
        <button type="button" className="panel-primary" onClick={confirm}>
          Yes, do not renew
        </button>
      </div>
    </Modal>
  );
}

export function OwnerNotifications() {
  const { session, store } = useOwner();
  const client = useQueryClient();
  const query = useOwnerNotices(session.user.id);
  const [busy, setBusy] = useState('');
  const [confirming, setConfirming] = useState<OwnerRenewalNotice | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  if (store?.teamRole === 'member') return null;
  if (query.isPending)
    return (
      <>
        <PageTitle title="Notifications" />
        <Loading />
      </>
    );
  if (query.isError)
    return (
      <>
        <PageTitle title="Notifications" />
        <Retry error={query.error} retry={() => void query.refetch()} />
      </>
    );
  const items = query.data.items;
  async function respond(value: OwnerRenewalNotice, declined: boolean) {
    setBusy(value.id);
    setError('');
    setNotice('');
    try {
      await mutate(
        `notifications/${value.id}/${declined ? 'decline' : 'resume'}`,
      );
      await client.invalidateQueries({ queryKey: ['panel', session.user.id] });
      setNotice(
        declined
          ? 'Your choice is saved. The paid period stays active until it ends.'
          : 'Your renewal is back on the list. The team may contact you.',
      );
    } catch (reason) {
      setError(panelError(reason));
    } finally {
      setBusy('');
    }
  }
  async function readAll() {
    setBusy('all');
    setError('');
    setNotice('');
    try {
      await mutate('notifications/read-all');
      await client.invalidateQueries({ queryKey: ['panel', session.user.id] });
      setNotice('All renewal reminders are marked as read.');
    } catch (reason) {
      setError(panelError(reason));
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="YOUR PERSONAL STUDIO"
        title="Notifications"
        description="Renewal reminders for your plan and add-on verification badges. Nothing here renews or charges automatically."
        action={
          items.length ? (
            <button
              type="button"
              className="panel-secondary"
              disabled={busy === 'all' || !query.data.unread}
              onClick={() => void readAll()}
            >
              <Check size={16} />
              {query.data.unread
                ? `Mark all as read (${query.data.unread})`
                : 'All read'}
            </button>
          ) : undefined
        }
      />
      {notice && <Notice>{notice}</Notice>}
      {error && <Notice error>{error}</Notice>}
      {items.length ? (
        <section className="panel-card panel-renewal-list">
          <div className="panel-renewal-list-head">
            <h2>Renewals</h2>
            <span className="panel-pill">
              {query.data.unread} unread of {query.data.total}
            </span>
          </div>
          <p className="panel-muted">
            The team calls or messages you on WhatsApp before the end date.
            Renewing gives you another 30 days. A badge included in your plan
            renews with the plan, so it does not appear separately.
          </p>
          {items.map((item) => (
            <RenewalCard
              key={item.id}
              notice={item}
              busy={busy === item.id}
              onDecline={(value) =>
                value.declinedAt
                  ? void respond(value, false)
                  : setConfirming(value)
              }
              onDismiss={async (value) => {
                setBusy(value.id);
                try {
                  await mutate(`notifications/${value.id}/read`);
                  await client.invalidateQueries({
                    queryKey: ['panel', session.user.id],
                  });
                } catch (reason) {
                  setError(panelError(reason));
                } finally {
                  setBusy('');
                }
              }}
            />
          ))}
        </section>
      ) : (
        <Empty title="Nothing needs renewing">
          <p>
            When a paid plan or an add-on verification badge is one day from its
            end date, the reminder appears here and on your home screen.
          </p>
          <Link className="panel-secondary" to="/dashboard/plan">
            My plan <ArrowUpRight size={15} />
          </Link>
        </Empty>
      )}
      {confirming && (
        <DecisionDialog
          notice={confirming}
          busy={busy === confirming.id}
          close={() => setConfirming(null)}
          confirm={() => {
            const value = confirming;
            setConfirming(null);
            void respond(value, true);
          }}
        />
      )}
    </>
  );
}
