import './PricingPage.css';
import { usePageSeo } from '../hooks/usePageSeo';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  CreditCard,
  Crown,
  Gift,
  MessageCircle,
  Minus,
  Rocket,
  ShieldCheck,
  Store,
  Tag,
  X,
} from 'lucide-react';
import { getJson, loginUrl } from '../lib/api';
import { SUPPORT_PHONE } from '../lib/contact';
import { planInquiryLink } from '../lib/plan-inquiry';
import {
  billingLabel,
  planBadge,
  planFeatures,
  planPrice,
  planVerification,
  type SubscriptionPlan,
} from '../lib/pricing';
import { formatProductPrice } from '../lib/storefront';
import { contrastColor } from '../lib/website';
import { useWebsiteSettings } from '../hooks/useWebsiteSettings';
import { StatusBanner } from './Feedback';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

const isFreePlan = (plan: SubscriptionPlan) => /^0+$/u.test(plan.priceCents);

// Each paid tier owns a visual identity instead of sharing one card: the calm
// entry tier, the brand-filled middle, and the dark premium field. Known slugs
// keep their identity even when an administrator reorders the plan list, and
// any extra plan cycles through the tones so the page never looks broken.
const tierTones = ['calm', 'brand', 'lux'] as const;
type TierTone = (typeof tierTones)[number];

function tierTone(plan: SubscriptionPlan, index: number): TierTone {
  const slug = plan.slug.toLowerCase();
  if (slug.includes('premium')) return 'lux';
  if (slug.includes('pro')) return 'brand';
  if (slug.includes('basic') || slug.includes('starter')) return 'calm';
  return tierTones[index % tierTones.length] ?? 'calm';
}

function tierIcon(plan: SubscriptionPlan) {
  const slug = plan.slug.toLowerCase();
  if (slug.includes('premium')) return Crown;
  if (slug.includes('pro')) return Rocket;
  if (slug.includes('basic') || slug.includes('starter')) return Store;
  return Building2;
}

// Long quota names wrap the leader rows; the shortened forms keep one line.
function shortLabel(label: string) {
  const short = label
    .replace(/^Max /u, '')
    .replace(/^Story slots/u, 'Stories')
    .replace(/^Shopping cart$/u, 'Cart');
  return short.charAt(0).toUpperCase() + short.slice(1);
}

// Quota rows ("1", "Unlimited") read better as values than as checkmarks, so the
// free-trial summary shows them as compact stats instead of a full list. The
// labels are shortened again so six of them still share one row of columns.
function trialStatLabel(label: string) {
  return shortLabel(label)
    .replace(/ per shop$/u, '')
    .replace(/^Media storage$/u, 'Storage');
}

function trialStats(plan: SubscriptionPlan) {
  return planFeatures(plan).flatMap(({ label, value }) =>
    typeof value === 'string' ? [{ label: trialStatLabel(label), value }] : [],
  );
}

function VerificationMark({ plan }: { plan: SubscriptionPlan }) {
  const offer = planVerification(plan);
  if (!offer) return null;
  // Badge add-ons are priced in USD regardless of the plan's own currency, the
  // same way the feature row formats them, so both readings always agree.
  const addOn =
    offer.addOnPriceCents === null
      ? null
      : `${formatProductPrice(String(offer.addOnPriceCents), 'USD')}/mo`;
  const detail = offer.unlimited
    ? 'Every shop you own can carry the blue tick.'
    : offer.included > 0
      ? `${offer.included} verified ${offer.included === 1 ? 'badge' : 'badges'} each month${addOn ? `, then ${addOn} each` : '.'}`
      : `Add the blue tick for ${addOn} per shop.`;
  return (
    <div className="tier-verify">
      <span className="tier-verify-seal" aria-hidden="true">
        <BadgeCheck size={19} />
      </span>
      <div className="tier-verify-copy">
        <strong>Verified badge</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function TrialCard({ plan }: { plan: SubscriptionPlan }) {
  const trialDays = plan.trialDays ?? null;
  const stats = trialStats(plan);
  return (
    <article className="trial-card">
      <div className="trial-intro">
        <span className="trial-icon" aria-hidden="true">
          <Gift size={22} />
        </span>
        <div className="trial-copy">
          <p className="trial-kicker">{planBadge(plan)}</p>
          <h2>{plan.name}</h2>
          <p className="trial-description">
            {plan.description ||
              'Try the core features before choosing a plan.'}
          </p>
          <p className="trial-hint">
            {trialDays
              ? `No card required. After ${trialDays} days, choose a paid plan — your published work stays online.`
              : 'No card required. Move to a paid plan whenever you are ready.'}
          </p>
        </div>
      </div>
      <div className="trial-side">
        <dl className="trial-stats" aria-label={`${plan.name} plan limits`}>
          {stats.map(({ label, value }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <a
          className="primary-button"
          href={loginUrl}
          aria-label={
            trialDays
              ? `Start your ${trialDays}-day free trial with ${plan.name}`
              : `Get started free with ${plan.name}`
          }
        >
          {trialDays ? 'Start free trial' : 'Get started free'}
          <ArrowRight size={17} aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}

interface ContactSession {
  user: { email: string; displayName: string };
}

/*
 * The plan buttons hand the visitor to the platform's global WhatsApp number.
 * The message is built from this dialog, so the team receives a lead with the
 * person's name, address and chosen plan; a signed-in visitor is prefilled from
 * the session and can still correct the fields before sending.
 */
function PlanContactDialog({
  plan,
  siteName,
  onClose,
}: {
  plan: SubscriptionPlan | null;
  siteName: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const session = useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => getJson<ContactSession>('auth/me', signal),
    // A signed-out visitor answers 401; that is simply an empty form.
    retry: false,
    staleTime: 30_000,
  });
  const [name, setName] = useState(session.data?.user.displayName ?? '');
  const [email, setEmail] = useState(session.data?.user.email ?? '');

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    element.querySelector('input')?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
      element.close();
    };
  }, []);

  useEffect(() => {
    const user = session.data?.user;
    if (!user) return;
    // A late session answer fills the fields unless the visitor already typed.
    setName((value) => value || user.displayName);
    setEmail((value) => value || user.email);
  }, [session.data]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const link = planInquiryLink({
      name,
      email,
      planName: plan?.name,
      priceLabel: plan ? planPrice(plan) : null,
      billingLabel: plan ? billingLabel(plan.billingCycle) : null,
      siteName,
    });
    // `noopener` in the feature string makes window.open return null even when
    // it succeeds, so open normally, cut the opener, and navigate only when the
    // browser truly blocked the tab.
    const popup = window.open(link, '_blank');
    if (popup) popup.opener = null;
    else window.location.assign(link);
    onClose();
  };

  return (
    <dialog
      ref={dialog}
      className="plan-contact"
      aria-labelledby="plan-contact-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form className="plan-contact-card" onSubmit={submit}>
        <div className="plan-contact-head">
          <span className="plan-contact-icon" aria-hidden="true">
            <MessageCircle size={18} />
          </span>
          <div>
            <p className="plan-contact-kicker">WhatsApp</p>
            <h2 id="plan-contact-title">
              {plan ? `Ask about ${plan.name}` : 'Talk to our team'}
            </h2>
          </div>
          <button
            type="button"
            className="plan-contact-close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {plan && (
          <p className="plan-contact-plan">
            <span>{plan.name}</span>
            <strong>
              {planPrice(plan)} <small>{billingLabel(plan.billingCycle)}</small>
            </strong>
          </p>
        )}
        <div className="plan-contact-fields">
          <label>
            <span>Your name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              maxLength={120}
              required
            />
          </label>
          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@gmail.com"
              maxLength={254}
              required
            />
          </label>
        </div>
        <p className="plan-contact-hint">
          Your name, email and {plan ? 'this plan' : 'your question'} are added
          to a WhatsApp message for {SUPPORT_PHONE}. You can edit it before
          sending.
        </p>
        <div className="plan-contact-actions">
          <button className="primary-button" type="submit">
            <MessageCircle size={17} aria-hidden="true" /> Open WhatsApp
          </button>
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}

function PlanTier({
  plan,
  index,
  onAsk,
  featured,
}: {
  plan: SubscriptionPlan;
  index: number;
  onAsk: (plan: SubscriptionPlan) => void;
  featured: boolean;
}) {
  const Icon = tierIcon(plan);
  const offer = planVerification(plan);
  // A plan with its own verification block hides the duplicate row below.
  const features = planFeatures(plan).filter(
    ({ label }) => !(offer && label === 'Verification badge'),
  );
  return (
    <article
      className={`tier tier-${tierTone(plan, index)}${featured ? ' tier-featured' : ''}`}
    >
      {featured && (
        <p className="tier-flag">
          <span aria-hidden="true" />
          Best value
        </p>
      )}
      <div className="tier-head">
        <Icon className="tier-mark" size={26} aria-hidden="true" />
        <span className="tier-index" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </span>
      </div>
      <h2>{plan.name}</h2>
      <p className="tier-description">
        {plan.description || 'Explore the features included in this plan.'}
      </p>
      <p className="tier-price">
        <strong>{planPrice(plan)}</strong>
        <span>{billingLabel(plan.billingCycle)}</span>
      </p>
      <p className="tier-currency">Prices in {plan.currency}</p>
      <VerificationMark plan={plan} />
      <button
        className="tier-action"
        type="button"
        onClick={() => onAsk(plan)}
        aria-label={`Ask about the ${plan.name} plan on WhatsApp`}
      >
        Ask on WhatsApp
        <MessageCircle size={16} aria-hidden="true" />
      </button>
      <div className="tier-features">
        <h3>What’s included</h3>
        <ul>
          {features.map(({ label, value }) => (
            <li
              key={label}
              className={`tier-feature-row${value === false ? ' is-off' : ''}`}
            >
              <span className="tier-feature-name">{shortLabel(label)}</span>
              {typeof value === 'string' ? (
                <strong className="tier-feature-value">{value}</strong>
              ) : (
                <>
                  <span
                    className={`tier-feature-state ${value ? 'is-on' : 'is-off'}`}
                    aria-hidden="true"
                  >
                    {value ? <Check size={14} /> : <Minus size={14} />}
                  </span>
                  <span className="sr-only">
                    {value ? 'Included' : 'Not included'}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

export function PricingPage() {
  const { settings, theme, settingsQuery } = useWebsiteSettings();
  const [params] = useSearchParams();
  // The dashboard sends an owner here once when the plan ends, so the page can
  // say why they arrived instead of looking like a generic marketing page.
  const planEnded = params.get('ended') === '1';
  // Closed dialog is null; a plan (or a null plan for general help) opens it.
  const [contact, setContact] = useState<{
    plan: SubscriptionPlan | null;
  } | null>(null);
  const plansQuery = useQuery({
    queryKey: ['subscription-plans'],
    queryFn: ({ signal }) =>
      getJson<SubscriptionPlan[]>('subscriptions/plans', signal),
  });
  const plans = plansQuery.data ?? [];
  const trialPlans = plans.filter(isFreePlan);
  const paidPlans = plans.filter((plan) => !isFreePlan(plan));
  const freeTrialDays = trialPlans[0]?.trialDays ?? null;
  // Sort order is the administrator's display order, so the middle paid tier is
  // promoted without hard-coding a slug that may not exist.
  const featuredSlug = paidPlans.length
    ? (paidPlans[Math.floor((paidPlans.length - 1) / 2)]?.slug ?? null)
    : null;
  // Gold buttons need readable text whatever secondary colour the site uses.
  const secondaryInk = {
    '--tier-secondary-ink': contrastColor(settings.secondaryColor),
  } as CSSProperties;

  usePageSeo({
    title: `Plans & pricing — ${settings.siteName}`,
    description: `Explore ${settings.siteName} plans. Compare prices, post limits, product allowances, and features for your business.`,
    siteName: settings.siteName,
    canonical: '/pricing',
  });

  return (
    <div className="app pricing-page" style={theme}>
      <a className="skip-link" href="#pricing-main">
        Skip to pricing
      </a>
      <SiteHeader settings={settings} view="pricing" />
      <div className="page-shell">
        <main
          className="pricing-main"
          id="pricing-main"
          tabIndex={-1}
          style={secondaryInk}
        >
          <section className="pricing-hero" aria-labelledby="pricing-title">
            <div className="pricing-hero-copy">
              <span className="pricing-eyebrow">
                <Tag size={13} aria-hidden="true" /> Plans for every stage
              </span>
              <h1 id="pricing-title">Plans &amp; pricing</h1>
              <p className="pricing-lede">
                Find the right space for your posts, products, and next big
                idea.
              </p>
              <ul className="pricing-highlights">
                {freeTrialDays && (
                  <li>
                    <Gift size={14} aria-hidden="true" />
                    {freeTrialDays}-day free trial
                  </li>
                )}
                <li>
                  <CreditCard size={14} aria-hidden="true" />
                  No card required
                </li>
                <li>
                  <ShieldCheck size={14} aria-hidden="true" />
                  Set up with our team
                </li>
              </ul>
              <a className="pricing-help-link" href="#pricing-faq">
                <CircleHelp size={16} aria-hidden="true" /> Plan help
              </a>
            </div>
            <ol className="pricing-steps" aria-label="How plans work">
              <li>
                <span aria-hidden="true">01</span>
                <div>
                  <strong>Start with the trial</strong>
                  <p>
                    {freeTrialDays
                      ? `${freeTrialDays} days of the core features, no card needed.`
                      : 'Core features first, no card needed.'}
                  </p>
                </div>
              </li>
              <li>
                <span aria-hidden="true">02</span>
                <div>
                  <strong>Pick a paid plan</strong>
                  <p>Our team activates it and confirms the terms with you.</p>
                </div>
              </li>
              <li>
                <span aria-hidden="true">03</span>
                <div>
                  <strong>Keep everything live</strong>
                  <p>Published shops and posts stay online as you grow.</p>
                </div>
              </li>
            </ol>
          </section>

          {planEnded && (
            <p className="pricing-note pricing-ended" role="status">
              Your trial has ended, so your shop is read-only. It stays online
              for 7 more days, then locks and is deleted shortly after unless a
              plan is activated. Message our team to choose one.
            </p>
          )}

          {settingsQuery.isError && (
            <StatusBanner
              action="Retry settings"
              onAction={() => void settingsQuery.refetch()}
            >
              Website branding and contact details couldn’t refresh.
            </StatusBanner>
          )}
          <section
            id="pricing-plans"
            className="pricing-plans"
            aria-label="Available subscription plans"
            aria-busy={plansQuery.isPending}
          >
            {plansQuery.isPending && (
              <>
                <p className="pricing-status" role="status">
                  Loading the latest plans…
                </p>
                <div className="pricing-trial-skeleton" aria-hidden="true">
                  <span />
                  <span />
                </div>
                <div className="pricing-tiers-skeleton" aria-hidden="true">
                  {[0, 1, 2].map((id) => (
                    <div className="tier-skeleton" key={id}>
                      <span />
                      <span />
                      <span />
                    </div>
                  ))}
                </div>
              </>
            )}
            {plansQuery.isError && (
              <StatusBanner
                action="Try again"
                onAction={() => void plansQuery.refetch()}
              >
                {plans.length
                  ? 'Plans couldn’t refresh. Previously loaded prices and features are shown.'
                  : 'Plans couldn’t load right now. Please try again in a moment.'}
              </StatusBanner>
            )}
            {plansQuery.isSuccess && !plans.length && (
              <div className="pricing-empty" role="status">
                <Tag size={28} aria-hidden="true" />
                <h2>Our plans are being prepared</h2>
                <p>Check back soon for pricing and available features.</p>
                <a className="text-button" href="/">
                  Explore the community{' '}
                  <ArrowRight size={16} aria-hidden="true" />
                </a>
              </div>
            )}
            {plans.length > 0 && (
              <>
                {trialPlans.length > 0 && (
                  <div className="pricing-trial">
                    {trialPlans.map((plan) => (
                      <TrialCard key={plan.slug} plan={plan} />
                    ))}
                  </div>
                )}
                {paidPlans.length > 0 && (
                  <div className="pricing-tiers">
                    {paidPlans.map((plan, index) => (
                      <PlanTier
                        key={plan.slug}
                        plan={plan}
                        index={index}
                        onAsk={(chosen) => setContact({ plan: chosen })}
                        featured={plan.slug === featuredSlug}
                      />
                    ))}
                  </div>
                )}
                <p className="pricing-note">
                  Every account starts with a free trial. Paid plans are
                  arranged with our team on WhatsApp; signing in does not
                  purchase or activate a paid subscription.
                </p>
              </>
            )}
          </section>

          <section
            id="pricing-faq"
            className="pricing-faq"
            aria-labelledby="pricing-faq-title"
          >
            <div className="pricing-faq-heading">
              <h2 id="pricing-faq-title">Common questions</h2>
              <p>A few things to know before getting started.</p>
            </div>
            <div className="pricing-questions">
              <details>
                <summary>
                  How do I get started?
                  <ChevronDown size={18} aria-hidden="true" />
                </summary>
                <p>
                  Sign in to create your account.{' '}
                  {freeTrialDays
                    ? `Every account starts with a ${freeTrialDays}-day free trial.`
                    : 'Every account starts with a free trial.'}{' '}
                  After the trial ends, choose a paid plan to keep creating.
                  Shops stay online for a 7-day grace window, then lock; an
                  abandoned free-trial shop is deleted shortly after it locks.
                  Paid-plan shops are never deleted automatically.
                </p>
              </details>
              <details>
                <summary>
                  How do I activate a paid plan?
                  <ChevronDown size={18} aria-hidden="true" />
                </summary>
                <p>
                  Message our team on WhatsApp to arrange your plan and confirm
                  its terms. Paid subscriptions are assigned by an
                  administrator; there is no online payment checkout on this
                  page.
                </p>
              </details>
              <details>
                <summary>
                  What does “unlimited” mean?
                  <ChevronDown size={18} aria-hidden="true" />
                </summary>
                <p>
                  There is no plan-specific cap for that allowance. Other limits
                  still apply, including supported file types, upload sizes, and
                  video duration. Storage and post allowances are shared across
                  your account.
                </p>
              </details>
              <details>
                <summary>
                  How does the verified badge work?
                  <ChevronDown size={18} aria-hidden="true" />
                </summary>
                <p>
                  The blue tick is reviewed and granted by an administrator. A
                  plan can bundle monthly badge slots; beyond those slots an
                  add-on price applies per shop. Each badge lasts one month and
                  stays visible for a short grace window after it ends.
                </p>
              </details>
            </div>
          </section>
          <section
            className="pricing-help"
            aria-labelledby="pricing-help-title"
          >
            <div>
              <h2 id="pricing-help-title">Need a hand choosing?</h2>
              <p>
                Have questions about a plan? Message us and we’ll help you
                choose.
              </p>
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={() => setContact({ plan: null })}
            >
              <MessageCircle size={17} aria-hidden="true" /> Message us
            </button>
          </section>
          <SiteFooter settings={settings} />
          {contact && (
            <PlanContactDialog
              plan={contact.plan}
              siteName={settings.siteName}
              onClose={() => setContact(null)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
