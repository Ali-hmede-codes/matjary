import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  BadgeCheck,
  Clock3,
  Phone,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatProductPrice } from '../../lib/storefront';
import { dateLabel, getJson, mutate, panelError } from '../shared/panel-api';
import { Loading, Notice, PageTitle, Retry } from '../shared/PanelUI';
import { useOwner } from './OwnerPanel';

type RequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';
type BadgeState = 'none' | 'active' | 'grace' | 'expired';

interface VerificationRequestSummary {
  id: string;
  status: RequestStatus;
  applicantName: string;
  phone: string;
  note: string | null;
  includedInPlan: boolean;
  priceCents: string;
  periodStartsAt: string | null;
  periodEndsAt: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface VerificationStatus {
  store: { id: string; name: string; slug: string; logoKey: string | null };
  badge: {
    state: BadgeState;
    visible: boolean;
    grantedAt: string | null;
    expiresAt: string | null;
    graceEndsAt: string | null;
    daysRemaining: number | null;
    // True while the badge uses one of the plan's included slots.
    included: boolean;
  };
  plan: {
    name: string | null;
    slug: string | null;
    maxBadges: number | null;
    activeBadges: number;
    // Bundled badges end with the subscription.
    endsAt: string | null;
  };
  eligibility: {
    available: boolean;
    included: boolean;
    priceCents: string;
    currency: string;
    reason: string | null;
  };
  pendingRequest: VerificationRequestSummary | null;
  latestRequest: VerificationRequestSummary | null;
}

const STATE_LABEL: Record<BadgeState, string> = {
  none: 'Not verified',
  active: 'Verified',
  grace: 'Renewal window',
  expired: 'Verification ended',
};

const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'Waiting for review',
  approved: 'Approved',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
};

const dayText = (days: number | null) =>
  days == null ? '' : `${days} day${days === 1 ? '' : 's'}`;

export function OwnerVerification() {
  const { store, session } = useOwner();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['panel', session.user.id, 'verification', store?.id],
    queryFn: ({ signal }) =>
      getJson<VerificationStatus>(`stores/${store!.id}/verification`, signal),
    enabled: Boolean(store),
  });
  const [name, setName] = useState(session.user.displayName);
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const latestId = query.data?.latestRequest?.id;
  useEffect(() => {
    const latest = query.data?.latestRequest;
    if (!latest) return;
    setName(latest.applicantName);
    setPhone(latest.phone);
    setNote(latest.note ?? '');
  }, [latestId]);
  if (!store) return null;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await mutate(`stores/${store!.id}/verification/request`, {
        applicantName: name.trim(),
        phone: phone.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      await client.invalidateQueries({ queryKey: ['panel', session.user.id] });
      setNotice(
        'Your request is with the Matjary team. An administrator will review it and call you on the number you provided.',
      );
    } catch (reason) {
      setError(panelError(reason));
    } finally {
      setBusy(false);
    }
  }
  async function withdraw() {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await mutate(`stores/${store!.id}/verification/request`, {}, 'DELETE');
      await client.invalidateQueries({ queryKey: ['panel', session.user.id] });
      setNotice('Your verification request was withdrawn.');
    } catch (reason) {
      setError(panelError(reason));
    } finally {
      setBusy(false);
    }
  }
  if (query.isPending) return <Loading />;
  if (query.isError)
    return <Retry error={query.error} retry={() => void query.refetch()} />;
  const data = query.data;
  const badge = data.badge;
  const pending = data.pendingRequest;
  const latest = data.latestRequest;
  const price = Number(data.eligibility.priceCents);
  // An administrator can grant a badge with no end date to special shops; it
  // is not a plan slot and needs no monthly renewal.
  const lifetime =
    badge.state === 'active' && !badge.expiresAt && !badge.included;
  return (
    <>
      <PageTitle
        eyebrow={store.name}
        title="Verification"
        description="The blue tick tells shoppers this business is real and reachable. Verification is reviewed by the Matjary team and renewed month by month."
        action={
          <>
            {!lifetime && !data.eligibility.included && price > 0 && (
              <span className="panel-pill">
                {formatProductPrice(
                  data.eligibility.priceCents,
                  data.eligibility.currency,
                )}{' '}
                / month
              </span>
            )}
            <span className={`panel-pill ${badge.visible ? '' : 'muted'}`}>
              {STATE_LABEL[badge.state]}
            </span>
          </>
        }
      />
      {notice && <Notice>{notice}</Notice>}
      {error && <Notice error>{error}</Notice>}
      {badge.state === 'active' && (
        <div className="panel-note">
          <BadgeCheck size={22} />
          <div>
            <strong>
              Your shop is verified
              {badge.expiresAt ? ` until ${dateLabel(badge.expiresAt)}` : ''}.
            </strong>
            <span>
              {badge.included
                ? `Included with your ${data.plan.name ?? 'current'} plan, so it ends when the subscription does${
                    data.plan.endsAt ? ` on ${dateLabel(data.plan.endsAt)}` : ''
                  }.${
                    badge.daysRemaining != null
                      ? ` ${dayText(badge.daysRemaining)} left.`
                      : ''
                  }`
                : badge.daysRemaining != null
                  ? `${dayText(badge.daysRemaining)} left in this month. Renew before it ends and the new month starts where the current one finishes.`
                  : 'This badge has no end date.'}
            </span>
          </div>
        </div>
      )}
      {badge.state === 'grace' && (
        <div className="panel-plan-banner">
          <div>
            <strong>Your month ended — the blue tick is still on.</strong>
            <span>
              It disappears after {dateLabel(badge.graceEndsAt)}. Request
              another month now to keep it without a gap.
            </span>
          </div>
        </div>
      )}
      {badge.state === 'expired' && (
        <div className="panel-plan-banner is-expired">
          <div>
            <strong>The blue tick is no longer shown.</strong>
            <span>
              Your verification and its five-day renewal window have ended.
              Request a new month to restore it.
            </span>
          </div>
        </div>
      )}
      <div className="panel-two-columns">
        <section className="panel-card panel-feature">
          <BadgeCheck size={32} />
          <h2>
            {pending
              ? 'Your application is with the team.'
              : lifetime
                ? 'Your shop is verified without an end date.'
                : badge.visible
                  ? 'Keep your tick for another month.'
                  : 'Get your shop verified.'}
          </h2>
          <p>
            {lifetime
              ? 'The Matjary team granted this badge with no end date. It stays on until an administrator removes it.'
              : data.eligibility.included
                ? `Verification is included in your ${data.plan.name ?? 'current'} plan. The badge runs as long as your subscription and ends with it.`
                : price > 0
                  ? data.plan.maxBadges != null &&
                    data.plan.maxBadges > 0 &&
                    data.plan.activeBadges >= data.plan.maxBadges
                    ? `Your plan's included badge is already used by another shop, so this shop is ${formatProductPrice(data.eligibility.priceCents, data.eligibility.currency)} per month, billed separately. An administrator will call you to arrange payment before the badge is activated.`
                    : `${formatProductPrice(data.eligibility.priceCents, data.eligibility.currency)} per month. An administrator will call you to arrange payment before the badge is activated.`
                  : (data.eligibility.reason ??
                    'Verification is not available on your current plan.')}
          </p>
          <small className="panel-muted">
            Included badges in use: {data.plan.activeBadges}
            {data.plan.maxBadges === null
              ? ' (unlimited)'
              : ` of ${data.plan.maxBadges}`}
            {data.plan.endsAt
              ? ` · Plan ends ${dateLabel(data.plan.endsAt)}`
              : ''}
          </small>
          {pending ? (
            <>
              <span className="panel-pill">{STATUS_LABEL[pending.status]}</span>
              <dl className="panel-details verification-request-details">
                <div>
                  <dt>Name</dt>
                  <dd>{pending.applicantName}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>
                    <span className="notranslate">{pending.phone}</span>
                  </dd>
                </div>
                <div>
                  <dt>Requested</dt>
                  <dd>{dateLabel(pending.createdAt)}</dd>
                </div>
                <div>
                  <dt>Monthly price</dt>
                  <dd>
                    {pending.includedInPlan
                      ? 'Included in plan'
                      : formatProductPrice(
                          pending.priceCents,
                          data.eligibility.currency,
                        )}
                  </dd>
                </div>
              </dl>
              <button
                className="panel-secondary"
                disabled={busy}
                onClick={() => void withdraw()}
              >
                {busy ? 'Withdrawing…' : 'Withdraw request'}
              </button>
            </>
          ) : lifetime ? (
            <span className="panel-muted">
              No renewal is needed while this badge is active.
            </span>
          ) : data.eligibility.available ? (
            <a className="panel-secondary" href="#verification-form">
              Send your details <ArrowUpRight size={16} />
            </a>
          ) : (
            <Link className="panel-secondary" to="/pricing">
              See plans <ArrowUpRight size={16} />
            </Link>
          )}
        </section>
        <section className="panel-card">
          <h2>How it works</h2>
          <ul className="verification-steps">
            <li>
              <Phone size={16} />
              <span>Send your business name and a Lebanese phone number.</span>
            </li>
            <li>
              <ShieldCheck size={16} />
              <span>An administrator reviews it and calls you to confirm.</span>
            </li>
            <li>
              <BadgeCheck size={16} />
              <span>The blue tick starts for one month after approval.</span>
            </li>
            <li>
              <Clock3 size={16} />
              <span>
                If a month ends without renewal, the tick stays for 5 days and
                then disappears.
              </span>
            </li>
            <li>
              <ShieldCheck size={16} />
              <span>
                A badge included with your plan ends when the subscription ends.
                Extra shops renew monthly at the plan's badge price.
              </span>
            </li>
          </ul>
          {latest && latest.status === 'rejected' && (
            <Notice error>
              Your last request was not approved
              {latest.reviewNote ? `: ${latest.reviewNote}` : '.'} You can
              update your details and send it again.
            </Notice>
          )}
          {latest && latest.status === 'withdrawn' && (
            <p className="panel-muted">
              You withdrew your last request on {dateLabel(latest.updatedAt)}.
            </p>
          )}
        </section>
      </div>
      {!pending && !lifetime && data.eligibility.available && (
        <section className="panel-card" id="verification-form">
          <h2>
            {badge.state === 'active' || badge.state === 'grace'
              ? 'Request another month'
              : 'Verification details'}
          </h2>
          <p className="panel-muted">
            The Matjary team sees this information only to review your shop. It
            is never shown to shoppers.
          </p>
          <form className="panel-form" onSubmit={(e) => void submit(e)}>
            <label>
              Full name
              <input
                required
                minLength={2}
                maxLength={120}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <small>The name of the person responsible for this shop.</small>
            </label>
            <label>
              Lebanese phone number
              <input
                required
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                minLength={7}
                maxLength={20}
                placeholder="03 123 456"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <small>
                Any common format works: 03 123 456, 03123456, or +961 3 123
                456.
              </small>
            </label>
            <label>
              Anything the team should know? (optional)
              <textarea
                rows={3}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Your Instagram, a second number, or how to reach you."
              />
            </label>
            <div className="panel-actions">
              <button className="panel-primary" disabled={busy}>
                <Send size={16} />{' '}
                {busy
                  ? 'Sending…'
                  : badge.state === 'active' || badge.state === 'grace'
                    ? 'Request another month'
                    : 'Send verification request'}
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
