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
import { SUPPORT_EMAIL } from '../../lib/contact';
import { dateLabel, getJson, mutate, panelError } from '../shared/panel-api';
import { Loading, Notice, PageTitle, Retry } from '../shared/PanelUI';
import { useWebsiteSettings } from '../../hooks/useWebsiteSettings';
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
    // The owner's shops currently holding a bundled slot, oldest first.
    includedShops: { id: string; name: string; slug: string }[];
  };
  eligibility: {
    available: boolean;
    included: boolean;
    // What this shop pays per month; zero while a bundled slot covers it.
    priceCents: string;
    // The monthly value of one badge outside a bundled slot.
    addOnPriceCents: string;
    currency: string;
    reason: string | null;
  };
  // The platform number owners call or message to pay for a badge month.
  payment: { contactPhone: string | null };
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
  const { settings } = useWebsiteSettings(false);
  const brand = settings.siteName;
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
        `Your request is with the ${brand} team. An administrator will review it and call you on the number you provided.`,
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
  const paymentPhone = data.payment.contactPhone;
  const telHref = paymentPhone?.replace(/[^+\d]/gu, '') ?? '';
  // The administrator's inbox takes priority; otherwise owners are pointed at
  // the platform support address.
  const contactEmail = settings.contactEmail || SUPPORT_EMAIL;
  const monthlyPrice = formatProductPrice(
    data.eligibility.priceCents,
    data.eligibility.currency,
  );
  // The monthly value stays visible even when a bundled slot pays for it; the
  // effective price is zero in that case, so the add-on price is shown instead.
  const addOnPrice = Number(data.eligibility.addOnPriceCents);
  const priceLabel =
    addOnPrice > 0
      ? formatProductPrice(
          data.eligibility.addOnPriceCents,
          data.eligibility.currency,
        )
      : price > 0
        ? monthlyPrice
        : null;
  // The plan's free slots are all occupied by other shops, so this shop is a
  // paid add-on even though the plan bundles badges.
  const bundleFull =
    data.plan.maxBadges !== null &&
    data.plan.maxBadges > 0 &&
    data.plan.activeBadges >= data.plan.maxBadges;
  const otherIncluded = data.plan.includedShops.filter(
    (shop) => shop.id !== data.store.id,
  );
  const usedBy = otherIncluded.map((shop) => shop.name).join(', ');
  return (
    <>
      <PageTitle
        eyebrow={store.name}
        title="Verification"
        description={`The blue tick tells shoppers this business is real and reachable. Verification is reviewed by the ${brand} team and renewed month by month.`}
        action={
          <>
            {lifetime ? (
              <span className="panel-pill">No monthly fee</span>
            ) : priceLabel ? (
              <span className="panel-pill">
                {priceLabel} / month
                {data.eligibility.included ? ' · included' : ''}
              </span>
            ) : null}
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
              Your verification and its seven-day renewal window have ended.
              Request a new month to restore it.
            </span>
          </div>
        </div>
      )}
      {!lifetime && (
        <div className="panel-note">
          {data.eligibility.included ? (
            <BadgeCheck size={22} />
          ) : (
            <Phone size={22} />
          )}
          <div>
            <strong>
              {data.eligibility.included
                ? priceLabel
                  ? `Monthly price: ${priceLabel} — included in your plan.`
                  : 'Your badge month is included in your plan.'
                : priceLabel
                  ? `Pay ${priceLabel} to start the next month.`
                  : data.eligibility.available
                    ? 'The monthly badge price is set by the team.'
                    : 'A monthly price appears once a plan is active.'}
            </strong>
            <span>
              {data.eligibility.included ? (
                <>
                  Your {data.plan.name ?? 'current'} plan covers this badge, so
                  nothing is charged each month
                  {data.plan.endsAt
                    ? ` and it ends with the plan on ${dateLabel(data.plan.endsAt)}`
                    : ''}
                  .
                </>
              ) : priceLabel ? (
                paymentPhone ? (
                  <>
                    Call or message{' '}
                    <a className="notranslate" href={`tel:${telHref}`}>
                      {paymentPhone}
                    </a>{' '}
                    and send {priceLabel}. Once the team receives it, your
                    request is approved and the blue tick starts for 30 days.
                  </>
                ) : (
                  <>
                    Contact the {brand} team
                    {contactEmail ? (
                      <>
                        {' '}
                        at <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
                      </>
                    ) : null}{' '}
                    to arrange the {priceLabel} payment. Once it is received,
                    your request is approved and the blue tick starts for 30
                    days.
                  </>
                )
              ) : data.eligibility.available ? (
                <>
                  Contact the {brand} team
                  {contactEmail ? (
                    <>
                      {' '}
                      at <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
                    </>
                  ) : null}{' '}
                  to arrange the monthly price for this shop. The amount is
                  confirmed before the blue tick starts.
                </>
              ) : (
                (data.eligibility.reason ??
                'Verification is not available on your current plan.')
              )}
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
              ? `The ${brand} team granted this badge with no end date. It stays on until an administrator removes it.`
              : data.eligibility.included
                ? priceLabel
                  ? `Verification is included in your ${data.plan.name ?? 'current'} plan, so the ${priceLabel} month is covered by your subscription and ends with it.`
                  : `Verification is included in your ${data.plan.name ?? 'current'} plan. The badge runs as long as your subscription and ends with it.`
                : price > 0
                  ? data.plan.maxBadges === 0
                    ? `Your ${data.plan.name ?? 'current'} plan does not include a verification badge, so this shop can be verified for ${monthlyPrice} per month. Send your details, pay ${monthlyPrice}, and the team activates the tick for 30 days after confirming the payment.`
                    : bundleFull && usedBy
                      ? `Your plan's free verification badge is already used by ${usedBy}, so this shop is ${monthlyPrice} per month, billed separately. Pay ${monthlyPrice} and the team activates the tick for 30 days after confirming the payment.`
                      : bundleFull
                        ? `All ${data.plan.maxBadges} verification badge${data.plan.maxBadges === 1 ? '' : 's'} included in your plan are already in use, so this shop is ${monthlyPrice} per month. Pay ${monthlyPrice} and the team activates the tick for 30 days after confirming the payment.`
                        : `${monthlyPrice} per month for this shop. Send your details, pay ${monthlyPrice}, and the team activates the tick for 30 days after confirming the payment.`
                  : (data.eligibility.reason ??
                    'Verification is not available on your current plan.')}
          </p>
          <small className="panel-muted">
            Included badges in use: {data.plan.activeBadges}
            {data.plan.maxBadges === null
              ? ' (unlimited)'
              : ` of ${data.plan.maxBadges}`}
            {usedBy ? ` · Used by ${usedBy}` : ''}
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
              {!pending.includedInPlan && Number(pending.priceCents) > 0 && (
                <p className="panel-muted">
                  {paymentPhone ? (
                    <>
                      Next step: call or message{' '}
                      <a className="notranslate" href={`tel:${telHref}`}>
                        {paymentPhone}
                      </a>{' '}
                      to pay{' '}
                      {formatProductPrice(
                        pending.priceCents,
                        data.eligibility.currency,
                      )}{' '}
                      for this month. The tick starts once the team confirms the
                      payment.
                    </>
                  ) : (
                    <>
                      Next step: pay{' '}
                      {formatProductPrice(
                        pending.priceCents,
                        data.eligibility.currency,
                      )}{' '}
                      through the {brand} team
                      {contactEmail ? (
                        <>
                          {' '}
                          at{' '}
                          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
                        </>
                      ) : null}
                      . The tick starts once the payment is confirmed.
                    </>
                  )}
                </p>
              )}
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
              <span>
                A free badge included in your plan is covered by the
                subscription. For any other shop, pay the monthly price shown
                here by calling or messaging the team's number.
              </span>
            </li>
            <li>
              <BadgeCheck size={16} />
              <span>
                After the payment is confirmed, the team approves your request
                and the blue tick starts for 30 days.
              </span>
            </li>
            <li>
              <Clock3 size={16} />
              <span>
                Renew by paying again before the month ends. The new month
                continues from the current end date, with no gap.
              </span>
            </li>
            <li>
              <ShieldCheck size={16} />
              <span>
                If a month ends without renewal, the tick stays for 7 days and
                then disappears. A badge included with your plan ends when the
                subscription ends.
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
            The {brand} team sees this information only to review your shop. It
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
