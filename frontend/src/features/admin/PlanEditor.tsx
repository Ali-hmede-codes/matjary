import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  decimalPrice,
  mutate,
  panelError,
  priceInput,
  type PanelRecord,
  type PlanLimits,
} from '../shared/panel-api';
import { Modal, Notice } from '../shared/PanelUI';

// Mirrors FREE_LIMITS in backend/libs/database/src/subscription-policy.ts.
// Plans inherit these values until the administrator overrides them, so the
// form starts from the same numbers the platform actually applies.
const PLATFORM_DEFAULTS: PlanLimits = {
  maxVideoDurationSeconds: 60,
  maxVideoSizeBytes: 50 * 1024 * 1024,
  maxVideoQuality: '720p',
  maxImageCount: 10,
  maxImageSizeBytes: 10 * 1024 * 1024,
  maxImageWidth: 1920,
  maxImageHeight: 1080,
  maxPostsPerMonth: 5,
  maxTotalPosts: 20,
  maxProducts: 10,
  maxStorageBytes: 1024 * 1024 * 1024,
  enableCart: true,
  enableWhatsAppCheckout: false,
  enableAnalytics: false,
  enableCustomDomain: false,
  enablePrioritySupport: false,
  maxVerificationBadges: 0,
  verificationBadgePriceCents: null,
};

export const BILLING_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  yearly: 'Yearly',
  lifetime: 'One-time',
};

const BILLING_CYCLES = ['monthly', 'yearly', 'lifetime'] as const;
const QUALITIES = ['480p', '720p', '1080p', '4k', '8k'] as const;
const MEGABYTE = 1024 * 1024;
const GIGABYTE = 1024 * MEGABYTE;

const megabytes = (bytes?: number | null) =>
  typeof bytes === 'number' && bytes > 0
    ? String(Number((bytes / MEGABYTE).toFixed(2)))
    : '';
const gigabytes = (bytes?: number | null) =>
  typeof bytes === 'number' && bytes > 0
    ? String(Number((bytes / GIGABYTE).toFixed(2)))
    : '';
const counted = (value?: number | null) =>
  typeof value === 'number' ? String(value) : '';

function limitFields(plan?: PanelRecord) {
  const limits: PlanLimits = { ...PLATFORM_DEFAULTS, ...plan?.limits };
  return {
    maxProducts: counted(limits.maxProducts),
    maxPostsPerMonth: counted(limits.maxPostsPerMonth),
    maxTotalPosts: counted(limits.maxTotalPosts),
    maxStorage: gigabytes(limits.maxStorageBytes),
    maxImageCount: counted(limits.maxImageCount),
    maxImageSize: megabytes(limits.maxImageSizeBytes),
    maxImageWidth: counted(limits.maxImageWidth),
    maxImageHeight: counted(limits.maxImageHeight),
    maxVideoDuration: counted(limits.maxVideoDurationSeconds),
    maxVideoSize: megabytes(limits.maxVideoSizeBytes),
    maxVideoQuality: limits.maxVideoQuality ?? '',
    maxBadges: counted(limits.maxVerificationBadges),
    badgePrice:
      typeof limits.verificationBadgePriceCents === 'number' &&
      limits.verificationBadgePriceCents > 0
        ? decimalPrice(String(limits.verificationBadgePriceCents))
        : '',
    enableCart: limits.enableCart === true,
    enableWhatsAppCheckout: limits.enableWhatsAppCheckout === true,
    enableAnalytics: limits.enableAnalytics === true,
    enableCustomDomain: limits.enableCustomDomain === true,
    enablePrioritySupport: limits.enablePrioritySupport === true,
  };
}

type LimitFields = ReturnType<typeof limitFields>;

interface PlanForm extends LimitFields {
  name: string;
  slug: string;
  description: string;
  price: string;
  currency: string;
  billingCycle: string;
  sortOrder: string;
  isActive: boolean;
}

function initialForm(plan?: PanelRecord): PlanForm {
  return {
    ...limitFields(plan),
    name: plan?.name ?? '',
    slug: plan?.slug ?? '',
    description: plan?.description ?? '',
    price: decimalPrice(plan?.priceCents ?? '0'),
    currency: plan?.currency ?? 'USD',
    billingCycle: plan?.billingCycle ?? 'monthly',
    sortOrder: String(plan?.sortOrder ?? 0),
    isActive: plan?.isActive ?? true,
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 100);
}

// Blank means unlimited (null); the API rejects zero for these quotas.
function quota(value: string, label: string, errors: string[], min = 1) {
  const text = value.trim();
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < min) {
    errors.push(label);
    return null;
  }
  return Math.round(number);
}

function quotaBytes(
  value: string,
  unit: number,
  label: string,
  errors: string[],
) {
  const text = value.trim();
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number <= 0) {
    errors.push(label);
    return null;
  }
  return Math.round(number * unit);
}

export function planSummary(limits?: PlanLimits) {
  const merged: PlanLimits = { ...PLATFORM_DEFAULTS, ...limits };
  const quotaText = (value?: number | null, noun = 'items') =>
    value == null
      ? `Unlimited ${noun}`
      : `${value.toLocaleString('en-US')} ${noun}`;
  const storage = gigabytes(merged.maxStorageBytes);
  return [
    quotaText(merged.maxProducts, 'products'),
    quotaText(merged.maxPostsPerMonth, 'posts / month'),
    storage
      ? `${Number(storage).toLocaleString('en-US')} GB storage`
      : 'Unlimited storage',
  ].join(' · ');
}

export function PlanEditor({
  plan,
  adminId,
  close,
}: {
  plan?: PanelRecord;
  adminId: string;
  close: () => void;
}) {
  const [form, setForm] = useState<PlanForm>(() => initialForm(plan));
  // Existing plans keep their address unless the administrator edits it.
  const [slugLocked, setSlugLocked] = useState(Boolean(plan));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const client = useQueryClient();
  const free = plan?.slug === 'free';
  const update = (patch: Partial<PlanForm>) =>
    setForm((current) => ({ ...current, ...patch }));

  function rename(name: string) {
    setForm((current) => ({
      ...current,
      name,
      slug: slugLocked ? current.slug : slugify(name),
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const errors: string[] = [];
    const name = form.name.trim();
    const slug = form.slug.trim().toLowerCase();
    if (!name) errors.push('Plan name');
    if (!slug) errors.push('Slug');
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) || slug.length > 100)
      errors.push('Slug (use lowercase letters, numbers and dashes)');
    const priceCents = form.price.trim() ? priceInput(form.price) : 0;
    if (priceCents === null) errors.push('Price');
    const currency = form.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/u.test(currency)) errors.push('Currency');
    const sortOrder = form.sortOrder.trim() ? Number(form.sortOrder) : 0;
    if (!Number.isInteger(sortOrder) || sortOrder < 0)
      errors.push('Sort order');
    const badgePrice = form.badgePrice.trim()
      ? priceInput(form.badgePrice)
      : null;
    if (form.badgePrice.trim() && badgePrice === null)
      errors.push('Badge price');
    const limits: PlanLimits = {
      maxProducts: quota(form.maxProducts, 'Products', errors),
      maxPostsPerMonth: quota(form.maxPostsPerMonth, 'Posts per month', errors),
      maxTotalPosts: quota(form.maxTotalPosts, 'Total posts', errors),
      maxStorageBytes: quotaBytes(form.maxStorage, GIGABYTE, 'Storage', errors),
      maxImageCount: quota(form.maxImageCount, 'Images per post', errors),
      maxImageSizeBytes: quotaBytes(
        form.maxImageSize,
        MEGABYTE,
        'Max image size',
        errors,
      ),
      maxImageWidth: quota(form.maxImageWidth, 'Max image width', errors),
      maxImageHeight: quota(form.maxImageHeight, 'Max image height', errors),
      maxVideoDurationSeconds: quota(
        form.maxVideoDuration,
        'Max video duration',
        errors,
      ),
      maxVideoSizeBytes: quotaBytes(
        form.maxVideoSize,
        MEGABYTE,
        'Max video size',
        errors,
      ),
      maxVideoQuality: form.maxVideoQuality || null,
      maxVerificationBadges: quota(
        form.maxBadges,
        'Verification badges',
        errors,
        0,
      ),
      verificationBadgePriceCents: badgePrice,
      enableCart: form.enableCart,
      enableWhatsAppCheckout: form.enableWhatsAppCheckout,
      enableAnalytics: form.enableAnalytics,
      enableCustomDomain: form.enableCustomDomain,
      enablePrioritySupport: form.enablePrioritySupport,
    };
    if (errors.length) {
      setError(`Check these fields: ${errors.join(', ')}.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = {
        name,
        slug,
        description: form.description.trim(),
        priceCents,
        currency,
        billingCycle: form.billingCycle,
        sortOrder,
        isActive: form.isActive,
        limits,
      };
      if (plan) await mutate(`admin/plans/${plan.id}`, body, 'PATCH');
      else await mutate('admin/plans', body);
      await client.invalidateQueries({ queryKey: ['panel', adminId] });
      close();
    } catch (e) {
      setError(panelError(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={plan ? `Edit ${plan.name}` : 'Create a subscription plan'}
      onClose={close}
      busy={busy}
    >
      <form className="panel-form" onSubmit={(e) => void submit(e)}>
        <fieldset>
          <legend>Plan details</legend>
          <div className="panel-two-fields">
            <label>
              Plan name
              <input
                required
                maxLength={100}
                value={form.name}
                onChange={(e) => rename(e.target.value)}
                placeholder="Studio Pro"
              />
            </label>
            <label>
              Address slug
              <input
                required
                maxLength={100}
                disabled={free}
                value={form.slug}
                onChange={(e) => {
                  setSlugLocked(true);
                  update({ slug: e.target.value.toLowerCase() });
                }}
                placeholder="studio-pro"
              />
            </label>
          </div>
          <label>
            Description
            <textarea
              maxLength={1000}
              rows={2}
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="What this plan unlocks for the owner."
            />
          </label>
          <div className="panel-two-fields">
            <label>
              Price
              <input
                inputMode="decimal"
                disabled={free}
                value={form.price}
                onChange={(e) => update({ price: e.target.value })}
                placeholder="0.00"
              />
            </label>
            <label>
              Currency
              <input
                maxLength={3}
                value={form.currency}
                onChange={(e) => update({ currency: e.target.value })}
                placeholder="USD"
              />
            </label>
          </div>
          <div className="panel-two-fields">
            <label>
              Billing cycle
              <select
                value={form.billingCycle}
                onChange={(e) => update({ billingCycle: e.target.value })}
              >
                {BILLING_CYCLES.map((cycle) => (
                  <option key={cycle} value={cycle}>
                    {BILLING_LABELS[cycle] ?? cycle}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Display order
              <input
                inputMode="numeric"
                value={form.sortOrder}
                onChange={(e) => update({ sortOrder: e.target.value })}
                placeholder="0"
              />
            </label>
          </div>
          <label className="panel-toggle">
            <input
              type="checkbox"
              checked={form.isActive}
              disabled={free}
              onChange={(e) => update({ isActive: e.target.checked })}
            />
            Available to owners
            <small>
              Inactive plans stay in history but cannot be assigned again.
            </small>
          </label>
          {free && (
            <p className="panel-muted">
              The free plan is the platform trial. It must stay active, free,
              and on the “free” address; its length is controlled by
              FREE_TRIAL_DAYS on the server.
            </p>
          )}
        </fieldset>
        <fieldset>
          <legend>Quotas</legend>
          <p className="panel-muted">
            Leave a field empty for unlimited. Numbers apply to stores on this
            plan.
          </p>
          <div className="panel-field-grid">
            <label>
              Products
              <input
                inputMode="numeric"
                value={form.maxProducts}
                onChange={(e) => update({ maxProducts: e.target.value })}
              />
            </label>
            <label>
              Posts per month
              <input
                inputMode="numeric"
                value={form.maxPostsPerMonth}
                onChange={(e) => update({ maxPostsPerMonth: e.target.value })}
              />
            </label>
            <label>
              Total posts
              <input
                inputMode="numeric"
                value={form.maxTotalPosts}
                onChange={(e) => update({ maxTotalPosts: e.target.value })}
              />
            </label>
            <label>
              Storage (GB)
              <input
                inputMode="decimal"
                value={form.maxStorage}
                onChange={(e) => update({ maxStorage: e.target.value })}
              />
            </label>
            <label>
              Images per post
              <input
                inputMode="numeric"
                value={form.maxImageCount}
                onChange={(e) => update({ maxImageCount: e.target.value })}
              />
            </label>
            <label>
              Max image size (MB)
              <input
                inputMode="decimal"
                value={form.maxImageSize}
                onChange={(e) => update({ maxImageSize: e.target.value })}
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Features</legend>
          <div className="panel-feature-grid">
            <label className="panel-toggle">
              <input
                type="checkbox"
                checked={form.enableCart}
                onChange={(e) => update({ enableCart: e.target.checked })}
              />
              Shopping cart
            </label>
            <label className="panel-toggle">
              <input
                type="checkbox"
                checked={form.enableWhatsAppCheckout}
                onChange={(e) =>
                  update({ enableWhatsAppCheckout: e.target.checked })
                }
              />
              WhatsApp checkout
            </label>
            <label className="panel-toggle">
              <input
                type="checkbox"
                checked={form.enableAnalytics}
                onChange={(e) => update({ enableAnalytics: e.target.checked })}
              />
              Analytics
            </label>
            <label className="panel-toggle">
              <input
                type="checkbox"
                checked={form.enableCustomDomain}
                onChange={(e) =>
                  update({ enableCustomDomain: e.target.checked })
                }
              />
              Custom domain
            </label>
            <label className="panel-toggle">
              <input
                type="checkbox"
                checked={form.enablePrioritySupport}
                onChange={(e) =>
                  update({ enablePrioritySupport: e.target.checked })
                }
              />
              Priority support
            </label>
          </div>
        </fieldset>
        <details className="panel-optional">
          <summary>
            Video, images & badges <span>Optional</span>
          </summary>
          <div className="panel-field-grid">
            <label>
              Max video duration (s)
              <input
                inputMode="numeric"
                value={form.maxVideoDuration}
                onChange={(e) => update({ maxVideoDuration: e.target.value })}
              />
            </label>
            <label>
              Max video size (MB)
              <input
                inputMode="decimal"
                value={form.maxVideoSize}
                onChange={(e) => update({ maxVideoSize: e.target.value })}
              />
            </label>
            <label>
              Video quality
              <select
                value={form.maxVideoQuality}
                onChange={(e) => update({ maxVideoQuality: e.target.value })}
              >
                <option value="">Platform default</option>
                {QUALITIES.map((quality) => (
                  <option key={quality} value={quality}>
                    {quality}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Max image width (px)
              <input
                inputMode="numeric"
                value={form.maxImageWidth}
                onChange={(e) => update({ maxImageWidth: e.target.value })}
              />
            </label>
            <label>
              Max image height (px)
              <input
                inputMode="numeric"
                value={form.maxImageHeight}
                onChange={(e) => update({ maxImageHeight: e.target.value })}
              />
            </label>
            <label>
              Verification badges
              <input
                inputMode="numeric"
                value={form.maxBadges}
                onChange={(e) => update({ maxBadges: e.target.value })}
              />
            </label>
          </div>
          <label>
            Badge price
            <input
              inputMode="decimal"
              value={form.badgePrice}
              onChange={(e) => update({ badgePrice: e.target.value })}
              placeholder="0.00"
            />
            <small>
              Empty or 0 keeps badges free. 0 badges disables them for this
              plan.
            </small>
          </label>
        </details>
        {error && <Notice error>{error}</Notice>}
        <div className="panel-actions">
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button className="panel-primary" disabled={busy}>
            {busy ? 'Saving…' : plan ? 'Save plan' : 'Create plan'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
