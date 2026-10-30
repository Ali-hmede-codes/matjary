import './AdminSettings.css';
import './AdminSeo.css';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Bot,
  Building2,
  Image as ImageIcon,
  Search,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { getJson, mutate, panelError } from '../shared/panel-api';
import {
  Loading,
  Notice,
  PageTitle,
  Retry,
  useUnsaved,
} from '../shared/PanelUI';
import { assetUrl } from '../../lib/api';
import {
  brandingUrl,
  imageAddressError,
  type WebsiteSettings,
} from '../../lib/website';

// Mirrors SeoSettings in @app/database as returned by GET seo/settings.
interface SeoSettingsValues {
  siteName: string;
  defaultTitle: string | null;
  defaultDescription: string | null;
  defaultOgImageKey: string | null;
  defaultOgImageUrl: string | null;
  twitterSite: string | null;
  googleSiteVerification: string | null;
  bingSiteVerification: string | null;
  yandexSiteVerification: string | null;
  sitemapEnabled: boolean;
  sitemapChangefreq: string;
  sitemapPriority: number | string;
  robotsTxtCustom: string | null;
  organizationName: string | null;
  organizationUrl: string | null;
  organizationLogoKey: string | null;
  organizationLogoUrl: string | null;
  organizationSameAs: string[] | null;
  aiCrawlersAllowed: boolean;
  aiTrainingAllowed: boolean;
  aiCrawlerUserAgents: string[] | null;
  llmsTxtEnabled: boolean;
  llmsTxtContent: string | null;
  indexNowEnabled: boolean;
  indexNowKey: string | null;
  indexNowKeyLocation: string | null;
  speakableEnabled: boolean;
  speakableCssSelectors: string[] | null;
  faqEnabled: boolean;
  howtoEnabled: boolean;
  freshnessThresholdDays: number;
}

interface Draft {
  // Website settings, saved through the branding endpoint.
  siteName: string;
  tagline: string;
  siteDescription: string;
  // SEO defaults and technical settings.
  defaultTitle: string;
  defaultDescription: string;
  defaultOgImageUrl: string;
  twitterSite: string;
  googleSiteVerification: string;
  bingSiteVerification: string;
  yandexSiteVerification: string;
  sitemapEnabled: boolean;
  sitemapChangefreq: string;
  sitemapPriority: string;
  robotsTxtCustom: string;
  organizationName: string;
  organizationUrl: string;
  organizationLogoUrl: string;
  organizationSameAs: string;
  aiCrawlersAllowed: boolean;
  aiTrainingAllowed: boolean;
  aiCrawlerUserAgents: string;
  llmsTxtEnabled: boolean;
  llmsTxtContent: string;
  indexNowEnabled: boolean;
  indexNowKey: string;
  indexNowKeyLocation: string;
  speakableEnabled: boolean;
  speakableCssSelectors: string;
  faqEnabled: boolean;
  howtoEnabled: boolean;
  freshnessThresholdDays: string;
}

const changefreqs = [
  'always',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'never',
] as const;
const verificationPattern = /^[a-zA-Z0-9_-]+$/u;
const aiAgentPattern = /^[a-zA-Z0-9_.*-]+$/u;
const indexNowKeyPattern = /^[a-zA-Z0-9-]{8,128}$/u;
const plainText = /^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/u;

const entries = (value: string) =>
  value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
const lines = (values: string[] | null) => (values ?? []).join('\n');
const siteOrigin = () =>
  ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
    ? ''
    : window.location.origin;

function textIssue(value: string, max: number): string {
  const trimmed = value.trim();
  if (max > 0 && trimmed.length > max)
    return `Keep this under ${max} characters.`;
  if (!plainText.test(trimmed))
    return 'Use plain text without angle brackets or control characters.';
  return '';
}

function linkIssue(value: string, max = 500): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > max) return `Keep this under ${max} characters.`;
  try {
    const url = new URL(trimmed);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return 'Use a full http:// or https:// address without credentials.';
  } catch {
    return 'Use a full http:// or https:// address.';
  }
  return '';
}

// The stored SEO values: shared fields start empty so unsaved inheritances
// are visible as changes the administrator can apply.
function storedDraft(seo: SeoSettingsValues, branding: WebsiteSettings): Draft {
  return {
    siteName: branding.siteName,
    tagline: branding.tagline ?? '',
    siteDescription: branding.description ?? '',
    defaultTitle: seo.defaultTitle ?? '',
    defaultDescription: seo.defaultDescription ?? '',
    defaultOgImageUrl: seo.defaultOgImageUrl ?? '',
    twitterSite: seo.twitterSite ?? '',
    googleSiteVerification: seo.googleSiteVerification ?? '',
    bingSiteVerification: seo.bingSiteVerification ?? '',
    yandexSiteVerification: seo.yandexSiteVerification ?? '',
    sitemapEnabled: seo.sitemapEnabled,
    sitemapChangefreq: seo.sitemapChangefreq,
    sitemapPriority: String(seo.sitemapPriority),
    robotsTxtCustom: seo.robotsTxtCustom ?? '',
    organizationName: seo.organizationName ?? '',
    organizationUrl: seo.organizationUrl ?? '',
    organizationLogoUrl: seo.organizationLogoUrl ?? '',
    organizationSameAs: lines(seo.organizationSameAs),
    aiCrawlersAllowed: seo.aiCrawlersAllowed,
    aiTrainingAllowed: seo.aiTrainingAllowed,
    aiCrawlerUserAgents: lines(seo.aiCrawlerUserAgents),
    llmsTxtEnabled: seo.llmsTxtEnabled,
    llmsTxtContent: seo.llmsTxtContent ?? '',
    indexNowEnabled: seo.indexNowEnabled,
    indexNowKey: '',
    indexNowKeyLocation: seo.indexNowKeyLocation ?? '',
    speakableEnabled: seo.speakableEnabled,
    speakableCssSelectors: lines(seo.speakableCssSelectors),
    faqEnabled: seo.faqEnabled,
    howtoEnabled: seo.howtoEnabled,
    freshnessThresholdDays: String(seo.freshnessThresholdDays),
  };
}

// Load the website data that is already available (name, tagline, logo) into
// empty SEO fields, so one save makes search previews match the branding.
function inheritedDraft(
  seo: SeoSettingsValues,
  branding: WebsiteSettings,
): Draft {
  const base = storedDraft(seo, branding);
  const fill = (value: string, max: number) =>
    value.length > max ? value.slice(0, max) : value;
  // Branding images may be longer than the SEO column; never prefill a value
  // the API would reject on the first save.
  const shareImage = [branding.bannerUrl, branding.logoUrl].find(
    (value): value is string =>
      typeof value === 'string' && value.length <= 512,
  );
  return {
    ...base,
    defaultTitle:
      base.defaultTitle ||
      fill(
        [branding.siteName, branding.tagline].filter(Boolean).join(' — '),
        120,
      ),
    defaultDescription: base.defaultDescription
      ? base.defaultDescription
      : fill(branding.description ?? '', 320),
    defaultOgImageUrl: base.defaultOgImageUrl || shareImage || '',
    organizationName: base.organizationName || branding.siteName,
    organizationUrl: base.organizationUrl || siteOrigin(),
    organizationLogoUrl:
      base.organizationLogoUrl ||
      (branding.logoUrl && branding.logoUrl.length <= 512
        ? branding.logoUrl
        : ''),
  };
}

export function AdminSeo({ id }: { id: string }) {
  const seoQuery = useQuery({
    queryKey: ['panel', id, 'seo-settings'],
    queryFn: ({ signal }) => getJson<SeoSettingsValues>('seo/settings', signal),
  });
  const brandingQuery = useQuery({
    queryKey: ['panel', id, 'website-settings'],
    queryFn: ({ signal }) =>
      getJson<WebsiteSettings>('admin/website-settings', signal),
  });
  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION"
        title="Website SEO"
        description="The title, description, and image search engines and social apps show. Your website settings are loaded as a starting point."
      />
      {seoQuery.isPending || brandingQuery.isPending ? (
        <Loading />
      ) : seoQuery.isError || brandingQuery.isError ? (
        <Retry
          error={seoQuery.error ?? brandingQuery.error}
          retry={() => {
            void seoQuery.refetch();
            void brandingQuery.refetch();
          }}
        />
      ) : (
        <SettingsForm
          id={id}
          seo={seoQuery.data}
          branding={brandingQuery.data}
        />
      )}
    </>
  );
}

function SettingsForm({
  id,
  seo,
  branding,
}: {
  id: string;
  seo: SeoSettingsValues;
  branding: WebsiteSettings;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() =>
    inheritedDraft(seo, branding),
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(storedDraft(seo, branding)),
  );
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issues, setIssues] = useState<Partial<Record<keyof Draft, string>>>(
    {},
  );
  const dirty = JSON.stringify(draft) !== baseline;
  useUnsaved(touched && dirty);

  function edit<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setTouched(true);
    setIssues((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setNotice('');
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    const name = draft.siteName.trim();
    const title = draft.defaultTitle.trim();
    const description = draft.defaultDescription.trim();
    const ogImage = draft.defaultOgImageUrl.trim();
    const orgLogo = draft.organizationLogoUrl.trim();
    const orgUrl = draft.organizationUrl.trim();
    const indexNowKey = draft.indexNowKey.trim();
    const keyLocation = draft.indexNowKeyLocation.trim();
    const priority = Number(draft.sitemapPriority);
    const freshness = Number(draft.freshnessThresholdDays);
    const sameAs = entries(draft.organizationSameAs);
    const aiAgents = entries(draft.aiCrawlerUserAgents);
    const selectors = entries(draft.speakableCssSelectors);
    const found: Partial<Record<keyof Draft, string>> = {};
    const check = (key: keyof Draft, issue: string, value: string, max = 0) => {
      const message = issue || textIssue(value, max);
      if (message) found[key] = message;
    };
    if (!name) found.siteName = 'Give the website a name.';
    else check('siteName', '', name, 100);
    check('tagline', '', draft.tagline, 200);
    check('siteDescription', '', draft.siteDescription, 1000);
    check('defaultTitle', '', title, 120);
    check('defaultDescription', '', description, 320);
    check('twitterSite', '', draft.twitterSite, 100);
    const ogImageIssue = imageAddressError(ogImage);
    if (ogImageIssue) found.defaultOgImageUrl = ogImageIssue;
    const orgLogoIssue = imageAddressError(orgLogo);
    if (orgLogoIssue) found.organizationLogoUrl = orgLogoIssue;
    for (const key of [
      'googleSiteVerification',
      'bingSiteVerification',
      'yandexSiteVerification',
    ] as const) {
      const value = draft[key].trim();
      if (value && !verificationPattern.test(value))
        found[key] = 'Use only letters, numbers, dashes, and underscores.';
    }
    if (!/^(?:0(?:\.\d)?|1(?:\.0)?)$/u.test(draft.sitemapPriority.trim()))
      found.sitemapPriority =
        'Enter a number from 0 to 1 with at most one decimal, such as 0.8.';
    if (draft.robotsTxtCustom.length > 4000)
      found.robotsTxtCustom = 'Keep this under 4,000 characters.';
    if (draft.llmsTxtContent.length > 4000)
      found.llmsTxtContent = 'Keep this under 4,000 characters.';
    check('organizationName', '', draft.organizationName, 200);
    const orgUrlIssue = linkIssue(orgUrl);
    if (orgUrlIssue) found.organizationUrl = orgUrlIssue;
    if (sameAs.length > 20)
      found.organizationSameAs = 'List at most 20 addresses.';
    else {
      const bad = sameAs.find((value) => linkIssue(value));
      if (bad) found.organizationSameAs = `Check this address: ${bad}`;
    }
    if (aiAgents.length > 30)
      found.aiCrawlerUserAgents = 'List at most 30 crawler names.';
    else {
      const bad = aiAgents.find(
        (value) => value.length > 100 || !aiAgentPattern.test(value),
      );
      if (bad)
        found.aiCrawlerUserAgents = `Use one crawler name per line: ${bad}`;
    }
    if (indexNowKey && !indexNowKeyPattern.test(indexNowKey))
      found.indexNowKey =
        'Use 8–128 letters, numbers, or dashes for the IndexNow key.';
    const keyLocationIssue = linkIssue(keyLocation, 512);
    if (keyLocationIssue) found.indexNowKeyLocation = keyLocationIssue;
    if (selectors.length > 20)
      found.speakableCssSelectors = 'List at most 20 selectors.';
    else if (selectors.some((value) => value.length > 200))
      found.speakableCssSelectors = 'Keep every selector under 200 characters.';
    if (
      !/^\d{1,4}$/u.test(draft.freshnessThresholdDays) ||
      freshness < 1 ||
      freshness > 3650
    )
      found.freshnessThresholdDays =
        'Enter a whole number of days from 1 to 3,650.';
    if (Object.keys(found).length) {
      setIssues(found);
      setError('Check the highlighted fields before saving.');
      setNotice('');
      return;
    }

    // The page edits two records: branding (the title visitors and the home
    // tab read) and the global SEO defaults. Send only changed fields so a
    // concurrent edit elsewhere is never overwritten.
    const brandingPatch: Record<string, string | null> = {};
    if (name !== branding.siteName) brandingPatch.siteName = name;
    if (draft.tagline.trim() !== (branding.tagline ?? ''))
      brandingPatch.tagline = draft.tagline.trim() || null;
    if (draft.siteDescription.trim() !== (branding.description ?? ''))
      brandingPatch.description = draft.siteDescription.trim() || null;

    const seoPatch: Record<string, unknown> = {};
    const add = (key: string, next: unknown, stored: unknown) => {
      if (JSON.stringify(next) !== JSON.stringify(stored)) seoPatch[key] = next;
    };
    // Keep the structured-data site name aligned with the website name.
    add('siteName', name, seo.siteName);
    add('defaultTitle', title || null, seo.defaultTitle ?? null);
    add(
      'defaultDescription',
      description || null,
      seo.defaultDescription ?? null,
    );
    add('defaultOgImageUrl', ogImage || null, seo.defaultOgImageUrl ?? null);
    add(
      'twitterSite',
      draft.twitterSite.trim() || null,
      seo.twitterSite ?? null,
    );
    add(
      'googleSiteVerification',
      draft.googleSiteVerification.trim() || null,
      seo.googleSiteVerification ?? null,
    );
    add(
      'bingSiteVerification',
      draft.bingSiteVerification.trim() || null,
      seo.bingSiteVerification ?? null,
    );
    add(
      'yandexSiteVerification',
      draft.yandexSiteVerification.trim() || null,
      seo.yandexSiteVerification ?? null,
    );
    add('sitemapEnabled', draft.sitemapEnabled, seo.sitemapEnabled);
    add('sitemapChangefreq', draft.sitemapChangefreq, seo.sitemapChangefreq);
    add('sitemapPriority', priority, Number(seo.sitemapPriority));
    add(
      'robotsTxtCustom',
      draft.robotsTxtCustom.trim() || null,
      seo.robotsTxtCustom ?? null,
    );
    add(
      'organizationName',
      draft.organizationName.trim() || null,
      seo.organizationName ?? null,
    );
    add('organizationUrl', orgUrl || null, seo.organizationUrl ?? null);
    add(
      'organizationLogoUrl',
      orgLogo || null,
      seo.organizationLogoUrl ?? null,
    );
    add(
      'organizationSameAs',
      sameAs.length ? sameAs : null,
      seo.organizationSameAs ?? null,
    );
    add('aiCrawlersAllowed', draft.aiCrawlersAllowed, seo.aiCrawlersAllowed);
    add('aiTrainingAllowed', draft.aiTrainingAllowed, seo.aiTrainingAllowed);
    add(
      'aiCrawlerUserAgents',
      aiAgents.length ? aiAgents : null,
      seo.aiCrawlerUserAgents ?? null,
    );
    add('llmsTxtEnabled', draft.llmsTxtEnabled, seo.llmsTxtEnabled);
    add(
      'llmsTxtContent',
      draft.llmsTxtContent.trim() || null,
      seo.llmsTxtContent ?? null,
    );
    add('indexNowEnabled', draft.indexNowEnabled, seo.indexNowEnabled);
    if (indexNowKey) add('indexNowKey', indexNowKey, null);
    add(
      'indexNowKeyLocation',
      keyLocation || null,
      seo.indexNowKeyLocation ?? null,
    );
    add('speakableEnabled', draft.speakableEnabled, seo.speakableEnabled);
    add(
      'speakableCssSelectors',
      selectors.length ? selectors : null,
      seo.speakableCssSelectors ?? null,
    );
    add('faqEnabled', draft.faqEnabled, seo.faqEnabled);
    add('howtoEnabled', draft.howtoEnabled, seo.howtoEnabled);
    add(
      'freshnessThresholdDays',
      freshness,
      Number(seo.freshnessThresholdDays),
    );

    if (!Object.keys(brandingPatch).length && !Object.keys(seoPatch).length) {
      setBaseline(JSON.stringify(draft));
      setTouched(false);
      setError('');
      setNotice('Everything is already saved.');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    let savedBranding: WebsiteSettings | undefined;
    let savedSeo: SeoSettingsValues | undefined;
    try {
      if (Object.keys(brandingPatch).length) {
        savedBranding = await mutate<WebsiteSettings>(
          'admin/website-settings',
          brandingPatch,
          'PATCH',
        );
        client.setQueryData(['panel', id, 'website-settings'], savedBranding);
        // Storefront pages read the public endpoint; refresh them too.
        await client.invalidateQueries({ queryKey: ['website-settings'] });
      }
    } catch (reason) {
      setError(panelError(reason));
      setBusy(false);
      return;
    }
    try {
      if (Object.keys(seoPatch).length) {
        savedSeo = await mutate<SeoSettingsValues>(
          'seo/settings',
          seoPatch,
          'PUT',
        );
        client.setQueryData(['panel', id, 'seo-settings'], savedSeo);
      }
    } catch (reason) {
      if (savedBranding)
        setNotice(
          'The website title was saved. The other SEO settings could not be updated — try again.',
        );
      setError(panelError(reason));
      setBusy(false);
      return;
    }
    const nextBranding = savedBranding ?? branding;
    const nextSeo = savedSeo ?? seo;
    const next = storedDraft(nextSeo, nextBranding);
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setTouched(false);
    setNotice(
      savedSeo?.indexNowEnabled && indexNowKey
        ? 'Saved. IndexNow will submit new pages with the new key.'
        : 'Saved. Search and social previews now use these settings.',
    );
    setBusy(false);
  }

  const logo = imageAddressError(draft.defaultOgImageUrl)
    ? undefined
    : brandingUrl(assetUrl(draft.defaultOgImageUrl.trim()));
  const orgLogo = imageAddressError(draft.organizationLogoUrl)
    ? undefined
    : brandingUrl(assetUrl(draft.organizationLogoUrl.trim()));
  const fallbackImage =
    brandingUrl(assetUrl(branding.bannerUrl)) ||
    brandingUrl(assetUrl(branding.logoUrl));
  const socialImage = logo || fallbackImage;
  const homeTitle = `${draft.siteName.trim() || 'Website'} — ${
    draft.tagline.trim() || 'Discover something good'
  }`;
  const previewTitle = draft.defaultTitle.trim() || homeTitle;
  const previewDescription =
    draft.defaultDescription.trim() ||
    draft.siteDescription.trim() ||
    'Discover independent stores, beautiful finds, and everyday inspiration.';
  const homeDescription = draft.siteDescription.trim() || previewDescription;

  return (
    <form
      className="panel-form settings-form"
      onSubmit={(e) => void submit(e)}
      noValidate
    >
      <div className="settings-main">
        <section className="panel-card settings-card">
          <header className="settings-head">
            <span className="settings-icon">
              <Search size={18} />
            </span>
            <div>
              <h2>Search appearance</h2>
              <p className="panel-muted">
                The website name and tagline form the home page title. The SEO
                defaults fill pages that have no title of their own.
              </p>
            </div>
          </header>
          <div className="settings-subgrid">
            <Field
              label="Website name"
              error={issues.siteName}
              hint="Shown in the header, footer, and the home page tab."
            >
              <input
                value={draft.siteName}
                maxLength={100}
                disabled={busy}
                aria-invalid={Boolean(issues.siteName)}
                onChange={(event) => edit('siteName', event.target.value)}
              />
            </Field>
            <Field
              label="Home tagline"
              error={issues.tagline}
              hint="Follows the name after a dash in the home page tab."
            >
              <input
                value={draft.tagline}
                maxLength={200}
                placeholder="Discover something good"
                disabled={busy}
                aria-invalid={Boolean(issues.tagline)}
                onChange={(event) => edit('tagline', event.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Home description"
            error={issues.siteDescription}
            hint="The home page meta description; also the default when no SEO description is set."
          >
            <textarea
              value={draft.siteDescription}
              rows={3}
              maxLength={1000}
              disabled={busy}
              aria-invalid={Boolean(issues.siteDescription)}
              onChange={(event) => edit('siteDescription', event.target.value)}
            />
          </Field>
          <Field
            label="Default SEO title"
            error={issues.defaultTitle}
            hint={`${titleLength(draft.defaultTitle)}/120 · used for pages without their own title.`}
          >
            <input
              value={draft.defaultTitle}
              maxLength={120}
              placeholder={homeTitle}
              disabled={busy}
              aria-invalid={Boolean(issues.defaultTitle)}
              onChange={(event) => edit('defaultTitle', event.target.value)}
            />
          </Field>
          <Field
            label="Default SEO description"
            error={issues.defaultDescription}
            hint={`${draft.defaultDescription.length}/320 · used when a page has no description.`}
          >
            <textarea
              value={draft.defaultDescription}
              rows={3}
              maxLength={320}
              placeholder={homeDescription}
              disabled={busy}
              aria-invalid={Boolean(issues.defaultDescription)}
              onChange={(event) =>
                edit('defaultDescription', event.target.value)
              }
            />
          </Field>
          <p className="panel-muted seo-settings-link">
            Need the other website details?{' '}
            <Link to="/admin/settings">
              Open Website settings <ArrowUpRight size={13} />
            </Link>
          </p>
        </section>

        <section className="panel-card settings-card">
          <header className="settings-head">
            <span className="settings-icon">
              <ImageIcon size={18} />
            </span>
            <div>
              <h2>Sharing image and logo</h2>
              <p className="panel-muted">
                Your website banner or logo is loaded automatically. Paste
                another public address to use a different image.
              </p>
            </div>
          </header>
          <div className="settings-subgrid">
            <div className="seo-image-field">
              <Field
                label="Default sharing image"
                error={issues.defaultOgImageUrl}
                hint="Shown when a link is shared. A wide 1200×630 image works best."
              >
                <input
                  value={draft.defaultOgImageUrl}
                  maxLength={512}
                  placeholder="/logo.png or https://…"
                  disabled={busy}
                  aria-invalid={Boolean(issues.defaultOgImageUrl)}
                  onChange={(event) =>
                    edit('defaultOgImageUrl', event.target.value)
                  }
                />
              </Field>
              <div className="seo-image-preview">
                {logo ? (
                  <img src={logo} alt="" />
                ) : (
                  <span>No image selected</span>
                )}
              </div>
              <div className="seo-image-actions">
                {branding.logoUrl && (
                  <button
                    type="button"
                    className="panel-secondary"
                    disabled={busy}
                    onClick={() =>
                      edit('defaultOgImageUrl', branding.logoUrl ?? '')
                    }
                  >
                    Use website logo
                  </button>
                )}
                {branding.bannerUrl && (
                  <button
                    type="button"
                    className="panel-secondary"
                    disabled={busy}
                    onClick={() =>
                      edit('defaultOgImageUrl', branding.bannerUrl ?? '')
                    }
                  >
                    Use website banner
                  </button>
                )}
              </div>
            </div>
            <div className="seo-image-field">
              <Field
                label="Organization logo"
                error={issues.organizationLogoUrl}
                hint="Used in structured data (JSON-LD) for search engines."
              >
                <input
                  value={draft.organizationLogoUrl}
                  maxLength={512}
                  placeholder="/logo.png or https://…"
                  disabled={busy}
                  aria-invalid={Boolean(issues.organizationLogoUrl)}
                  onChange={(event) =>
                    edit('organizationLogoUrl', event.target.value)
                  }
                />
              </Field>
              <div className="seo-image-preview is-small">
                {orgLogo ? (
                  <img src={orgLogo} alt="" />
                ) : (
                  <span>No logo selected</span>
                )}
              </div>
              {branding.logoUrl && (
                <div className="seo-image-actions">
                  <button
                    type="button"
                    className="panel-secondary"
                    disabled={busy}
                    onClick={() =>
                      edit('organizationLogoUrl', branding.logoUrl ?? '')
                    }
                  >
                    Use website logo
                  </button>
                </div>
              )}
            </div>
          </div>
          <Field
            label="Twitter / X handle"
            error={issues.twitterSite}
            hint="Added to shared links, for example @matjary."
          >
            <input
              value={draft.twitterSite}
              maxLength={100}
              placeholder="@matjary"
              disabled={busy}
              aria-invalid={Boolean(issues.twitterSite)}
              onChange={(event) => edit('twitterSite', event.target.value)}
            />
          </Field>
          {(seo.defaultOgImageKey || seo.organizationLogoKey) && (
            <p className="panel-muted">
              An image uploaded before this page existed is still used while an
              address is empty.
            </p>
          )}
        </section>

        <section className="panel-card settings-card">
          <header className="settings-head">
            <span className="settings-icon">
              <ShieldCheck size={18} />
            </span>
            <div>
              <h2>Search engine verification</h2>
              <p className="panel-muted">
                Paste the code each search engine gives you. Leave a field empty
                to remove its tag.
              </p>
            </div>
          </header>
          <div className="settings-subgrid">
            <Field
              label="Google"
              error={issues.googleSiteVerification}
              hint="google-site-verification"
            >
              <input
                value={draft.googleSiteVerification}
                maxLength={255}
                disabled={busy}
                aria-invalid={Boolean(issues.googleSiteVerification)}
                onChange={(event) =>
                  edit('googleSiteVerification', event.target.value)
                }
              />
            </Field>
            <Field
              label="Bing"
              error={issues.bingSiteVerification}
              hint="msvalidate.01"
            >
              <input
                value={draft.bingSiteVerification}
                maxLength={255}
                disabled={busy}
                aria-invalid={Boolean(issues.bingSiteVerification)}
                onChange={(event) =>
                  edit('bingSiteVerification', event.target.value)
                }
              />
            </Field>
            <Field
              label="Yandex"
              error={issues.yandexSiteVerification}
              hint="yandex-verification"
            >
              <input
                value={draft.yandexSiteVerification}
                maxLength={255}
                disabled={busy}
                aria-invalid={Boolean(issues.yandexSiteVerification)}
                onChange={(event) =>
                  edit('yandexSiteVerification', event.target.value)
                }
              />
            </Field>
          </div>
        </section>

        <section className="panel-card settings-card">
          <header className="settings-head">
            <span className="settings-icon">
              <Bot size={18} />
            </span>
            <div>
              <h2>Sitemap and crawlers</h2>
              <p className="panel-muted">
                Controls sitemap.xml, robots.txt, and which AI crawlers may read
                the site.
              </p>
            </div>
          </header>
          <Toggle
            checked={draft.sitemapEnabled}
            disabled={busy}
            onChange={(value) => edit('sitemapEnabled', value)}
            label="Publish sitemap.xml"
            hint="Lists public shops, products, and posts for search engines."
          />
          <div className="settings-subgrid">
            <Field label="Change frequency" hint="How often pages change.">
              <select
                value={draft.sitemapChangefreq}
                disabled={busy}
                onChange={(event) =>
                  edit('sitemapChangefreq', event.target.value)
                }
              >
                {changefreqs.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Sitemap priority"
              error={issues.sitemapPriority}
              hint="From 0 to 1, with one decimal."
            >
              <input
                inputMode="decimal"
                value={draft.sitemapPriority}
                maxLength={4}
                disabled={busy}
                aria-invalid={Boolean(issues.sitemapPriority)}
                onChange={(event) =>
                  edit('sitemapPriority', event.target.value)
                }
              />
            </Field>
          </div>
          <Toggle
            checked={draft.aiCrawlersAllowed}
            disabled={busy}
            onChange={(value) => edit('aiCrawlersAllowed', value)}
            label="Allow AI crawlers"
            hint="Lets assistants such as ChatGPT and Claude read public pages."
          />
          <Toggle
            checked={draft.aiTrainingAllowed}
            disabled={busy}
            onChange={(value) => edit('aiTrainingAllowed', value)}
            label="Allow AI training"
            hint="Whether public content may be used to train AI models."
          />
          <Toggle
            checked={draft.llmsTxtEnabled}
            disabled={busy}
            onChange={(value) => edit('llmsTxtEnabled', value)}
            label="Publish llms.txt"
            hint="A plain-text guide for AI assistants that visit the site."
          />
          <Field
            label="Custom AI crawler names"
            error={issues.aiCrawlerUserAgents}
            hint="One name per line. Leave empty to use the built-in list."
          >
            <textarea
              value={draft.aiCrawlerUserAgents}
              rows={3}
              disabled={busy}
              aria-invalid={Boolean(issues.aiCrawlerUserAgents)}
              placeholder={'GPTBot\nClaudeBot\nGoogle-Extended'}
              onChange={(event) =>
                edit('aiCrawlerUserAgents', event.target.value)
              }
            />
          </Field>
          <Field
            label="Custom llms.txt content"
            error={issues.llmsTxtContent}
            hint={`${draft.llmsTxtContent.length}/4,000 · leave empty to generate it from the site.`}
          >
            <textarea
              value={draft.llmsTxtContent}
              rows={4}
              maxLength={4000}
              disabled={busy}
              aria-invalid={Boolean(issues.llmsTxtContent)}
              onChange={(event) => edit('llmsTxtContent', event.target.value)}
            />
          </Field>
          <Field
            label="Custom robots.txt rules"
            error={issues.robotsTxtCustom}
            hint={`${draft.robotsTxtCustom.length}/4,000 · appended to the generated rules.`}
          >
            <textarea
              value={draft.robotsTxtCustom}
              rows={4}
              maxLength={4000}
              disabled={busy}
              aria-invalid={Boolean(issues.robotsTxtCustom)}
              placeholder={'User-agent: *\nDisallow: /favorites'}
              onChange={(event) => edit('robotsTxtCustom', event.target.value)}
            />
          </Field>
        </section>

        <section className="panel-card settings-card">
          <header className="settings-head">
            <span className="settings-icon">
              <Building2 size={18} />
            </span>
            <div>
              <h2>Organization</h2>
              <p className="panel-muted">
                Structured data that identifies the business behind the website
                to search engines.
              </p>
            </div>
          </header>
          <div className="settings-subgrid">
            <Field
              label="Organization name"
              error={issues.organizationName}
              hint="Usually the same as the website name."
            >
              <input
                value={draft.organizationName}
                maxLength={200}
                disabled={busy}
                aria-invalid={Boolean(issues.organizationName)}
                onChange={(event) =>
                  edit('organizationName', event.target.value)
                }
              />
            </Field>
            <Field
              label="Organization URL"
              error={issues.organizationUrl}
              hint="The main address of the website."
            >
              <input
                value={draft.organizationUrl}
                maxLength={500}
                placeholder="https://your-domain.example"
                disabled={busy}
                aria-invalid={Boolean(issues.organizationUrl)}
                onChange={(event) =>
                  edit('organizationUrl', event.target.value)
                }
              />
            </Field>
          </div>
          <Field
            label="Social profiles"
            error={issues.organizationSameAs}
            hint="One address per line: Instagram, Facebook, TikTok, and so on."
          >
            <textarea
              value={draft.organizationSameAs}
              rows={3}
              disabled={busy}
              aria-invalid={Boolean(issues.organizationSameAs)}
              placeholder={
                'https://instagram.com/yourshop\nhttps://facebook.com/yourshop'
              }
              onChange={(event) =>
                edit('organizationSameAs', event.target.value)
              }
            />
          </Field>
        </section>

        <details className="panel-optional seo-advanced">
          <summary>
            Advanced <span>Optional</span>
          </summary>
          <section className="panel-card settings-card">
            <header className="settings-head">
              <span className="settings-icon">
                <Wrench size={18} />
              </span>
              <div>
                <h2>Indexing and schema</h2>
                <p className="panel-muted">
                  These options rarely need changing; the defaults are safe for
                  most websites.
                </p>
              </div>
            </header>
            <Toggle
              checked={draft.indexNowEnabled}
              disabled={busy}
              onChange={(value) => edit('indexNowEnabled', value)}
              label="Submit changes to IndexNow"
              hint="Pings participating search engines when a shop or product changes."
            />
            <div className="settings-subgrid">
              <Field
                label="IndexNow key"
                error={issues.indexNowKey}
                hint="Write-only. Leave empty to keep the current key."
              >
                <input
                  value={draft.indexNowKey}
                  maxLength={128}
                  autoComplete="off"
                  disabled={busy}
                  aria-invalid={Boolean(issues.indexNowKey)}
                  onChange={(event) => edit('indexNowKey', event.target.value)}
                />
              </Field>
              <Field
                label="IndexNow key file"
                error={issues.indexNowKeyLocation}
                hint="Address of the key file on this website."
              >
                <input
                  value={draft.indexNowKeyLocation}
                  maxLength={512}
                  placeholder="https://your-domain.example/indexnow-key.txt"
                  disabled={busy}
                  aria-invalid={Boolean(issues.indexNowKeyLocation)}
                  onChange={(event) =>
                    edit('indexNowKeyLocation', event.target.value)
                  }
                />
              </Field>
            </div>
            <Toggle
              checked={draft.speakableEnabled}
              disabled={busy}
              onChange={(value) => edit('speakableEnabled', value)}
              label="Speakable schema"
              hint="Marks content that voice assistants may read aloud."
            />
            <Field
              label="Speakable CSS selectors"
              error={issues.speakableCssSelectors}
              hint="One selector per line."
            >
              <textarea
                value={draft.speakableCssSelectors}
                rows={2}
                disabled={busy}
                aria-invalid={Boolean(issues.speakableCssSelectors)}
                placeholder={'.store-description'}
                onChange={(event) =>
                  edit('speakableCssSelectors', event.target.value)
                }
              />
            </Field>
            <Toggle
              checked={draft.faqEnabled}
              disabled={busy}
              onChange={(value) => edit('faqEnabled', value)}
              label="FAQ schema"
              hint="Allows FAQ structured data on public pages."
            />
            <Toggle
              checked={draft.howtoEnabled}
              disabled={busy}
              onChange={(value) => edit('howtoEnabled', value)}
              label="HowTo schema"
              hint="Allows step-by-step structured data on public pages."
            />
            <Field
              label="Freshness window"
              error={issues.freshnessThresholdDays}
              hint="Days before content is considered stale in structured data."
            >
              <input
                inputMode="numeric"
                value={draft.freshnessThresholdDays}
                maxLength={4}
                disabled={busy}
                aria-invalid={Boolean(issues.freshnessThresholdDays)}
                onChange={(event) =>
                  edit('freshnessThresholdDays', event.target.value)
                }
              />
            </Field>
          </section>
        </details>

        {error && <Notice error>{error}</Notice>}
        {notice && <Notice>{notice}</Notice>}
        <div className="panel-save-bar">
          <span>
            {dirty ? 'You have unsaved changes' : 'Everything is up to date'}
          </span>
          <button className="panel-primary" disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save SEO settings'}
          </button>
        </div>
      </div>

      <aside className="settings-aside">
        <section className="panel-card settings-preview-card">
          <h2>Search result</h2>
          <p className="panel-muted">How the home page can look on Google.</p>
          <div className="seo-search-preview">
            <span className="seo-search-site">
              {draft.siteName.trim() || 'Website'}
            </span>
            <span className="seo-search-url">{window.location.hostname} ›</span>
            <strong>{homeTitle}</strong>
            <p>{homeDescription}</p>
          </div>
        </section>
        <section className="panel-card settings-preview-card">
          <h2>Shared link</h2>
          <p className="panel-muted">
            The card shown in messaging apps and social feeds.
          </p>
          <div className="seo-social-preview">
            {socialImage ? (
              <img src={socialImage} alt="" />
            ) : (
              <span className="seo-social-empty">No sharing image yet</span>
            )}
            <div className="seo-social-body">
              <small>{window.location.hostname}</small>
              <strong>{previewTitle}</strong>
              <p>{previewDescription}</p>
            </div>
          </div>
          <a
            className="panel-secondary"
            href="/"
            target="_blank"
            rel="noreferrer"
          >
            Open the website <ArrowUpRight size={16} />
          </a>
        </section>
        <p className="panel-muted settings-tip">
          The home page title comes from the website name and tagline. The
          default SEO title and description fill pages that have no copy of
          their own.
        </p>
      </aside>
    </form>
  );
}

const titleLength = (value: string) => value.trim().length;

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label>
      {label}
      {children}
      {error ? (
        <span className="panel-field-error">{error}</span>
      ) : (
        hint && <small>{hint}</small>
      )}
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="panel-toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
      <small>{hint}</small>
    </label>
  );
}
