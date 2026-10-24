import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  Layers,
  Mail,
  Minus,
  Store,
  Tag,
} from 'lucide-react';
import { getJson, loginUrl } from '../lib/api';
import {
  billingLabel,
  planFeatures,
  planPrice,
  type SubscriptionPlan,
} from '../lib/pricing';
import { useWebsiteSettings } from '../hooks/useWebsiteSettings';
import { StatusBanner } from './Feedback';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

function PlanCard({
  plan,
  contactEmail,
}: {
  plan: SubscriptionPlan;
  contactEmail: string | null;
}) {
  const free = /^0+$/u.test(plan.priceCents);
  const featured = plan.slug === 'basic';
  const PlanIcon = free ? Store : featured ? Layers : Building2;
  const contact = !free && Boolean(contactEmail);
  const actionUrl = contact
    ? `mailto:${contactEmail}?subject=${encodeURIComponent(`I'm interested in the ${plan.name} plan`)}`
    : loginUrl;
  return (
    <article className={`plan-card ${featured ? 'plan-card-featured' : ''}`}>
      <div className="plan-heading">
        <div className="plan-title">
          <span className="plan-icon" aria-hidden="true">
            <PlanIcon size={21} />
          </span>
          <div>
            <h2>{plan.name}</h2>
            <span className="plan-kind">
              {free ? 'Free plan' : 'Paid plan'}
            </span>
          </div>
        </div>
        <p>
          {plan.description || 'Explore the features included in this plan.'}
        </p>
      </div>
      <div className="plan-price">
        <strong>{planPrice(plan)}</strong>
        <span>{free ? 'free' : billingLabel(plan.billingCycle)}</span>
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
        {free
          ? 'Get started free'
          : contact
            ? 'Ask about this plan'
            : 'Sign in to get started'}
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
              <span className="plan-feature-label">{label}</span>
              {typeof value === 'boolean' ? (
                <span
                  className={`plan-feature-status ${value ? 'is-included' : ''}`}
                >
                  {value ? (
                    <Check size={15} aria-hidden="true" />
                  ) : (
                    <Minus size={15} aria-hidden="true" />
                  )}
                  <span className="sr-only">
                    {value ? 'Included' : 'Not included'}
                  </span>
                </span>
              ) : (
                <strong>{value}</strong>
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
  const plansQuery = useQuery({
    queryKey: ['subscription-plans'],
    queryFn: ({ signal }) =>
      getJson<SubscriptionPlan[]>('subscriptions/plans', signal),
  });
  const plans = plansQuery.data ?? [];

  useEffect(() => {
    document.title = `Plans & pricing — ${settings.siteName}`;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        `Explore ${settings.siteName} plans. Compare prices, post limits, product allowances, and features for your business.`,
      );
  }, [settings]);

  return (
    <div className="app pricing-page" style={theme}>
      <a className="skip-link" href="#pricing-main">
        Skip to pricing
      </a>
      <SiteHeader settings={settings} view="pricing" />
      <div className="page-shell">
        <main className="pricing-main" id="pricing-main" tabIndex={-1}>
          <section className="pricing-hero" aria-labelledby="pricing-title">
            <div>
              <h1 id="pricing-title">Plans & pricing</h1>
              <p>
                Find the right space for your posts, products, and next big
                idea.
              </p>
            </div>
            <a className="secondary-button" href="#pricing-faq">
              <CircleHelp size={18} aria-hidden="true" /> Plan help
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
                <div className="pricing-grid">
                  {plans.map((plan) => (
                    <PlanCard
                      key={plan.slug}
                      plan={plan}
                      contactEmail={settings.contactEmail}
                    />
                  ))}
                </div>
                <p className="pricing-note">
                  Paid plans are arranged with our team. Signing in does not
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
            <div>
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
                  Sign in to create your account. The free plan applies when you
                  don’t have an active paid subscription. Check the plan cards
                  above for the current allowances.
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
                {settings.contactEmail
                  ? 'Have questions about a plan? We’re here to help.'
                  : 'See what independent businesses are sharing on our platform.'}
              </p>
            </div>
            <a
              className="primary-button"
              href={
                settings.contactEmail ? `mailto:${settings.contactEmail}` : '/'
              }
            >
              {settings.contactEmail ? (
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
