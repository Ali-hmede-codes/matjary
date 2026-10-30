import './AdminSettings.css';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Image as ImageIcon,
  Mail,
  Palette,
  Type,
  Wallet,
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
  contrastColor,
  imageAddressError,
  type WebsiteSettings,
} from '../../lib/website';

const imageKeys = ['logoUrl', 'faviconUrl', 'bannerUrl'] as const;
const colorKeys = [
  'primaryColor',
  'secondaryColor',
  'backgroundColor',
  'textColor',
] as const;
const textLimits = {
  siteName: 100,
  tagline: 200,
  description: 1000,
  footerText: 500,
} as const;
// The API stores a display-only LBP hint; stored prices and orders stay in USD.
const MAX_LBP_RATE = 10_000_000;
const plainText = /^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

interface Draft {
  siteName: string;
  tagline: string;
  description: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  logoUrl: string;
  faviconUrl: string;
  bannerUrl: string;
  contactEmail: string;
  footerText: string;
  lbpExchangeRate: string;
}

const fromSettings = (settings: WebsiteSettings): Draft => ({
  siteName: settings.siteName,
  tagline: settings.tagline ?? '',
  description: settings.description ?? '',
  primaryColor: settings.primaryColor,
  secondaryColor: settings.secondaryColor,
  backgroundColor: settings.backgroundColor,
  textColor: settings.textColor,
  logoUrl: settings.logoUrl ?? '',
  faviconUrl: settings.faviconUrl ?? '',
  bannerUrl: settings.bannerUrl ?? '',
  contactEmail: settings.contactEmail ?? '',
  footerText: settings.footerText ?? '',
  lbpExchangeRate: String(settings.lbpExchangeRate),
});

// Mirrors the API image rule so an invalid address is reported next to the
// field instead of as a generic 400 after a round trip.
function textIssue(value: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > max) return `Keep this under ${max} characters.`;
  if (!plainText.test(trimmed))
    return 'Use plain text without angle brackets or control characters.';
  return '';
}

export function AdminSettings({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ['panel', id, 'website-settings'],
    queryFn: ({ signal }) =>
      getJson<WebsiteSettings>('admin/website-settings', signal),
  });
  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION"
        title="Website settings"
        description="The name, wording, and branding every visitor sees. Changes go live as soon as you save."
      />
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Retry error={query.error} retry={() => void query.refetch()} />
      ) : (
        <SettingsForm id={id} initial={query.data} />
      )}
    </>
  );
}

function SettingsForm({
  id,
  initial,
}: {
  id: string;
  initial: WebsiteSettings;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => fromSettings(initial));
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(fromSettings(initial)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issues, setIssues] = useState<Partial<Record<keyof Draft, string>>>(
    {},
  );
  const dirty = JSON.stringify(draft) !== baseline;
  useUnsaved(dirty);

  function edit<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
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
    const email = draft.contactEmail.trim();
    const rate = draft.lbpExchangeRate.replace(/[,\s]/gu, '');
    const found: Partial<Record<keyof Draft, string>> = {};
    if (!name) found.siteName = 'Give the website a name.';
    else {
      const issue = textIssue(draft.siteName, textLimits.siteName);
      if (issue) found.siteName = issue;
    }
    for (const key of ['tagline', 'description', 'footerText'] as const) {
      const issue = textIssue(draft[key], textLimits[key]);
      if (issue) found[key] = issue;
    }
    for (const key of imageKeys) {
      const issue = imageAddressError(draft[key]);
      if (issue) found[key] = issue;
    }
    for (const key of colorKeys) {
      if (!/^#[0-9a-f]{6}$/iu.test(draft[key].trim()))
        found[key] = 'Use a six-digit hex color such as #254e40.';
    }
    if (email && (!emailPattern.test(email) || !plainText.test(email)))
      found.contactEmail =
        'Enter a complete email address, such as hello@example.com.';
    if (!/^\d{1,8}$/u.test(rate) || Number(rate) > MAX_LBP_RATE)
      found.lbpExchangeRate = `Enter whole pounds per dollar, up to ${MAX_LBP_RATE.toLocaleString('en-US')}. Use 0 to turn LBP prices off.`;
    if (Object.keys(found).length) {
      setIssues(found);
      setError('Check the highlighted fields before saving.');
      setNotice('');
      return;
    }
    // Send only changed fields: the endpoint merges a partial patch under a row
    // lock, so an untouched setting can never be overwritten by another tab.
    const patch: Record<string, string | number | null> = {};
    if (name !== initial.siteName) patch.siteName = name;
    for (const key of [
      'tagline',
      'description',
      'contactEmail',
      'footerText',
    ] as const) {
      const value = draft[key].trim();
      if (value !== (initial[key] ?? '')) patch[key] = value || null;
    }
    for (const key of imageKeys) {
      const value = draft[key].trim();
      if (value !== (initial[key] ?? '')) patch[key] = value || null;
    }
    for (const key of colorKeys) {
      const value = draft[key].trim().toLowerCase();
      if (value !== initial[key]) patch[key] = value;
    }
    if (Number(rate) !== initial.lbpExchangeRate)
      patch.lbpExchangeRate = Number(rate);
    if (!Object.keys(patch).length) {
      setBaseline(JSON.stringify(draft));
      setError('');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await mutate<WebsiteSettings>(
        'admin/website-settings',
        patch,
        'PATCH',
      );
      const next = fromSettings(saved);
      setDraft(next);
      setBaseline(JSON.stringify(next));
      client.setQueryData(['panel', id, 'website-settings'], saved);
      // Storefront pages read the public endpoint; refresh their cache so the
      // new branding shows the next time an open tab is viewed.
      await client.invalidateQueries({ queryKey: ['website-settings'] });
      await client.invalidateQueries({ queryKey: ['page-seo'] });
      setNotice('Saved. The website now uses these settings.');
    } catch (reason) {
      setError(panelError(reason));
    } finally {
      setBusy(false);
    }
  }

  const logo = imageAddressError(draft.logoUrl)
    ? undefined
    : brandingUrl(assetUrl(draft.logoUrl.trim()));
  // Half-typed hex values must not reach the inline preview styles.
  const hexOr = (value: string, fallback: string) =>
    /^#[0-9a-f]{6}$/iu.test(value.trim()) ? value.trim() : fallback;
  const primary = hexOr(draft.primaryColor, '#254e40');
  const background = hexOr(draft.backgroundColor, '#ffffff');
  const text = hexOr(draft.textColor, '#17231e');

  return (
    <form
      className="panel-form settings-form"
      onSubmit={(e) => void submit(e)}
      noValidate
    >
      <div className="settings-main">
        <section className="panel-card settings-card">
          <SectionHead
            icon={Type}
            title="Identity"
            hint="The name and description visitors read on the home page, in page titles, and in search and social previews."
          />
          <label>
            Website name
            <input
              value={draft.siteName}
              maxLength={textLimits.siteName}
              disabled={busy}
              aria-invalid={Boolean(issues.siteName)}
              onChange={(event) => edit('siteName', event.target.value)}
            />
            {issues.siteName ? (
              <span className="panel-field-error">{issues.siteName}</span>
            ) : (
              <small>Shown in the header, footer, and share cards.</small>
            )}
          </label>
          <label>
            Tagline
            <input
              value={draft.tagline}
              maxLength={textLimits.tagline}
              placeholder="Discover something good"
              disabled={busy}
              aria-invalid={Boolean(issues.tagline)}
              onChange={(event) => edit('tagline', event.target.value)}
            />
            {issues.tagline ? (
              <span className="panel-field-error">{issues.tagline}</span>
            ) : (
              <small>
                Optional. Short line after the website name in the browser tab.
              </small>
            )}
          </label>
          <label>
            Description
            <textarea
              value={draft.description}
              rows={4}
              maxLength={textLimits.description}
              disabled={busy}
              aria-invalid={Boolean(issues.description)}
              onChange={(event) => edit('description', event.target.value)}
            />
            {issues.description ? (
              <span className="panel-field-error">{issues.description}</span>
            ) : (
              <small>
                {draft.description.length}/{textLimits.description} · used in
                search results and social previews.
              </small>
            )}
          </label>
        </section>

        <section className="panel-card settings-card">
          <SectionHead
            icon={ImageIcon}
            title="Logo and images"
            hint="Address of an image that is already online. Upload a file to the website's public folder first, then paste its path here."
          />
          <div className="settings-subgrid">
            <ImageField
              label="Logo"
              hint="Shown in the header. A square PNG or SVG on a transparent background works best."
              placeholder="/logo.png"
              value={draft.logoUrl}
              error={issues.logoUrl}
              disabled={busy}
              onChange={(value) => edit('logoUrl', value)}
            />
            <ImageField
              label="Favicon"
              hint="The small icon in browser tabs. Leave empty to use the default."
              placeholder="/favicon.svg"
              value={draft.faviconUrl}
              error={issues.faviconUrl}
              disabled={busy}
              onChange={(value) => edit('faviconUrl', value)}
            />
          </div>
          <ImageField
            label="Banner"
            hint="Optional wide image under the home page title."
            placeholder="/banner.jpg or https://…"
            value={draft.bannerUrl}
            error={issues.bannerUrl}
            disabled={busy}
            banner
            onChange={(value) => edit('bannerUrl', value)}
          />
        </section>

        <section className="panel-card settings-card">
          <SectionHead
            icon={Palette}
            title="Colors"
            hint="Used across the public website. This workspace keeps its own colors."
          />
          <div className="settings-color-grid">
            {colorFields.map(([key, label, hint]) => (
              <ColorField
                key={key}
                label={label}
                hint={hint}
                value={draft[key]}
                error={issues[key]}
                disabled={busy}
                onChange={(value) => edit(key, value)}
              />
            ))}
          </div>
        </section>

        <section className="panel-card settings-card">
          <SectionHead
            icon={Mail}
            title="Contact and footer"
            hint="How visitors reach the platform, and the line printed at the bottom of every page."
          />
          <label>
            Contact email
            <input
              type="email"
              value={draft.contactEmail}
              maxLength={254}
              placeholder="hello@example.com"
              disabled={busy}
              aria-invalid={Boolean(issues.contactEmail)}
              onChange={(event) => edit('contactEmail', event.target.value)}
            />
            {issues.contactEmail ? (
              <span className="panel-field-error">{issues.contactEmail}</span>
            ) : (
              <small>
                Optional. Used for "Get in touch" buttons and the pricing page;
                no email is sent automatically.
              </small>
            )}
          </label>
          <label>
            Footer text
            <input
              value={draft.footerText}
              maxLength={textLimits.footerText}
              placeholder={`© ${new Date().getFullYear()} ${initial.siteName}. Made for discovery.`}
              disabled={busy}
              aria-invalid={Boolean(issues.footerText)}
              onChange={(event) => edit('footerText', event.target.value)}
            />
            {issues.footerText ? (
              <span className="panel-field-error">{issues.footerText}</span>
            ) : (
              <small>Leave empty to show the default copyright line.</small>
            )}
          </label>
        </section>

        <section className="panel-card settings-card">
          <SectionHead
            icon={Wallet}
            title="Prices"
            hint="Shops that turn on LBP prices print this rate in small text under each US dollar price. Stored prices and orders stay in USD."
          />
          <label>
            LBP per $1
            <input
              inputMode="numeric"
              value={draft.lbpExchangeRate}
              placeholder="89500"
              disabled={busy}
              aria-invalid={Boolean(issues.lbpExchangeRate)}
              onChange={(event) => edit('lbpExchangeRate', event.target.value)}
            />
            {issues.lbpExchangeRate ? (
              <span className="panel-field-error">
                {issues.lbpExchangeRate}
              </span>
            ) : (
              <small>
                {initial.lbpExchangeRate
                  ? `Current: ${initial.lbpExchangeRate.toLocaleString('en-US')} LBP per $1. Set 0 to hide LBP prices everywhere.`
                  : 'LBP prices are off. Enter a rate to let shops show them.'}
              </small>
            )}
          </label>
        </section>

        {error && <Notice error>{error}</Notice>}
        {notice && <Notice>{notice}</Notice>}
        <div className="panel-save-bar">
          <span>
            {dirty ? 'You have unsaved changes' : 'Everything is up to date'}
          </span>
          <button className="panel-primary" disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>

      <aside className="settings-aside">
        <section className="panel-card settings-preview-card">
          <h2>What visitors see</h2>
          <p className="panel-muted">
            A quick sample of the header and footer with these settings.
          </p>
          <div
            className="settings-preview"
            style={{ background, borderColor: primary }}
          >
            <div className="settings-preview-head">
              {logo ? (
                <img src={logo} alt="" />
              ) : (
                <span
                  className="settings-preview-mark"
                  style={{
                    background: primary,
                    color: contrastColor(primary),
                  }}
                >
                  {(draft.siteName.trim() || 'M').slice(0, 1)}
                </span>
              )}
              <strong style={{ color: text }}>
                {draft.siteName.trim() || 'Website name'}
              </strong>
            </div>
            <p style={{ color: text }}>
              {draft.tagline.trim() || 'Your tagline appears here.'}
            </p>
            <div className="settings-preview-actions">
              <span
                className="settings-preview-button"
                style={{
                  background: primary,
                  color: contrastColor(primary),
                }}
              >
                Discover
              </span>
              <span
                className="settings-preview-link"
                style={{ color: primary }}
              >
                Explore shops
              </span>
            </div>
            <small className="settings-preview-footer" style={{ color: text }}>
              {draft.footerText.trim() ||
                `© ${new Date().getFullYear()} ${draft.siteName.trim() || initial.siteName}. Made for discovery.`}
            </small>
          </div>
          <a
            className="panel-secondary"
            href="/"
            target="_blank"
            rel="noreferrer"
          >
            Open the website <ArrowUpRight size={16} />
          </a>
          <Link className="panel-secondary" to="/admin/seo">
            Search and sharing (SEO) <ArrowUpRight size={16} />
          </Link>
        </section>
        <p className="panel-muted settings-tip">
          The favicon, colors, and preview images refresh in every open visitor
          tab within a few minutes of saving.
        </p>
      </aside>
    </form>
  );
}

const colorFields = [
  ['primaryColor', 'Primary', 'Buttons, links, and active badges.'],
  ['secondaryColor', 'Accent', 'Small highlights such as the sale badge.'],
  ['backgroundColor', 'Background', 'The page behind every section.'],
  ['textColor', 'Text', 'Headings and body copy.'],
] as const;

function SectionHead({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Type;
  title: string;
  hint: string;
}) {
  return (
    <header className="settings-head">
      <span className="settings-icon">
        <Icon size={18} />
      </span>
      <div>
        <h2>{title}</h2>
        <p className="panel-muted">{hint}</p>
      </div>
    </header>
  );
}

function ImageField({
  label,
  hint,
  placeholder,
  value,
  error,
  disabled,
  banner = false,
  onChange,
}: {
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  error?: string;
  disabled: boolean;
  banner?: boolean;
  onChange: (value: string) => void;
}) {
  const preview = imageAddressError(value)
    ? undefined
    : brandingUrl(assetUrl(value.trim()));
  return (
    <div className={`settings-image-field ${banner ? 'is-banner' : ''}`}>
      <label>
        {label}
        <input
          value={value}
          maxLength={2048}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className={`settings-image-preview ${banner ? 'is-banner' : ''}`}>
        {preview ? (
          <img src={preview} alt="" />
        ) : (
          <span>Paste an image address to preview it</span>
        )}
      </div>
      {error ? (
        <span className="panel-field-error">{error}</span>
      ) : (
        <small>{hint}</small>
      )}
    </div>
  );
}

function ColorField({
  label,
  hint,
  value,
  error,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  error?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const valid = /^#[0-9a-f]{6}$/iu.test(value.trim());
  return (
    <div className="settings-color">
      <span>{label}</span>
      <div className="settings-color-row">
        <input
          type="color"
          aria-label={`${label} color`}
          value={valid ? value.trim() : '#254e40'}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          value={value}
          maxLength={7}
          spellCheck={false}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-label={`${label} hex value`}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {error ? (
        <span className="panel-field-error">{error}</span>
      ) : (
        <small>{hint}</small>
      )}
    </div>
  );
}
