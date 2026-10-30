import { usePageSeo } from '../hooks/usePageSeo';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  CreditCard,
  Gift,
  Layers,
  Mail,
  Minus,
  ShieldCheck,
  Store,
  Tag,
} from 'lucide-react';
import { getJson, loginUrl } from '../lib/api';
import { SUPPORT_EMAIL } from '../lib/contact';
import {
  billingLabel,
  planBadge,
  planFeatures,
  planPrice,
  type SubscriptionPlan,
} from '../lib/pricing';
import { useWebsiteSettings } from '../hooks/useWebsiteSettings';
import { StatusBanner } from './Feedback';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

const isFreePlan = (plan: SubscriptionPlan) => /^0+$/u.test(plan.priceCents);

// Quota rows ("1", "Unlimited") read better as values than as checkmarks, so the
// free-trial summary shows them as compact stat pills instead of a full list.
function trialStats(plan: SubscriptionPlan) {
  return planFeatures(plan).flatMap(({ label, value }) =>
    typeof value === 'string'
      ? [{ label: label.replace(/^Max /u, ''), value }]
      : [],
  );
}

function TrialCard({ plan }: { plan: SubscriptionPlan }) {
  const trialDays = plan.trialDays ?? null;
  const stats = trialStats(plan);
  return (
    <article className="trial-card">
      <div className="trial-intro">
        <span className="trial-icon" aria-hidden="true">
          <Gift size={24} />
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

function PlanCard({
  plan,
  contactEmail,
  featured,
}: {
  plan: SubscriptionPlan;
  contactEmail: string | null;
  featured: boolean;
}) {
  const contact = Boolean(contactEmail);
  const actionUrl = contact
    ? `mailto:${contactEmail}?subject=${encodeURIComponent(`I'm interested in the ${plan.name} plan`)}`
    : loginUrl;
  const PlanIcon =
    plan.slug === 'basic'
      ? Store
      : plan.slug === 'premium'
        ? Layers
        : Building2;
  return (
    <article className={`plan-card ${featured ? 'plan-card-featured' : ''}`}>
      <div className="plan-head">
        <span className="plan-icon" aria-hidden="true">
          <PlanIcon size={22} />
        </span>
        {featured && <span className="plan-flag">Best value</span>}
      </div>
      <h2>{plan.name}</h2>
      <span className="plan-kind">{planBadge(plan)}</span>
      <p className="plan-description">
        {plan.description || 'Explore the features included in this plan.'}
      </p>
      <div className="plan-price">
        <strong>{planPrice(plan)}</strong>
        <span>{billingLabel(plan.billingCycle)}</span>
      </div>
      <p className="plan-currency">Prices in {plan.currency}</p>
      <a
        className={featured ? 'primary-button' : 'secondary-button'}
        href={actionUrl}
        aria-label={
          contact
            ? `Contact us about the ${plan.name} plan`
            : `Sign in to get started with ${plan.name}`
        }
      >
        {contact ? 'Ask about this plan' : 'Sign in to get started'}
        <ArrowRight size={17} aria-hidden="true" />
      </a>
      <div className="plan-inclusions">
        <h3>What’s included</h3>
        <ul>
          {planFeatures(plan).map(({ label, value }) => (
            <li
              key={label}
              className={value === false ? 'plan-unavailable' : ''}
            >
              <span
                className={`plan-feature-icon ${
                  typeof value === 'string'
                    ? 'is-quota'
                    : value
                      ? 'is-included'
                      : 'is-off'
                }`}
                aria-hidden="true"
              >
                {typeof value === 'string' ? (
                  <span className="plan-feature-dot" />
                ) : value ? (
                  <Check size={13} />
                ) : (
                  <Minus size={13} />
                )}
              </span>
              <span className="plan-feature-label">{label}</span>
              {typeof value === 'string' ? (
                <strong>{value}</strong>
              ) : (
                <span className="sr-only">
                  {value ? 'Included' : 'Not included'}
                </span>
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
  // An administrator can point plan questions at a different inbox; otherwise
  // the platform support address is used.
  const contactEmail = settings.contactEmail || SUPPORT_EMAIL;
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
        <main className="pricing-main" id="pricing-main" tabIndex={-1}>
          <section className="pricing-hero" aria-labelledby="pricing-title">
            <span className="pricing-eyebrow">
              <Tag size={13} aria-hidden="true" /> Plans for every stage
            </span>
            <h1 id="pricing-title">Plans &amp; pricing</h1>
            <p className="pricing-lede">
              Find the right space for your posts, products, and next big idea.
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
          </section>

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
                <div className="pricing-grid" aria-hidden="true">
                  {[0, 1, 2].map((id) => (
                    <div className="plan-skeleton" key={id}>
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
                  <div
                    className={`pricing-grid ${paidPlans.length < 3 ? 'is-sparse' : ''}`}
                  >
                    {paidPlans.map((plan) => (
                      <PlanCard
                        key={plan.slug}
                        plan={plan}
                        contactEmail={contactEmail}
                        featured={plan.slug === featuredSlug}
                      />
                    ))}
                  </div>
                )}
                <p className="pricing-note">
                  Every account starts with a free trial. Paid plans are
                  arranged with our team; signing in does not purchase or
                  activate a paid subscription.
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
                  After the trial, choose a paid plan to keep creating. Your
                  published stores and posts stay online.
                </p>
              </details>
              <details>
                <summary>
                  How do I activate a paid plan?
                  <ChevronDown size={18} aria-hidden="true" />
                </summary>
                <p>
                  Contact our team to arrange your plan and confirm its terms.
                  Paid subscriptions are assigned by an administrator; there is
                  no online payment checkout on this page.
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
            </div>
          </section>
          <section
            className="pricing-help"
            aria-labelledby="pricing-help-title"
          >
            <div>
              <h2 id="pricing-help-title">Need a hand choosing?</h2>
              <p>
                {contactEmail
                  ? 'Have questions about a plan? We’re here to help.'
                  : 'See what independent businesses are sharing on our platform.'}
              </p>
            </div>
            <a
              className="primary-button"
              href={contactEmail ? `mailto:${contactEmail}` : '/'}
            >
              {contactEmail ? (
                <>
                  <Mail size={17} aria-hidden="true" /> Get in touch
                </>
              ) : (
                <>
                  <ArrowLeft size={17} aria-hidden="true" /> Explore discoveries
                </>
              )}
            </a>
          </section>
          <SiteFooter settings={settings} />
        </main>
      </div>
    </div>
  );
}
