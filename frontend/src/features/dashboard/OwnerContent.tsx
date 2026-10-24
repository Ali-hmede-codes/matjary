import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ImagePlus, Package, Plus } from 'lucide-react';
import {
  getJson,
  mutate,
  panelError,
  decimalPrice,
  priceInput,
  type Page,
} from '../shared/panel-api';
import {
  Empty,
  Loading,
  Modal,
  Notice,
  PageTitle,
  Pagination,
  Retry,
  useUnsaved,
} from '../shared/PanelUI';
import { MediaUpload } from '../shared/MediaUpload';
import { formatProductPrice, storeMediaUrl } from '../../lib/storefront';
import { useOwner } from './OwnerPanel';

interface Content {
  id: string;
  slug: string;
  name?: string;
  title?: string;
  status: string;
  description: string | null;
  priceCents?: string;
  currency?: string;
  category?: string;
  stockQuantity?: number | null;
  imageKeys?: string[] | null;
}
interface PostMedia {
  id: string;
  kind: string;
  status: string;
  variants: { storageKey: string; mimeType: string }[];
}
export function OwnerContent({ kind }: { kind: 'products' | 'posts' }) {
  const { store, session } = useOwner();
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('');
  const [editor, setEditor] = useState<Content | null | undefined>();
  const [notice, setNotice] = useState('');
  const params = new URLSearchParams({
    storeId: store!.id,
    limit: '20',
    offset: String(offset),
  });
  if (status) params.set('status', status);
  const query = useQuery({
    queryKey: ['panel', session.user.id, kind, store!.id, offset, status],
    queryFn: ({ signal }) =>
      getJson<Page<Content>>(`dashboard/${kind}?${params}`, signal),
  });
  const product = kind === 'products';
  // Never index into a missing envelope: an unexpected payload must degrade to
  // an empty list instead of taking the whole panel down.
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const label = product
    ? store!.storeType === 'restaurant_menu'
      ? 'menu item'
      : 'product'
    : 'post';
  return (
    <>
      <PageTitle
        eyebrow={store!.name}
        title={
          product
            ? store!.storeType === 'restaurant_menu'
              ? 'Your menu, made simple.'
              : 'Good things, all in one place.'
            : 'A little story goes a long way.'
        }
        description={
          product
            ? 'Add your items, choose photos, and publish when you’re ready.'
            : 'Share photos and short videos with your community.'
        }
        action={
          <button className="panel-primary" onClick={() => setEditor(null)}>
            <Plus size={18} /> Add {label}
          </button>
        }
      />
      {notice && <Notice>{notice}</Notice>}
      <div className="panel-toolbar">
        <label>
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All items</option>
            <option value="draft">Drafts</option>
            <option value={product ? 'active' : 'published'}>Published</option>
            <option value="archived">Archived</option>
            {product && <option value="out_of_stock">Out of stock</option>}
          </select>
        </label>
        <Link to="/dashboard/plan">View my plan limits</Link>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Retry error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {items.length ? (
            <div className="panel-content-grid">
              {items.map((item) => (
                <article className="panel-content-card" key={item.id}>
                  <div className="panel-content-image">
                    {item.imageKeys?.[0] ? (
                      <img
                        src={storeMediaUrl(item.imageKeys[0])}
                        alt={item.name || ''}
                      />
                    ) : product ? (
                      <Package size={36} />
                    ) : (
                      <ImagePlus size={36} />
                    )}
                    <span className="panel-pill">
                      {item.status === 'active'
                        ? 'Published'
                        : item.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <div>
                    <h2>{item.name || item.title}</h2>
                    <p>
                      {product
                        ? formatProductPrice(
                            item.priceCents || '0',
                            item.currency || 'USD',
                          )
                        : item.description || 'Your next story.'}
                    </p>
                    <button onClick={() => setEditor(item)}>
                      Edit {label}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty title={`Your next ${label} starts here`}>
              <p>Keep it simple. You can always add more details later.</p>
              <button className="panel-primary" onClick={() => setEditor(null)}>
                Add {label}
              </button>
            </Empty>
          )}
          <Pagination total={total} offset={offset} onChange={setOffset} />
        </>
      )}
      {editor !== undefined && (
        <ContentEditor
          key={editor?.id || 'new'}
          kind={kind}
          item={editor}
          close={() => setEditor(undefined)}
          done={(message) => {
            setNotice(message);
            setEditor(undefined);
          }}
        />
      )}
    </>
  );
}
function ContentEditor({
  kind,
  item,
  close,
  done,
}: {
  kind: 'products' | 'posts';
  item: Content | null;
  close: () => void;
  done: (message: string) => void;
}) {
  const { store, session, summary } = useOwner();
  const client = useQueryClient();
  const product = kind === 'products';
  const [record, setRecord] = useState(item);
  const [name, setName] = useState(item?.name || item?.title || '');
  const [price, setPrice] = useState(
    item?.priceCents ? decimalPrice(item.priceCents) : '',
  );
  const [currency, setCurrency] = useState(item?.currency || 'USD');
  const [category, setCategory] = useState(
    item?.category ||
      (store?.storeType === 'restaurant_menu' ? 'food' : 'other'),
  );
  const [stock, setStock] = useState(
    item?.stockQuantity == null ? '' : String(item.stockQuantity),
  );
  const [description, setDescription] = useState(item?.description || '');
  const [keys, setKeys] = useState(item?.imageKeys || []);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [priceError, setPriceError] = useState('');
  const snapshot = JSON.stringify({
    name,
    price,
    currency,
    category,
    stock,
    description,
    keys,
  });
  const [baseline, setBaseline] = useState(snapshot);
  const dirty = snapshot !== baseline;
  useUnsaved(dirty || uploading || processing);
  const media = useQuery({
    queryKey: ['panel', session.user.id, 'post-media', record?.id],
    queryFn: ({ signal }) =>
      getJson<PostMedia[]>(`dashboard/showcases/${record!.id}/media`, signal),
    enabled: !product && Boolean(record),
    refetchInterval: (query) =>
      query.state.data?.some((a) => a.status === 'processing') ? 3000 : false,
  });
  const existingPending =
    !product &&
    media.data?.some(
      (a) => a.status === 'pending' || a.status === 'processing',
    );
  const existingFailed =
    !product && media.data?.some((a) => a.status === 'failed');
  function onClose() {
    if (busy || uploading) return;
    if (
      (!dirty && !processing) ||
      window.confirm('Discard your unsaved changes?')
    )
      close();
  }
  async function save(status: string, stay = false) {
    if (busy || uploading || processing) return;
    if (!name.trim()) {
      setError(product ? 'Enter an item name.' : 'Enter a post title.');
      return;
    }
    const cents = priceInput(price);
    if (product && cents === null) {
      setPriceError('Use a price such as 12.50, with at most two decimals.');
      return;
    }
    setBusy(true);
    setError('');
    setPriceError('');
    setNotice('');
    try {
      const base = product
        ? `stores/${encodeURIComponent(store!.slug)}/products`
        : 'posts';
      const body = {
        ...(product
          ? {
              name: name.trim(),
              priceCents: cents,
              currency,
              category,
              stockQuantity: stock === '' ? null : Number(stock),
              ...(record ? { imageKeys: keys } : {}),
              ...(!record
                ? { requiresShipping: store?.storeType !== 'restaurant_menu' }
                : {}),
            }
          : { title: name.trim(), ...(!record ? { storeId: store!.id } : {}) }),
        description: description.trim() || null,
        status,
      };
      const saved = await mutate<Content>(
        record ? `${base}/${encodeURIComponent(record.slug)}` : base,
        body,
        record ? 'PATCH' : 'POST',
      );
      setRecord(saved);
      setBaseline(snapshot);
      await client.invalidateQueries({
        queryKey: ['panel', session.user.id, kind],
      });
      await client.invalidateQueries({
        queryKey: ['panel', session.user.id, 'summary'],
      });
      if (stay)
        setNotice(
          'Draft saved. Add photos below, then publish whenever you’re ready.',
        );
      else
        done(
          status === 'draft'
            ? 'Draft saved.'
            : status === 'archived'
              ? 'Item archived.'
              : 'Your changes are live.',
        );
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const button = (e.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const action = button?.value || 'publish';
    void save(
      action === 'publish'
        ? product
          ? 'active'
          : 'published'
        : action === 'archive'
          ? 'archived'
          : 'draft',
      action === 'photos',
    );
  }
  return (
    <Modal
      title={
        record
          ? `Edit ${product ? 'item' : 'post'}`
          : `Add ${product ? 'an item' : 'a post'}`
      }
      onClose={onClose}
      busy={busy || uploading}
    >
      <form className="panel-form" onSubmit={submit}>
        {notice && <Notice>{notice}</Notice>}
        <label>
          {product ? 'Item name' : 'Post title'}
          <input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              product
                ? 'e.g. Handmade ceramic mug'
                : 'e.g. Fresh from our kitchen'
            }
          />
        </label>
        {product && (
          <>
            <div className="panel-two-fields">
              <label>
                Price
                <input
                  required
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    setPriceError('');
                  }}
                  aria-invalid={Boolean(priceError)}
                  aria-describedby={priceError ? 'price-error' : undefined}
                  placeholder="0.00"
                  maxLength={18}
                />
              </label>
              <label>
                Currency
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
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
                  ).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            {priceError && (
              <p className="panel-field-error" id="price-error" role="alert">
                {priceError}
              </p>
            )}
            <label>
              Category
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="other">General</option>
                <option value="food">Food</option>
                <option value="beverage">Drinks</option>
                <option value="merchandise">Merchandise</option>
                <option value="service">Services</option>
              </select>
            </label>
          </>
        )}
        <details className="panel-optional">
          <summary>
            A few more details <span>Optional</span>
          </summary>
          <label>
            Description
            <textarea
              maxLength={3000}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          {product && (
            <label>
              Available stock
              <input
                type="number"
                min={0}
                max={4294967295}
                step={1}
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder="Leave blank to skip stock tracking"
              />
            </label>
          )}
        </details>
        {!record ? (
          <div className="panel-note">
            <ImagePlus size={24} />
            <p>
              Save a draft to add {product ? 'photos' : 'photos or videos'}. It
              stays private until you publish.
            </p>
            <button name="action" value="photos" disabled={busy}>
              Save draft & add photos
            </button>
          </div>
        ) : (
          <>
            {!product &&
              (media.isPending ? (
                <Loading />
              ) : media.isError ? (
                <Retry error={media.error} retry={() => void media.refetch()} />
              ) : (
                <div className="panel-photo-grid">
                  {media.data.map((asset) => {
                    const key = asset.variants.find(
                      (v) =>
                        v.mimeType ===
                        (asset.kind === 'video' ? 'video/mp4' : 'image/webp'),
                    )?.storageKey;
                    return key ? (
                      asset.kind === 'video' ? (
                        <video
                          key={asset.id}
                          controls
                          src={storeMediaUrl(key)}
                        />
                      ) : (
                        <img
                          key={asset.id}
                          src={storeMediaUrl(key)}
                          alt="Post media"
                        />
                      )
                    ) : (
                      <span className="panel-pill" key={asset.id}>
                        {asset.status}
                      </span>
                    );
                  })}
                </div>
              ))}
            {!product && record.status === 'published' ? (
              <div className="panel-note">
                <p>Move this post to drafts before adding more media.</p>
                <button value="photos" disabled={busy}>
                  Move to draft
                </button>
              </div>
            ) : (
              <MediaUpload
                targetId={record.id}
                purpose={product ? 'product_image' : 'post'}
                label={product ? 'Product photos' : 'Photos & videos'}
                keys={keys}
                onChange={setKeys}
                onBusy={setUploading}
                onPending={setProcessing}
                disabled={busy || uploading || processing}
                allowVideo={!product}
                maxImageBytes={
                  typeof summary.limits.maxImageSizeBytes === 'number'
                    ? summary.limits.maxImageSizeBytes
                    : undefined
                }
                maxVideoBytes={
                  typeof summary.limits.maxVideoSizeBytes === 'number'
                    ? summary.limits.maxVideoSizeBytes
                    : undefined
                }
              />
            )}
            {existingPending && (
              <p className="panel-muted">
                Wait for media processing to finish before publishing.
              </p>
            )}
            {existingFailed && (
              <Notice error>
                A media upload failed. You can add a supported replacement;
                failed uploads are not shown publicly.
              </Notice>
            )}
          </>
        )}
        {error && <Notice error>{error}</Notice>}
        <div className="panel-actions panel-editor-actions">
          <button disabled={busy || uploading} value="draft">
            Save draft
          </button>
          {record && (
            <button disabled={busy || uploading} value="archive">
              Archive
            </button>
          )}
          <button
            className="panel-primary"
            value="publish"
            disabled={
              busy ||
              uploading ||
              processing ||
              Boolean(existingPending) ||
              (!product &&
                Boolean(record) &&
                (media.isPending || media.isError))
            }
          >
            {busy ? 'Saving…' : 'Publish'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
