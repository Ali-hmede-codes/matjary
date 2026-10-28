import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Copy, ImagePlus, Package, Plus, Trash2 } from 'lucide-react';
import {
  assetUrl,
  deleteStory,
  type ProductOptionGroup,
  type Store,
} from '../../lib/api';
import { storyTimeLabel } from '../../lib/stories';
import { useMyStories } from '../../hooks/useStories';
import { StoryComposer } from '../../components/stories/StoryComposer';
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
import {
  normalizeSlug,
  productCategoryLabel,
  productPriceLabel,
  productStatusLabel,
  storeMediaUrl,
} from '../../lib/storefront';
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
  categoryId?: string | null;
  categoryName?: string | null;
  stockQuantity?: number | null;
  imageKeys?: string[] | null;
  options?: ProductOptionGroup[] | null;
  // Posts carry their first ready media variant here; products use imageKeys.
  thumbnailKey?: string | null;
  // Shoppable posts point at one own product or one own section.
  linkedProductId?: string | null;
  linkedCategoryId?: string | null;
}
interface LinkProduct {
  id: string;
  name: string;
  priceCents?: string;
  currency?: string;
}
interface Category {
  id: string;
  name: string;
  sortOrder: number;
  productCount?: number;
}
interface CategoryList {
  items: Category[];
  total: number;
  limit?: number | null;
}
interface PostMedia {
  id: string;
  kind: string;
  status: string;
  variants: { storageKey: string; mimeType: string }[];
}

interface OptionValueDraft {
  label: string;
  price: string;
}

interface OptionGroupDraft {
  name: string;
  // Prices are hidden until the owner asks for value-specific prices.
  priced: boolean;
  values: OptionValueDraft[];
}

interface OptionValueWrite {
  label: string;
  priceCents: number | null;
}

interface OptionGroupWrite {
  name: string;
  values: OptionValueWrite[];
}

function optionDrafts(
  groups?: ProductOptionGroup[] | null,
): OptionGroupDraft[] {
  return (groups ?? []).map((group) => ({
    name: group.name,
    priced: group.values.some(
      (value) => value.priceCents != null && value.priceCents !== '0',
    ),
    values: group.values.map((value) => ({
      label: value.label,
      price: value.priceCents ? decimalPrice(value.priceCents) : '',
    })),
  }));
}
// Live stories belong to the shop, not to the post list, so the panel shows the
// remaining slots and lets the owner remove a story before its 24 hours end.
function StoryPanel({ store }: { store: Store }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState('');
  const stories = useMyStories(store.slug, true);
  const data = stories.data;
  const full =
    data?.limit === 0 || (data?.remaining != null && data.remaining <= 0);

  function refresh() {
    void client.invalidateQueries({ queryKey: ['my-stories', store.slug] });
    void client.invalidateQueries({ queryKey: ['stories'] });
  }

  async function remove(id: string) {
    if (
      !window.confirm(
        'Delete this story? Its slot becomes free immediately and cannot be restored.',
      )
    )
      return;
    setDeleting(id);
    setError('');
    setNotice('');
    try {
      await deleteStory(id);
      setNotice('Story deleted · the slot is free again.');
      refresh();
    } catch {
      setError('Could not delete this story. Please try again.');
    } finally {
      setDeleting('');
    }
  }

  return (
    <section className="panel-card panel-stories">
      <div className="panel-stories-head">
        <div>
          <h2>Stories</h2>
          <p>
            {data
              ? data.limit == null
                ? `${data.used} live · unlimited on this plan`
                : `${data.used} of ${data.limit} live · a slot frees up after 24 hours or when you delete a story`
              : 'One photo or short video, live for 24 hours.'}
          </p>
        </div>
        <button
          className="panel-primary"
          disabled={full}
          onClick={() => setOpen(true)}
        >
          <Plus size={16} /> Add a story
        </button>
      </div>
      {notice && <Notice>{notice}</Notice>}
      {error && <Notice error>{error}</Notice>}
      {data && data.stories.length > 0 ? (
        <ul className="panel-story-grid">
          {data.stories.map((story) => (
            <li key={story.id}>
              <img
                src={assetUrl(story.media.posterUrl ?? story.media.primaryUrl)}
                alt=""
                loading="lazy"
              />
              <span>{storyTimeLabel(story.createdAt)}</span>
              <button
                type="button"
                aria-label="Delete this story"
                title="Delete this story"
                disabled={deleting === story.id}
                onClick={() => void remove(story.id)}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel-muted">
          {data?.limit === 0
            ? 'Stories are not included in this plan.'
            : 'No live stories yet. Share one to show it on your shop and the home rail.'}
        </p>
      )}
      {open && (
        <StoryComposer
          store={store}
          myStories={data}
          onClose={() => setOpen(false)}
          onShared={() => {
            setOpen(false);
            setNotice('Story shared · live for 24 hours.');
            refresh();
          }}
        />
      )}
    </section>
  );
}

export function OwnerContent({ kind }: { kind: 'products' | 'posts' }) {
  const { store, session } = useOwner();
  const client = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('');
  const [editor, setEditor] = useState<Content | null | undefined>();
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [statusBusy, setStatusBusy] = useState('');
  const [deleting, setDeleting] = useState('');
  const product = kind === 'products';
  const categoryQuery = useQuery({
    queryKey: ['categories', store!.slug, 'my'],
    queryFn: ({ signal }) =>
      getJson<CategoryList>(
        `stores/${encodeURIComponent(store!.slug)}/categories/my`,
        signal,
      ),
    enabled: product,
  });
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
  // Never index into a missing envelope: an unexpected payload must degrade to
  // an empty list instead of taking the whole panel down.
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const label = product
    ? store!.storeType === 'restaurant_menu'
      ? 'menu item'
      : 'product'
    : 'post';
  // A turned-off section stays editable (owners may delete items to make room)
  // but cannot accept new items until it is switched back on.
  const sectionOff = product
    ? store!.enableProductsSection === false
    : store!.enablePostsSection === false;
  // The quick toggle only applies to items that are already live: a draft or an
  // archived item is published (or not) through the editor instead.
  const isLive = (item: Content) =>
    item.status === 'active' || item.status === 'out_of_stock';
  async function toggleAvailability(item: Content) {
    if (statusBusy) return;
    const next = item.status === 'out_of_stock' ? 'active' : 'out_of_stock';
    setStatusBusy(item.id);
    setNotice('');
    setActionError('');
    try {
      await mutate(
        `stores/${encodeURIComponent(store!.slug)}/products/${encodeURIComponent(item.slug)}`,
        { status: next },
        'PATCH',
      );
      setNotice(
        next === 'out_of_stock'
          ? `${item.name || 'This item'} is now shown as out of stock.`
          : `${item.name || 'This item'} is available to order again.`,
      );
      await query.refetch();
    } catch (e) {
      setActionError(panelError(e));
    } finally {
      setStatusBusy('');
    }
  }
  async function removePost(item: Content) {
    if (deleting) return;
    const name = item.title || 'this post';
    if (
      !window.confirm(
        `Delete “${name}”? Its photos and videos are removed permanently, and this cannot be undone.`,
      )
    )
      return;
    setDeleting(item.id);
    setNotice('');
    setActionError('');
    try {
      await mutate(`posts/${encodeURIComponent(item.slug)}`, {}, 'DELETE');
      setNotice(`“${name}” was deleted.`);
      // The panel list, the dashboard counters, and public views all lose this
      // post, so refresh every cache that may still show it.
      await Promise.all([
        client.invalidateQueries({ queryKey: ['panel', session.user.id] }),
        client.invalidateQueries({ queryKey: ['storefront'] }),
        client.invalidateQueries({ queryKey: ['storefront-posts'] }),
        client.invalidateQueries({ queryKey: ['explore'] }),
      ]);
      // Deleting the only row on a later page would leave it empty.
      if (items.length === 1 && offset > 0) setOffset(Math.max(0, offset - 20));
    } catch (e) {
      setActionError(panelError(e));
    } finally {
      setDeleting('');
    }
  }
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
          sectionOff ? undefined : (
            <button className="panel-primary" onClick={() => setEditor(null)}>
              <Plus size={18} /> Add {label}
            </button>
          )
        }
      />
      {sectionOff && (
        <Notice>
          {product
            ? store!.storeType === 'restaurant_menu'
              ? 'Your menu section is turned off for this shop.'
              : 'Products are turned off for this shop.'
            : 'Posts are turned off for this shop.'}{' '}
          Existing items stay saved, and your plan’s other section can use their
          allowance. <Link to="/dashboard/settings">Turn it back on</Link>.
        </Notice>
      )}
      {notice && <Notice>{notice}</Notice>}
      {actionError && <Notice error>{actionError}</Notice>}
      {!product && <StoryPanel store={store!} />}
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
            <option value={product ? 'active' : 'published'}>
              {product ? 'Published (in stock)' : 'Published'}
            </option>
            <option value="archived">Archived</option>
            {product && <option value="out_of_stock">Out of stock</option>}
          </select>
        </label>
        {product && (
          <button type="button" onClick={() => setCategoriesOpen(true)}>
            Manage categories
          </button>
        )}
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
                    {item.imageKeys?.[0] || item.thumbnailKey ? (
                      <img
                        src={storeMediaUrl(
                          item.imageKeys?.[0] || item.thumbnailKey,
                        )}
                        alt={item.name || item.title || ''}
                        loading="lazy"
                      />
                    ) : product ? (
                      <Package size={30} />
                    ) : (
                      <ImagePlus size={30} />
                    )}
                    <span
                      className={`panel-pill${item.status === 'out_of_stock' ? ' is-out-of-stock' : ''}`}
                    >
                      {productStatusLabel[
                        item.status as keyof typeof productStatusLabel
                      ] ?? item.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <div className="panel-content-body">
                    <h2>{item.name || item.title}</h2>
                    <p className="panel-content-meta">
                      {product ? (
                        <strong>
                          {productPriceLabel({
                            priceCents: item.priceCents || '0',
                            currency: item.currency || 'USD',
                            options: item.options ?? null,
                          })}
                        </strong>
                      ) : null}
                      {product && item.options?.length ? (
                        <span>
                          {item.options.length}{' '}
                          {item.options.length === 1 ? 'option' : 'options'} ·{' '}
                          {item.options.map((option) => option.name).join(', ')}
                        </span>
                      ) : (
                        !product && (
                          <span>{item.description || 'Your next story.'}</span>
                        )
                      )}
                    </p>
                    <div className="panel-content-actions">
                      <button
                        type="button"
                        aria-label={`Edit ${item.name || item.title || label}`}
                        onClick={() => setEditor(item)}
                      >
                        Edit
                      </button>
                      {product && isLive(item) && (
                        <button
                          type="button"
                          disabled={statusBusy === item.id}
                          onClick={() => void toggleAvailability(item)}
                        >
                          {statusBusy === item.id
                            ? 'Updating…'
                            : item.status === 'out_of_stock'
                              ? 'Mark in stock'
                              : 'Mark out of stock'}
                        </button>
                      )}
                      {!product && (
                        <button
                          type="button"
                          disabled={Boolean(deleting)}
                          onClick={() => void removePost(item)}
                        >
                          {deleting === item.id ? 'Deleting…' : 'Delete'}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty title={`Your next ${label} starts here`}>
              <p>Keep it simple. You can always add more details later.</p>
              {!sectionOff && (
                <button
                  className="panel-primary"
                  onClick={() => setEditor(null)}
                >
                  Add {label}
                </button>
              )}
            </Empty>
          )}
          <Pagination total={total} offset={offset} onChange={setOffset} />
        </>
      )}
      {categoriesOpen && (
        <CategoryManager
          slug={store!.slug}
          close={() => setCategoriesOpen(false)}
          changed={() => {
            void categoryQuery.refetch();
            void query.refetch();
          }}
        />
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
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? '');
  // Availability is stored as the product's status: publishing an item keeps
  // "out of stock" visible to shoppers instead of hiding it.
  const [availability, setAvailability] = useState<'active' | 'out_of_stock'>(
    item?.status === 'out_of_stock' ? 'out_of_stock' : 'active',
  );
  const [stock, setStock] = useState(
    item?.stockQuantity == null ? '' : String(item.stockQuantity),
  );
  const [description, setDescription] = useState(item?.description || '');
  // One value drives the picker: "p:<id>", "c:<id>" or empty for no link.
  const [linkValue, setLinkValue] = useState(
    item?.linkedProductId
      ? `p:${item.linkedProductId}`
      : item?.linkedCategoryId
        ? `c:${item.linkedCategoryId}`
        : '',
  );
  const [keys, setKeys] = useState(item?.imageKeys || []);
  const [options, setOptions] = useState<OptionGroupDraft[]>(() =>
    optionDrafts(item?.options),
  );
  const [optionsTouched, setOptionsTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [priceError, setPriceError] = useState('');
  const [optionsError, setOptionsError] = useState('');
  // The web address is generated from the item name on the server; owners
  // never type it. An existing item keeps its stored address so links that
  // were already shared keep working.
  const addressPreview = record?.slug || normalizeSlug(name);
  const snapshotOf = (values: {
    name: string;
    price: string;
    currency: string;
    categoryId: string;
    availability: string;
    stock: string;
    description: string;
    keys: string[];
    options: OptionGroupDraft[];
    link: string;
  }) => JSON.stringify(values);
  const snapshot = snapshotOf({
    name,
    price,
    currency,
    categoryId,
    availability,
    stock,
    description,
    keys,
    options,
    link: linkValue,
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
  const categoryList = useQuery({
    queryKey: ['categories', store!.slug, 'my'],
    queryFn: ({ signal }) =>
      getJson<CategoryList>(
        `stores/${encodeURIComponent(store!.slug)}/categories/my`,
        signal,
      ),
    enabled: product,
  });
  // Shoppable posts can only point at this shop's own catalogue, so the picker
  // offers exactly the rows the owner already created here.
  const linkSources = useQuery({
    queryKey: ['panel', session.user.id, 'post-link-sources', store!.id],
    queryFn: async ({ signal }) => {
      const [products, categories] = await Promise.all([
        getJson<LinkProduct[]>(
          `stores/${encodeURIComponent(store!.slug)}/products/my`,
          signal,
        ),
        getJson<CategoryList>(
          `stores/${encodeURIComponent(store!.slug)}/categories/my`,
          signal,
        ),
      ]);
      return { products, categories: categories.items };
    },
    enabled: !product,
    staleTime: 60_000,
  });
  const linkProducts = linkSources.data?.products ?? [];
  const linkCategories = linkSources.data?.categories ?? [];
  // Other products owned by this account are the source for copied options.
  // One query covers every store, so a shop can reuse a size chart or color
  // list from a sibling shop without retyping it.
  const optionSources = useQuery({
    queryKey: ['panel', session.user.id, 'product-option-sources'],
    queryFn: ({ signal }) =>
      getJson<Page<Content>>('dashboard/products?limit=100', signal),
    enabled: product,
  });
  const sourceProducts = (optionSources.data?.items ?? []).filter(
    (entry) => entry.id !== record?.id && Boolean(entry.options?.length),
  );
  const existingPending =
    !product &&
    media.data?.some(
      (a) => a.status === 'pending' || a.status === 'processing',
    );
  const existingFailed =
    !product && media.data?.some((a) => a.status === 'failed');
  function updateOption(index: number, next: OptionGroupDraft) {
    setOptions((current) =>
      current.map((group, position) => (position === index ? next : group)),
    );
    setOptionsTouched(true);
    setOptionsError('');
  }
  function removeOption(index: number) {
    setOptions((current) =>
      current.filter((_, position) => position !== index),
    );
    setOptionsTouched(true);
    setOptionsError('');
  }
  function addOption() {
    if (options.length >= 10) return;
    setOptions((current) => [
      ...current,
      { name: '', priced: false, values: [{ label: '', price: '' }] },
    ]);
    setOptionsTouched(true);
    setOptionsError('');
  }
  function toggleOptionPrices(groupIndex: number) {
    setOptions((current) =>
      current.map((group, index) => {
        if (index !== groupIndex) return group;
        const priced = !group.priced;
        return {
          ...group,
          priced,
          // Hiding prices must also stop sending them, so turning the switch
          // off returns every value to the item's base price.
          values: priced
            ? group.values
            : group.values.map((value) => ({ ...value, price: '' })),
        };
      }),
    );
    setOptionsTouched(true);
    setOptionsError('');
  }
  function addValue(groupIndex: number) {
    setOptions((current) =>
      current.map((group, index) =>
        index === groupIndex && group.values.length < 25
          ? {
              ...group,
              values: [...group.values, { label: '', price: '' }],
            }
          : group,
      ),
    );
    setOptionsTouched(true);
    setOptionsError('');
  }
  function updateValue(
    groupIndex: number,
    valueIndex: number,
    patch: Partial<OptionValueDraft>,
  ) {
    setOptions((current) =>
      current.map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              values: group.values.map((value, position) =>
                position === valueIndex ? { ...value, ...patch } : value,
              ),
            }
          : group,
      ),
    );
    setOptionsTouched(true);
    setOptionsError('');
  }
  function removeValue(groupIndex: number, valueIndex: number) {
    setOptions((current) =>
      current.map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              values: group.values.filter(
                (_, position) => position !== valueIndex,
              ),
            }
          : group,
      ),
    );
    setOptionsTouched(true);
    setOptionsError('');
  }
  function copyOptions(sourceId: string) {
    const source = optionSources.data?.items.find(
      (entry) => entry.id === sourceId,
    );
    if (!source?.options?.length) return;
    setOptions(optionDrafts(source.options));
    setOptionsTouched(true);
    setOptionsError('');
    setNotice(
      `Options copied from ${source.name}. Adjust the names or values, then save.`,
    );
  }
  function validateOptions(): {
    groups: OptionGroupWrite[] | null;
    error: string;
  } {
    const groups: OptionGroupWrite[] = [];
    const names = new Set<string>();
    for (const group of options) {
      const optionName = group.name.trim();
      const rows = group.values.filter(
        (row) => row.label.trim() || (group.priced && row.price.trim()),
      );
      // An option row that was added and left blank is simply ignored.
      if (!optionName && !rows.length) continue;
      if (!optionName)
        return {
          groups: null,
          error: 'Give each option a name, such as Size or Color.',
        };
      if (!rows.length)
        return {
          groups: null,
          error: `Add at least one value for “${optionName}”.`,
        };
      if (rows.length > 25)
        return {
          groups: null,
          error: `“${optionName}” can have at most 25 values.`,
        };

      const values: OptionValueWrite[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        const label = row.label.trim();
        if (!label)
          return {
            groups: null,
            error: `Give every value in “${optionName}” a name.`,
          };
        const priceText = group.priced ? row.price.trim() : '';
        const cents = priceText === '' ? null : priceInput(priceText);
        // A blank price is valid: the value keeps the item's base price.
        if (priceText !== '' && cents === null)
          return {
            groups: null,
            error: `Use a price such as 15.00 for “${label}”, or leave it blank.`,
          };
        const valueKey = label.toLowerCase();
        if (seen.has(valueKey))
          return {
            groups: null,
            error: `“${label}” appears twice in “${optionName}”.`,
          };
        seen.add(valueKey);
        values.push({
          label,
          priceCents: cents === 0 ? null : cents,
        });
      }

      const nameKey = optionName.toLowerCase();
      if (names.has(nameKey))
        return { groups: null, error: 'Option names must be unique.' };
      names.add(nameKey);
      groups.push({ name: optionName, values });
    }
    if (groups.length > 10)
      return {
        groups: null,
        error: 'A product can have at most 10 options.',
      };
    const pricedGroups = groups.filter((group) =>
      group.values.some((value) => value.priceCents !== null),
    );
    if (pricedGroups.length > 1)
      return {
        groups: null,
        error:
          'Only one option can set its own prices, such as Size. Leave the other options blank.',
      };
    return { groups: groups.length ? groups : null, error: '' };
  }
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
    const cleanName = name.trim();
    if (!cleanName) {
      setError(product ? 'Enter an item name.' : 'Enter a post title.');
      return;
    }
    const cents = priceInput(price);
    if (product && cents === null) {
      setPriceError('Use a price such as 12.50, with at most two decimals.');
      return;
    }
    const shouldSaveOptions = product && (optionsTouched || !record);
    const validated = shouldSaveOptions
      ? validateOptions()
      : { groups: null, error: '' };
    if (validated.error) {
      setOptionsError(validated.error);
      return;
    }
    setBusy(true);
    setError('');
    setPriceError('');
    setOptionsError('');
    setNotice('');
    const cleanDescription = description.trim();
    try {
      const base = product
        ? `stores/${encodeURIComponent(store!.slug)}/products`
        : 'posts';
      // The API derives a unique, readable address from the name for a new
      // product and leaves an existing product's address untouched.
      const body = {
        ...(product
          ? {
              name: cleanName,
              priceCents: cents,
              currency,
              categoryId: categoryId || null,
              stockQuantity: stock === '' ? null : Number(stock),
              ...(shouldSaveOptions ? { options: validated.groups } : {}),
              ...(record ? { imageKeys: keys } : {}),
              ...(!record
                ? { requiresShipping: store?.storeType !== 'restaurant_menu' }
                : {}),
            }
          : {
              title: cleanName,
              ...(!record ? { storeId: store!.id } : {}),
              linkedProductId: linkValue.startsWith('p:')
                ? linkValue.slice(2)
                : null,
              linkedCategoryId: linkValue.startsWith('c:')
                ? linkValue.slice(2)
                : null,
            }),
        description: cleanDescription || null,
        status,
      };
      const saved = await mutate<Content>(
        record ? `${base}/${encodeURIComponent(record.slug)}` : base,
        body,
        record ? 'PATCH' : 'POST',
      );
      const nextOptions = saved.options
        ? optionDrafts(saved.options)
        : shouldSaveOptions
          ? []
          : options;
      setRecord(saved);
      setName(cleanName);
      setDescription(cleanDescription);
      const savedLink = saved.linkedProductId
        ? `p:${saved.linkedProductId}`
        : saved.linkedCategoryId
          ? `c:${saved.linkedCategoryId}`
          : '';
      setLinkValue(savedLink);
      setOptionsTouched(false);
      setOptions(nextOptions);
      // A live item reports its saved availability; a draft or archived item
      // keeps the owner's choice so the next publish uses it.
      const nextAvailability: 'active' | 'out_of_stock' =
        saved.status === 'out_of_stock'
          ? 'out_of_stock'
          : saved.status === 'active'
            ? 'active'
            : availability;
      if (product) setAvailability(nextAvailability);
      setBaseline(
        snapshotOf({
          name: cleanName,
          price,
          currency,
          categoryId,
          availability: nextAvailability,
          stock,
          description: cleanDescription,
          keys,
          options: nextOptions,
          link: savedLink,
        }),
      );
      await client.invalidateQueries({
        queryKey: ['panel', session.user.id, kind],
      });
      await client.invalidateQueries({
        queryKey: ['panel', session.user.id, 'summary'],
      });
      await client.invalidateQueries({
        queryKey: ['panel', session.user.id, 'product-option-sources'],
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
              : status === 'out_of_stock'
                ? 'Saved. Shoppers now see this item as out of stock.'
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
          ? availability
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
          <div className="panel-slug-preview">
            <span className="panel-slug-preview-label">Web address</span>
            <code>
              /stores/{store!.slug}/p/
              <strong>{addressPreview || 'item-name'}</strong>
            </code>
            <small>
              {record
                ? 'The address stays the same when you rename the item, so shared links keep working.'
                : 'Created automatically from the item name. No setup needed.'}
            </small>
          </div>
        )}
        {product && (
          <>
            <div className="panel-two-fields">
              <label>
                Base price
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
                <small>
                  Used when an option value has no price of its own.
                </small>
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
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">No category</option>
                {(categoryList.data?.items ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <small>
                {item?.categoryId == null && item?.category
                  ? `Legacy category: ${productCategoryLabel(item.category)}. Choose a shop category to replace it.`
                  : 'Categories are managed per shop and count toward your plan.'}
              </small>
            </label>
            <fieldset className="panel-availability">
              <legend>
                Availability <span>Shown to shoppers</span>
              </legend>
              <div className="panel-availability-options">
                {(
                  [
                    [
                      'active',
                      'In stock',
                      'Shoppers can order this item right away.',
                    ],
                    [
                      'out_of_stock',
                      'Out of stock',
                      'It stays on your shop, but ordering is paused.',
                    ],
                  ] as const
                ).map(([value, title, hint]) => (
                  <label
                    key={value}
                    className={`panel-availability-option${availability === value ? ' is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="availability"
                      value={value}
                      checked={availability === value}
                      onChange={() => setAvailability(value)}
                    />
                    <span>
                      <strong>{title}</strong>
                      <small>{hint}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="panel-option-editor">
              <legend>
                Options <span>Optional</span>
              </legend>
              <p className="panel-muted">
                Add choices such as Size or Color. Shoppers must pick one value
                from each option. Prices are optional: leave them blank to use
                the item’s base price.
              </p>
              {options.map((group, index) => (
                <div className="panel-option-group" key={index}>
                  <div className="panel-option-group-head">
                    <label>
                      Option name
                      <input
                        maxLength={60}
                        value={group.name}
                        onChange={(e) =>
                          updateOption(index, {
                            ...group,
                            name: e.target.value,
                          })
                        }
                        placeholder="e.g. Size"
                      />
                    </label>
                    <button
                      type="button"
                      className="panel-option-remove"
                      aria-label={`Remove ${group.name || 'option'}`}
                      title="Remove option"
                      onClick={() => removeOption(index)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <label className="panel-option-price-toggle">
                    <input
                      type="checkbox"
                      checked={group.priced}
                      onChange={() => toggleOptionPrices(index)}
                    />
                    <span>
                      Set a price for each value
                      <small>
                        Example: $10 small, $15 medium, $20 large. A blank price
                        uses the item’s base price.
                      </small>
                    </span>
                  </label>
                  <div className="panel-option-values">
                    {group.values.map((value, valueIndex) => (
                      <div
                        className={`panel-option-value-row${group.priced ? '' : ' is-plain'}`}
                        key={valueIndex}
                      >
                        <label className="panel-option-value-label">
                          Value
                          <input
                            maxLength={80}
                            value={value.label}
                            onChange={(e) =>
                              updateValue(index, valueIndex, {
                                label: e.target.value,
                              })
                            }
                            placeholder="e.g. Large"
                          />
                        </label>
                        {group.priced && (
                          <label className="panel-option-value-price">
                            Price
                            <input
                              inputMode="decimal"
                              maxLength={18}
                              value={value.price}
                              onChange={(e) =>
                                updateValue(index, valueIndex, {
                                  price: e.target.value,
                                })
                              }
                              placeholder={price || 'Item price'}
                            />
                          </label>
                        )}
                        <button
                          type="button"
                          className="panel-option-value-remove"
                          aria-label={`Remove ${value.label || 'value'}`}
                          title="Remove value"
                          onClick={() => removeValue(index, valueIndex)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="panel-option-add-value"
                      onClick={() => addValue(index)}
                      disabled={group.values.length >= 25}
                    >
                      <Plus size={15} /> Add value
                    </button>
                  </div>
                </div>
              ))}
              <div className="panel-option-tools">
                <button
                  type="button"
                  onClick={addOption}
                  disabled={options.length >= 10}
                >
                  <Plus size={16} /> Add option
                </button>
                {sourceProducts.length > 0 && (
                  <label className="panel-option-copy">
                    <span>
                      <Copy size={15} /> Copy from another product
                    </span>
                    <select
                      value=""
                      onChange={(e) => copyOptions(e.target.value)}
                    >
                      <option value="">Choose a product…</option>
                      {sourceProducts.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.name || 'Untitled'} ·{' '}
                          {source.options?.length ?? 0}{' '}
                          {(source.options?.length ?? 0) === 1
                            ? 'option'
                            : 'options'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {optionSources.isError && (
                <small>
                  The products you can copy from could not load. You can still
                  add options manually.
                </small>
              )}
              {optionsError && (
                <p className="panel-field-error" role="alert">
                  {optionsError}
                </p>
              )}
            </fieldset>
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
          {!product && (
            <label>
              Linked product or section
              <select
                value={linkValue}
                onChange={(e) => setLinkValue(e.target.value)}
              >
                <option value="">Nothing linked</option>
                {linkProducts.length > 0 && (
                  <optgroup label="Products">
                    {linkProducts.map((entry) => (
                      <option key={entry.id} value={`p:${entry.id}`}>
                        {entry.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {linkCategories.length > 0 && (
                  <optgroup label="Sections">
                    {linkCategories.map((entry) => (
                      <option key={entry.id} value={`c:${entry.id}`}>
                        {entry.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <small>
                Shoppers see a small tag on this post that opens the product or
                section page.
              </small>
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

function CategoryManager({
  slug,
  close,
  changed,
}: {
  slug: string;
  close: () => void;
  changed: () => void;
}) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['categories', slug, 'my'],
    queryFn: ({ signal }) =>
      getJson<CategoryList>(
        `stores/${encodeURIComponent(slug)}/categories/my`,
        signal,
      ),
  });
  const [name, setName] = useState('');
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const path = `stores/${encodeURIComponent(slug)}/categories`;
  const limit = query.data?.limit;

  async function refresh() {
    await client.invalidateQueries({ queryKey: ['categories', slug] });
    changed();
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await mutate(path, { name: value });
      setName('');
      setNotice('Category added.');
      await refresh();
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy(false);
    }
  }

  async function rename(category: Category) {
    const value = (renames[category.id] ?? category.name).trim();
    if (!value || value === category.name || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await mutate(`${path}/${category.id}`, { name: value }, 'PATCH');
      setRenames((current) => {
        const next = { ...current };
        delete next[category.id];
        return next;
      });
      setNotice('Category renamed.');
      await refresh();
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(category: Category) {
    if (busy || (category.productCount ?? 0) > 0) return;
    if (!window.confirm(`Delete “${category.name}”?`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await mutate(`${path}/${category.id}`, {}, 'DELETE');
      setNotice('Category deleted.');
      await refresh();
    } catch (e) {
      setError(panelError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Categories" onClose={close} busy={busy}>
      <p className="panel-muted">
        {query.data
          ? `${query.data.total} of ${limit == null ? 'unlimited' : limit} categories used across all your shops.`
          : 'Categories group the items in this shop.'}
      </p>
      <form className="panel-toolbar" onSubmit={(e) => void add(e)}>
        <input
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category name"
          aria-label="New category name"
        />
        <button className="panel-primary" disabled={busy || !name.trim()}>
          Add category
        </button>
      </form>
      {notice && <Notice>{notice}</Notice>}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Retry error={query.error} retry={() => void query.refetch()} />
      ) : query.data.items.length ? (
        <div className="panel-list-card">
          {query.data.items.map((category) => {
            const value = renames[category.id] ?? category.name;
            const used = category.productCount ?? 0;
            return (
              <div className="panel-record" key={category.id}>
                <div className="panel-record-info">
                  <input
                    maxLength={100}
                    value={value}
                    onChange={(e) =>
                      setRenames((current) => ({
                        ...current,
                        [category.id]: e.target.value,
                      }))
                    }
                    aria-label={`Name for ${category.name}`}
                  />
                  <p>
                    {used} {used === 1 ? 'item' : 'items'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy || value.trim() === category.name}
                  onClick={() => void rename(category)}
                >
                  Rename
                </button>
                <button
                  type="button"
                  disabled={busy || used > 0}
                  title={
                    used > 0
                      ? 'Move or delete its products first'
                      : 'Delete category'
                  }
                  onClick={() => void remove(category)}
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty title="No categories yet">
          <p>Add a category to group menu items or products.</p>
        </Empty>
      )}
      {error && <Notice error>{error}</Notice>}
      <div className="panel-actions">
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  );
}
