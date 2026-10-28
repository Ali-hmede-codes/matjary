import { useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Store } from '../../lib/api';
import { priceInput } from '../../lib/storefront';
import { getJson, mutate, panelError } from './panel-api';
import { Modal, Notice } from './PanelUI';
import { MediaUpload } from './MediaUpload';

export type QuickComposerKind = 'post' | 'product';

interface DraftRecord {
  id: string;
  slug: string;
}

interface CategoryOption {
  id: string;
  name: string;
}

interface CategoryList {
  items: CategoryOption[];
}

// Only the sizes the upload picker shows before negotiating; the API still
// enforces the full effective plan on every file.
interface DashboardLimits {
  limits?: Record<string, number | string | boolean | null>;
}

/**
 * One-screen composer behind the owner-only "+" on a shop tab. It is the fast
 * path from the shopfront: a title (and price for an item), photos, publish.
 * The draft is created only when the owner picks the first file, so closing an
 * untouched form leaves nothing behind. Everything else stays available in the
 * full studio editor.
 */
export function QuickComposer({
  store,
  kind,
  onClose,
  onPublished,
}: {
  store: Store;
  kind: QuickComposerKind;
  onClose: () => void;
  onPublished: (kind: QuickComposerKind, message: string) => void;
}) {
  const product = kind === 'product';
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [categoryId, setCategoryId] = useState('');
  const [keys, setKeys] = useState<string[]>([]);
  const [draft, setDraft] = useState<DraftRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // These refs keep the upload callback correct across renders: the media
  // picker must reuse the same draft and never resurrect a closed one.
  const draftRef = useRef<DraftRecord | null>(null);
  const creating = useRef<Promise<string> | null>(null);
  const published = useRef(false);

  const summary = useQuery({
    queryKey: ['quick-composer', 'summary', store.id],
    // Scoped to this shop so a team member sees the owner's plan limits.
    queryFn: ({ signal }) =>
      getJson<DashboardLimits>(
        `dashboard?storeId=${encodeURIComponent(store.id)}`,
        signal,
      ),
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const rawLimits = summary.data?.limits;
  const maxImageBytes =
    typeof rawLimits?.maxImageSizeBytes === 'number'
      ? rawLimits.maxImageSizeBytes
      : undefined;
  const maxVideoBytes =
    typeof rawLimits?.maxVideoSizeBytes === 'number'
      ? rawLimits.maxVideoSizeBytes
      : undefined;
  // Categories are optional here; the item is still saved when none exist or
  // the list cannot load.
  const categories = useQuery({
    queryKey: ['categories', store.slug, 'my'],
    queryFn: ({ signal }) =>
      getJson<CategoryList>(
        `stores/${encodeURIComponent(store.slug)}/categories/my`,
        signal,
      ),
    enabled: product,
    staleTime: 60_000,
    retry: 0,
  });

  const cents = product ? priceInput(price) : null;
  const readyForMedia = Boolean(title.trim()) && (!product || cents !== null);

  async function createDraft(): Promise<string> {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new Error('quick-title-required');
    let priceCents: number | null = null;
    if (product) {
      priceCents = priceInput(price);
      if (priceCents === null) throw new Error('quick-price-required');
    }
    const request = (async () => {
      const created = await mutate<DraftRecord>(
        product ? `stores/${encodeURIComponent(store.slug)}/products` : 'posts',
        product
          ? {
              name: cleanTitle,
              priceCents,
              currency,
              categoryId: categoryId || null,
              description: description.trim() || null,
              status: 'draft',
              requiresShipping: store.storeType !== 'restaurant_menu',
            }
          : {
              title: cleanTitle,
              description: description.trim() || null,
              status: 'draft',
              storeId: store.id,
            },
      );
      draftRef.current = created;
      setDraft(created);
      setNotice(
        product
          ? 'Draft item saved. Add photos, then publish when ready.'
          : 'Draft saved. Add photos or videos, then publish when ready.',
      );
      return created.id;
    })();
    creating.current = request;
    try {
      return await request;
    } finally {
      creating.current = null;
    }
  }

  // The picker asks for a target on the first file, so a draft is created
  // under the owner lock only when there is something to upload.
  function ensureDraft(): string | Promise<string> {
    if (draftRef.current) return draftRef.current.id;
    if (creating.current) return creating.current;
    return createDraft();
  }

  async function publish(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (busy || uploading || processing) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError(product ? 'Enter an item name.' : 'Enter a post title.');
      return;
    }
    if (product && cents === null) {
      setError('Use a price such as 12.50, with at most two decimals.');
      return;
    }
    if (!keys.length) {
      setError(product ? 'Add at least one photo.' : 'Add a photo or video.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let target = draftRef.current;
      if (!target) {
        await ensureDraft();
        target = draftRef.current;
      }
      if (!target) throw new Error('quick-save-failed');
      await mutate(
        product
          ? `stores/${encodeURIComponent(store.slug)}/products/${encodeURIComponent(target.slug)}`
          : `posts/${encodeURIComponent(target.slug)}`,
        product
          ? {
              name: cleanTitle,
              priceCents: cents,
              currency,
              categoryId: categoryId || null,
              description: description.trim() || null,
              imageKeys: keys,
              status: 'active',
            }
          : {
              title: cleanTitle,
              description: description.trim() || null,
              status: 'published',
            },
        'PATCH',
      );
      published.current = true;
      onPublished(
        kind,
        product
          ? 'Item published · it is now live on your shop.'
          : 'Post published · it is now live on your shop.',
      );
    } catch (e) {
      setError(panelError(e));
      setBusy(false);
    }
  }

  function close() {
    if (busy || uploading) return;
    if (
      draftRef.current &&
      !published.current &&
      !window.confirm(
        'Close without publishing? Your draft and uploaded media stay in your studio, where you can finish it later.',
      )
    )
      return;
    onClose();
  }

  return (
    <div className="panel-app panel-embed">
      <Modal
        title={
          draft
            ? product
              ? 'Finish your item'
              : 'Finish your post'
            : product
              ? 'Add an item'
              : 'Add a post'
        }
        onClose={close}
        busy={busy || uploading}
      >
        <p className="panel-muted">
          {product ? 'Adding to' : 'Posting as'} <strong>{store.name}</strong>.{' '}
          {product
            ? 'Add the basics now; options, stock and the remaining settings stay in the full editor.'
            : 'Add a photo and a caption; links, search and sharing settings stay in the full editor.'}
        </p>
        <form className="panel-form" onSubmit={(event) => void publish(event)}>
          {notice && <Notice>{notice}</Notice>}
          {draft && (
            <p className="panel-muted">
              This stays private as a draft until you publish.{' '}
              <Link
                to={`/dashboard/${product ? 'products' : 'posts'}?store=${encodeURIComponent(store.id)}`}
              >
                Open it in your studio
              </Link>
              .
            </p>
          )}
          <label>
            {product ? 'Item name' : 'Post title'}
            <input
              required
              autoFocus
              maxLength={200}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setError('');
              }}
              placeholder={
                product
                  ? 'e.g. Handmade ceramic mug'
                  : 'e.g. Fresh from our kitchen'
              }
            />
          </label>
          {product && (
            <div className="panel-two-fields">
              <label>
                Price
                <input
                  required
                  inputMode="decimal"
                  maxLength={18}
                  value={price}
                  onChange={(event) => {
                    setPrice(event.target.value);
                    setError('');
                  }}
                  placeholder="0.00"
                />
              </label>
              <label>
                Currency
                <select
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                >
                  {Array.from(
                    new Set([
                      currency,
                      'USD',
                      'LBP',
                      'EUR',
                      'GBP',
                      'AED',
                      'SAR',
                    ]),
                  ).map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {product && Boolean(categories.data?.items.length) && (
            <label>
              Category <span className="panel-muted">Optional</span>
              <select
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">No category</option>
                {(categories.data?.items ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {product ? 'Description' : 'Caption'}{' '}
            <span className="panel-muted">Optional</span>
            <textarea
              rows={3}
              maxLength={3000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={
                product
                  ? 'What makes this item special?'
                  : 'Say something about this moment…'
              }
            />
          </label>
          <MediaUpload
            targetId={ensureDraft}
            purpose={product ? 'product_image' : 'post'}
            label={product ? 'Photos' : 'Photos & videos'}
            keys={keys}
            onChange={setKeys}
            onBusy={setUploading}
            onPending={setProcessing}
            disabled={busy || !readyForMedia}
            allowVideo={!product}
            maxImageBytes={maxImageBytes}
            maxVideoBytes={maxVideoBytes}
          />
          {!readyForMedia && (
            <p className="panel-muted">
              {product
                ? 'Add a name and a valid price to choose photos.'
                : 'Add a title to choose photos or videos.'}
            </p>
          )}
          {error && <Notice error>{error}</Notice>}
          <div className="panel-actions">
            <button type="button" disabled={busy || uploading} onClick={close}>
              Cancel
            </button>
            <button
              className="panel-primary"
              disabled={busy || uploading || processing || !keys.length}
            >
              {busy ? 'Publishing…' : product ? 'Publish item' : 'Publish post'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
