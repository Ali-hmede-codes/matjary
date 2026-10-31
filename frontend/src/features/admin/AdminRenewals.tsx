import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  Clock3,
  CreditCard,
  MessageCircle,
  Phone,
  Plus,
  Store as StoreIcon,
} from 'lucide-react';
import { formatProductPrice, storeMediaUrl } from '../../lib/storefront';
import {
  renewalWhatsAppText,
  whatsAppDigits,
  whatsAppLink,
} from '../../lib/renewal-message';
import { dateLabel, getJson, mutate, panelError } from '../shared/panel-api';
import {
  Empty,
  Loading,
  Modal,
  Notice,
  PageTitle,
  Retry,
} from '../shared/PanelUI';
import { useWebsiteSettings } from '../../hooks/useWebsiteSettings';

type RenewalKind = 'subscription' | 'verification';
type RenewalKindFilter = 'all' | RenewalKind;

interface RenewalOwner {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
}

interface SubscriptionRenewal {
  id: string;
  owner: RenewalOwner;
  plan: {
    id: string;
    name: string;
    priceCents: string;
    currency: string;
  } | null;
  expiresAt: string | null;
  daysLeft: number | null;
  declinedAt: string | null;
  notifiedAt: string | null;
  seenAt: string | null;
}

interface BadgeRenewal {
  id: string;
  owner: RenewalOwner;
  store: { id: string; name: string; slug: string; logoKey: string | null };
  expiresAt: string | null;
  graceEndsAt: string | null;
  state: string;
  visible: boolean;
  daysLeft: number | null;
  daysRemaining: number | null;
  priceCents: string;
  currency: string;
  contactPhone: string | null;
  declinedAt: string | null;
  notifiedAt: string | null;
  seenAt: string | null;
}

interface RenewalQueueResponse {
  now: string;
  counts: {
    subscription: number;
    verification: number;
    total: number;
    declined: number;
  };
  subscriptions: SubscriptionRenewal[];
  badges: BadgeRenewal[];
}

function useRenewals(id: string, kind: RenewalKindFilter) {
  return useQuery({
    queryKey: ['panel', id, 'renewals', kind],
    queryFn: ({ signal }) =>
      getJson<RenewalQueueResponse>(`admin/renewals?kind=${kind}`, signal),
  });
}

const PRESET_REASONS = [
  'Monthly renewal paid',
  'Payment received by transfer',
  'Administrator adjustment',
];

const priceOf = (
  priceCents: string | null | undefined,
  currency: string | null | undefined,
) => {
  const cents = Number(priceCents ?? 0);
  return Number.isFinite(cents) && cents > 0 && currency
    ? formatProductPrice(String(priceCents), currency)
    : null;
};

function planDueText(row: SubscriptionRenewal): string {
  const date = dateLabel(row.expiresAt);
  if (row.daysLeft == null) return `Ended ${date}`;
  if (row.daysLeft < 0) return `Lapsed · ended ${date}`;
  if (row.daysLeft === 0) return `Less than a day left · ends ${date}`;
  return `${row.daysLeft} day${row.daysLeft === 1 ? '' : 's'} left · ends ${date}`;
}

function badgeDueText(row: BadgeRenewal): string {
  const date = dateLabel(row.expiresAt);
  if (row.state === 'grace')
    return `Renewal window · ended ${date} · tick hides ${dateLabel(row.graceEndsAt)}`;
  if (row.state === 'expired') return `Ended ${date} · tick hidden`;
  if (row.daysRemaining == null) return `Renews ${date}`;
  return `${row.daysRemaining} day${row.daysRemaining === 1 ? '' : 's'} left · renews ${date}`;
}

// "Was the person actually told?" is the question this queue answers: a stored
// reminder that the owner has not opened is visibly different from none at all.
function ReminderStatus({
  notifiedAt,
  seenAt,
}: {
  notifiedAt: string | null;
  seenAt: string | null;
}) {
  if (!notifiedAt)
    return <span className="panel-pill muted">No reminder yet</span>;
  return (
    <span className={`panel-pill ${seenAt ? '' : 'renewal-unseen'}`}>
      {seenAt ? 'Reminder seen' : 'Reminder sent · not opened'}
    </span>
  );
}

interface WhatsAppTarget {
  kind: RenewalKind;
  name: string;
  planName: string | null;
  storeName: string | null;
  priceLabel: string | null;
  dueDate: string | null;
  phone: string | null;
}

function WhatsAppDialog({
  target,
  close,
}: {
  target: WhatsAppTarget;
  close: () => void;
}) {
  const { settings } = useWebsiteSettings(false);
  const [text, setText] = useState(() =>
    renewalWhatsAppText({ ...target, siteName: settings.siteName }),
  );
  const [copied, setCopied] = useState('');
  const link = whatsAppLink(target.phone, text);
  const digits = whatsAppDigits(target.phone);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Message copied. Paste it into any chat.');
    } catch {
      setCopied('Copy is unavailable here. Select the text and copy it.');
    }
  }
  return (
    <Modal title="Send a renewal message" onClose={close}>
      <p className="panel-muted">
        The message is prefilled in Arabic with the owner's name, the{' '}
        {target.kind === 'subscription' ? 'plan' : 'shop'}, and the price. Edit
        it before sending; WhatsApp opens in your own account.
      </p>
      <p>
        <Phone size={15} />{' '}
        {digits ? (
          <span className="notranslate">{target.phone}</span>
        ) : (
          <strong>No phone number on file</strong>
        )}
      </p>
      <label className="panel-form">
        <span>Message</span>
        <textarea
          dir="rtl"
          lang="ar"
          rows={8}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      {copied && <Notice>{copied}</Notice>}
      <div className="panel-actions">
        <button
          type="button"
          className="panel-secondary"
          onClick={() => void copy()}
        >
          Copy message
        </button>
        {link ? (
          <a
            className="panel-primary"
            href={link}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle size={16} /> Open WhatsApp
          </a>
        ) : (
          <button className="panel-primary" type="button" disabled>
            Add a phone number first
          </button>
        )}
      </div>
    </Modal>
  );
}

function ExtendDialog({
  id,
  kind,
  row,
  close,
}: {
  id: string;
  kind: RenewalKind;
  row: SubscriptionRenewal | BadgeRenewal;
  close: () => void;
}) {
  const client = useQueryClient();
  const [reason, setReason] = useState(PRESET_REASONS[0]!);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = kind === 'subscription' ? 'plan' : 'verification badge';
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      // The badge keeps its existing audited route; the plan has its own
      // extension endpoint so the assignment row stays the same.
      const path =
        kind === 'subscription'
          ? `admin/renewals/subscriptions/${row.id}/extend`
          : `admin/verification/stores/${row.id}/extend`;
      await mutate(path, { reason: reason.trim() });
      await client.invalidateQueries({ queryKey: ['panel', id] });
      close();
    } catch (error) {
      setError(panelError(error));
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Renew this ${title} for one month`}
      onClose={close}
      busy={busy}
    >
      <form className="panel-form" onSubmit={(event) => void submit(event)}>
        <p>
          The new month starts where the current one ends, or today when it has
          already lapsed. The owner's reminder disappears immediately.
        </p>
        <label>
          Reason for the audit log
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            {PRESET_REASONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {error && <Notice error>{error}</Notice>}
        <div className="panel-actions">
          <button type="button" className="panel-secondary" onClick={close}>
            Cancel
          </button>
          <button className="panel-primary" disabled={busy}>
            <Plus size={16} /> {busy ? 'Renewing…' : 'Add one month'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PlanRow({
  row,
  onExtend,
  onMessage,
}: {
  row: SubscriptionRenewal;
  onExtend: () => void;
  onMessage: () => void;
}) {
  const price = priceOf(row.plan?.priceCents, row.plan?.currency);
  return (
    <article
      className={`panel-record panel-renewal-row ${row.declinedAt ? 'is-declined' : ''}`}
    >
      <div className="panel-record-icon">
        <CreditCard size={20} />
      </div>
      <div className="panel-record-info">
        <h3 className="notranslate">{row.owner.displayName}</h3>
        <p>
          <span className="notranslate">
            {row.plan?.name ?? 'Subscription'}
          </span>
          {' · '}
          <span className="notranslate">{row.owner.email}</span>
        </p>
        <small>{planDueText(row)}</small>
        <small>
          <Phone size={12} />{' '}
          {row.owner.phone ? (
            <span className="notranslate">{row.owner.phone}</span>
          ) : (
            'No phone on file'
          )}
          {price ? ` · ${price} per month` : ' · price on the plan'}
        </small>
      </div>
      <div className="panel-renewal-tags">
        <ReminderStatus notifiedAt={row.notifiedAt} seenAt={row.seenAt} />
        {row.declinedAt && (
          <span className="panel-pill muted">Owner declined renewal</span>
        )}
      </div>
      <div className="panel-renewal-actions">
        <button className="panel-primary" onClick={onExtend}>
          <Plus size={15} /> +1 month
        </button>
        <button onClick={onMessage}>
          <MessageCircle size={15} /> WhatsApp
        </button>
      </div>
    </article>
  );
}

function BadgeRow({
  row,
  onExtend,
  onMessage,
}: {
  row: BadgeRenewal;
  onExtend: () => void;
  onMessage: () => void;
}) {
  const price = priceOf(row.priceCents, row.currency);
  return (
    <article
      className={`panel-record panel-renewal-row ${row.declinedAt ? 'is-declined' : ''}`}
    >
      <div className="panel-record-icon">
        {row.store.logoKey ? (
          <img src={storeMediaUrl(row.store.logoKey)} alt="" />
        ) : (
          <StoreIcon size={20} />
        )}
      </div>
      <div className="panel-record-info">
        <h3 className="notranslate">
          {row.store.name}{' '}
          {row.visible && (
            <BadgeCheck
              size={17}
              className="panel-verified"
              aria-label="Visible verification badge"
            />
          )}
        </h3>
        <p>
          {row.owner.displayName} ·{' '}
          <span className="notranslate">{row.owner.email}</span>
        </p>
        <small>{badgeDueText(row)}</small>
        <small>
          <Phone size={12} />{' '}
          {row.contactPhone ? (
            <span className="notranslate">{row.contactPhone}</span>
          ) : (
            'No phone on file'
          )}
          {price ? ` · ${price} per month` : ' · price arranged with the team'}
        </small>
      </div>
      <div className="panel-renewal-tags">
        <ReminderStatus notifiedAt={row.notifiedAt} seenAt={row.seenAt} />
        {row.declinedAt && (
          <span className="panel-pill muted">Owner declined renewal</span>
        )}
      </div>
      <div className="panel-renewal-actions">
        <button className="panel-primary" onClick={onExtend}>
          <Plus size={15} /> +1 month
        </button>
        <button onClick={onMessage}>
          <MessageCircle size={15} /> WhatsApp
        </button>
      </div>
    </article>
  );
}

/**
 * The shared renewal block. It is embedded in Subscriptions, Verification, and
 * the Notifications tab, and always reads the same live queue.
 */
export function RenewalQueue({
  id,
  kind = 'all',
}: {
  id: string;
  kind?: RenewalKindFilter;
}) {
  const query = useRenewals(id, kind);
  const [extending, setExtending] = useState<{
    kind: RenewalKind;
    row: SubscriptionRenewal | BadgeRenewal;
  } | null>(null);
  const [messaging, setMessaging] = useState<WhatsAppTarget | null>(null);
  const title =
    kind === 'subscription'
      ? 'Plans due for renewal'
      : kind === 'verification'
        ? 'Badges due for renewal'
        : 'Renewals due';
  if (query.isPending) return <Loading />;
  if (query.isError)
    return <Retry error={query.error} retry={() => void query.refetch()} />;
  const data = query.data;
  const plans = data.subscriptions;
  const badges = data.badges;
  const total = plans.length + badges.length;
  return (
    <section className="panel-card panel-renewal-queue">
      <header className="panel-renewal-queue-head">
        <div>
          <h2>
            <Clock3 size={19} /> {title}
          </h2>
          <p className="panel-muted">
            Owners get one reminder at midnight when the end date is today or
            tomorrow. Renew with one month, or send the prepared Arabic message
            on WhatsApp.
          </p>
        </div>
        <div className="panel-renewal-queue-counts">
          <span className="panel-pill">{data.counts.total} to renew</span>
          {data.counts.declined > 0 && (
            <span className="panel-pill muted">
              {data.counts.declined} declined
            </span>
          )}
        </div>
      </header>
      {kind !== 'verification' && (
        <div className="panel-renewal-group">
          <h3>
            <CreditCard size={16} /> Plans
          </h3>
          {plans.length ? (
            <div className="panel-record-list">
              {plans.map((row) => (
                <PlanRow
                  key={row.id}
                  row={row}
                  onExtend={() => setExtending({ kind: 'subscription', row })}
                  onMessage={() =>
                    setMessaging({
                      kind: 'subscription',
                      name: row.owner.displayName,
                      planName: row.plan?.name ?? null,
                      storeName: null,
                      priceLabel: priceOf(
                        row.plan?.priceCents,
                        row.plan?.currency,
                      ),
                      dueDate: row.expiresAt,
                      phone: row.owner.phone,
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <p className="panel-muted">No plan renewals are due.</p>
          )}
        </div>
      )}
      {kind !== 'subscription' && (
        <div className="panel-renewal-group">
          <h3>
            <BadgeCheck size={16} /> Verification badges
          </h3>
          <p className="panel-muted">
            Badges included in a plan renew with the subscription, so only
            monthly add-ons appear here.
          </p>
          {badges.length ? (
            <div className="panel-record-list">
              {badges.map((row) => (
                <BadgeRow
                  key={row.id}
                  row={row}
                  onExtend={() => setExtending({ kind: 'verification', row })}
                  onMessage={() =>
                    setMessaging({
                      kind: 'verification',
                      name: row.owner.displayName,
                      planName: null,
                      storeName: row.store.name,
                      priceLabel: priceOf(row.priceCents, row.currency),
                      dueDate: row.expiresAt,
                      phone: row.contactPhone ?? row.owner.phone,
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <p className="panel-muted">No badge renewals are due.</p>
          )}
        </div>
      )}
      {!total && (
        <Empty title="Nothing needs renewing">
          <p>
            A plan or add-on badge appears here when it expires today or
            tomorrow, or after it lapses without renewal.
          </p>
        </Empty>
      )}
      {extending && (
        <ExtendDialog
          id={id}
          kind={extending.kind}
          row={extending.row}
          close={() => setExtending(null)}
        />
      )}
      {messaging && (
        <WhatsAppDialog target={messaging} close={() => setMessaging(null)} />
      )}
    </section>
  );
}

export function AdminNotifications({ id }: { id: string }) {
  const query = useRenewals(id, 'all');
  const counts = query.data?.counts;
  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION"
        title="Notifications"
        description="Everyone whose plan or add-on verification badge ends today or tomorrow, plus owners who told us they will not renew. Reminders are generated at midnight and the queue is always live."
      />
      <div className="panel-stats">
        <div className="panel-stat">
          <span>
            Plans due <CreditCard size={17} />
          </span>
          <strong>{counts?.subscription ?? 0}</strong>
          <small>Renewals to confirm with owners</small>
        </div>
        <div className="panel-stat">
          <span>
            Badges due <BadgeCheck size={17} />
          </span>
          <strong>{counts?.verification ?? 0}</strong>
          <small>Monthly add-on badges only</small>
        </div>
        <div className="panel-stat">
          <span>
            Owners declined <StoreIcon size={17} />
          </span>
          <strong>{counts?.declined ?? 0}</strong>
          <small>Kept visible until the end date</small>
        </div>
      </div>
      {query.isError && <Notice error>{panelError(query.error)}</Notice>}
      <RenewalQueue id={id} kind="all" />
    </>
  );
}
