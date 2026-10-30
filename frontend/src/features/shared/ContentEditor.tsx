import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Trash2 } from 'lucide-react';
import type { ProductOptionGroup, Store } from '../../lib/api';
import {
  decimalPrice,
  getJson,
  mutate,
  panelError,
  priceInput,
  type Page,
} from './panel-api';
import { Loading, Modal, Notice, Retry, useUnsaved } from './PanelUI';
import { MediaUpload } from './MediaUpload';
import { useWebsiteSettings } from '../../hooks/useWebsiteSettings';
import {
  normalizeSlug,
  productCategoryLabel,
  storeMediaUrl,
} from '../../lib/storefront';

// Plan ceilings the picker shows before it negotiates a file.
export type EditorLimits = Record<string, number | string | boolean | null>;

export interface Content {
  id: string;
  slug: string;
  name?: string;
  title?: string;
  status: string;
  description: string | null;
  priceCents?: string;
  // Old price while the item is on sale; null means no sale.
  compareAtPriceCents?: string | null;
  currency?: string;
  category?: string;
  categoryId?: string | null;
  categoryName?: string | null;
  sku?: string | null;
  stockQuantity?: number | null;
  weightGrams?: number | null;
  imageKeys?: string[] | null;
  tags?: string[] | null;
  options?: ProductOptionGroup[] | null;
  sortOrder?: number;
  requiresShipping?: boolean;
  // Posts carry their first ready media variant here; products use imageKeys.
  thumbnailKey?: string | null;
  // Shoppable posts point at one own product or one own section.
  linkedProductId?: string | null;
  linkedCategoryId?: string | null;
}
interface LinkProduct {
  id: string;
  slug: string;
  name: string;
  priceCents?: string;
  compareAtPriceCents?: string | null;
  currency?: string;
}
export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  productCount?: number;
}
export interface CategoryList {
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

// Owner-authored search and social metadata. The API keeps these rows separate
// from the product/post, so the editor loads them once and sends them back with
// the same save that touches the content.
interface ContentSeo {
  metaTitle?: string | null;
  metaDescription?: string | null;
  metaKeywords?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  robots?: string | null;
  brand?: string | null;
  gtin?: string | null;
  mpn?: string | null;
  articleAuthor?: string | null;
  articleSection?: string | null;
  articleTags?: string[] | null;
}

interface SeoDraft {
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
  ogTitle: string;
  ogDescription: string;
  brand: string;
  gtin: string;
  mpn: string;
  articleAuthor: string;
  articleSection: string;
  articleTags: string;
  hidden: boolean;
}

const emptySeo: SeoDraft = {
  metaTitle: '',
  metaDescription: '',
  metaKeywords: '',
  ogTitle: '',
  ogDescription: '',
  brand: '',
  gtin: '',
  mpn: '',
  articleAuthor: '',
  articleSection: '',
  articleTags: '',
  hidden: false,
};

function seoDraftFrom(seo: ContentSeo | null | undefined): SeoDraft {
  return {
    metaTitle: seo?.metaTitle ?? '',
    metaDescription: seo?.metaDescription ?? '',
    metaKeywords: seo?.metaKeywords ?? '',
    ogTitle: seo?.ogTitle ?? '',
    ogDescription: seo?.ogDescription ?? '',
    brand: seo?.brand ?? '',
    gtin: seo?.gtin ?? '',
    mpn: seo?.mpn ?? '',
    articleAuthor: seo?.articleAuthor ?? '',
    articleSection: seo?.articleSection ?? '',
    articleTags: (seo?.articleTags ?? []).join(', '),
    // "noindex" is stored inside the directive, so a substring check keeps the
    // toggle correct whichever follow rule the owner chose earlier.
    hidden: Boolean(seo?.robots?.includes('noindex')),
  };
}

function cleanSeo(draft: SeoDraft): SeoDraft {
  const trim = (value: string) => value.trim();
  return {
    metaTitle: trim(draft.metaTitle),
    metaDescription: trim(draft.metaDescription),
    metaKeywords: trim(draft.metaKeywords),
    ogTitle: trim(draft.ogTitle),
    ogDescription: trim(draft.ogDescription),
    brand: trim(draft.brand),
    gtin: trim(draft.gtin),
    mpn: trim(draft.mpn),
    articleAuthor: trim(draft.articleAuthor),
    articleSection: trim(draft.articleSection),
    articleTags: trim(draft.articleTags),
    hidden: draft.hidden,
  };
}

// Owners type tags as one comma-separated line. The API accepts up to 20 short
// strings, so trim duplicates here and reject what would be refused anyway.
function tagList(value: string): string[] | null | undefined {
  const tags = Array.from(
    new Set(
      value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
  if (!tags.length) return null;
  if (tags.length > 20 || tags.some((tag) => tag.length > 100))
    return undefined;
  return tags;
}

// Optional whole-number fields share the same "blank means unset" rule.
function wholeNumber(value: string, max: number): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max
    ? parsed
    : undefined;
}

function seoWrite(draft: SeoDraft, product: boolean) {
  const articleTags = tagList(draft.articleTags);
  return {
    metaTitle: draft.metaTitle || null,
    metaDescription: draft.metaDescription || null,
    metaKeywords: draft.metaKeywords || null,
    ogTitle: draft.ogTitle || null,
    ogDescription: draft.ogDescription || null,
    robots: draft.hidden ? 'noindex, follow' : 'index, follow',
    ...(product
      ? {
          brand: draft.brand || null,
          gtin: draft.gtin || null,
          mpn: draft.mpn || null,
        }
      : {
          articleAuthor: draft.articleAuthor || null,
          articleSection: draft.articleSection || null,
          articleTags: Array.isArray(articleTags) ? articleTags : null,
        }),
  };
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

/**
 * The one editor behind every product and post. The dashboard opens it from
 * its lists; a shop page opens the same dialog from the owner's "+", so both
 * entry points offer the identical form, photos, and publish actions.
 */
export function ContentEditor({
  store,
  kind,
  item,
  cacheScope,
  limits,
  close,
  done,
}: {
  store: Store;
  kind: 'products' | 'posts';
  item: Content | null;
  // Query-key scope: the dashboard passes the signed-in account so its lists
  // refresh, the shopfront passes the shop it renders.
  cacheScope: string;
  // The dashboard already loaded the plan summary; other surfaces omit it and
  // the editor reads the same ceilings itself.
  limits?: EditorLimits;
  close: () => void;
  done: (message: string) => void;
}) {
  const client = useQueryClient();
  const { settings } = useWebsiteSettings(false);
  const product = kind === 'products';
  const [record, setRecord] = useState(item);
  // The upload pipeline and the save action both read the current row; refs
  // stay correct across the renders that happen while a file uploads.
  const recordRef = useRef<Content | null>(item);
  const creating = useRef<Promise<Content> | null>(null);
  useEffect(() => {
    recordRef.current = record;
  }, [record]);
  const [name, setName] = useState(item?.name || item?.title || '');
  const [price, setPrice] = useState(
    item?.priceCents ? decimalPrice(item.priceCents) : '',
  );
  const [currency, setCurrency] = useState(item?.currency || 'USD');
  // A sale is one optional old price beside the amount the item charges. For a
  // post the same switch edits the linked item, because that is the row whose
  // price the post and the shop both print.
  const [onSale, setOnSale] = useState(Boolean(item?.compareAtPriceCents));
  const [oldPrice, setOldPrice] = useState(
    item?.compareAtPriceCents ? decimalPrice(item.compareAtPriceCents) : '',
  );
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? '');
  // The list may be missing the section the owner needs; a compact inline form
  // adds it without leaving the item being written.
  const [categoryFormOpen, setCategoryFormOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  // Availability is stored as the product's status: publishing an item keeps
  // "out of stock" visible to shoppers instead of hiding it.
  const [availability, setAvailability] = useState<'active' | 'out_of_stock'>(
    item?.status === 'out_of_stock' ? 'out_of_stock' : 'active',
  );
  const [stock, setStock] = useState(
    item?.stockQuantity == null ? '' : String(item.stockQuantity),
  );
  const [sku, setSku] = useState(item?.sku ?? '');
  const [weight, setWeight] = useState(
    item?.weightGrams == null ? '' : String(item.weightGrams),
  );
  const [tags, setTags] = useState((item?.tags ?? []).join(', '));
  const [sortOrder, setSortOrder] = useState(String(item?.sortOrder ?? 0));
  const [shipping, setShipping] = useState(
    item?.requiresShipping ?? store.storeType !== 'restaurant_menu',
  );
  const [seo, setSeo] = useState<SeoDraft>(emptySeo);
  const [seoBaseline, setSeoBaseline] = useState(JSON.stringify(emptySeo));
  // The stored SEO row is loaded once per editor; user edits made before it
  // arrives must never be replaced by the server copy.
  const seoHydrated = useRef(false);
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
    sku: string;
    weight: string;
    tags: string;
    sortOrder: string;
    shipping: boolean;
    description: string;
    keys: string[];
    options: OptionGroupDraft[];
    link: string;
    sale: string;
  }) => JSON.stringify(values);
  const snapshot = snapshotOf({
    name,
    price,
    currency,
    categoryId,
    availability,
    stock,
    sku,
    weight,
    tags,
    sortOrder,
    shipping,
    description,
    keys,
    options,
    link: linkValue,
    sale: `${onSale ? '1' : '0'}:${oldPrice}`,
  });
  const [baseline, setBaseline] = useState(snapshot);
  const seoSnapshot = JSON.stringify(seo);
  const dirty = snapshot !== baseline || seoSnapshot !== seoBaseline;
  useUnsaved(dirty || uploading || processing);
  // The dashboard passes its loaded plan summary; a shopfront has no panel
  // state, so the editor reads the same ceilings itself.
  const limitsQuery = useQuery({
    queryKey: ['editor', 'limits', store.id],
    queryFn: ({ signal }) =>
      getJson<{ limits?: EditorLimits }>(
        `dashboard?storeId=${encodeURIComponent(store.id)}`,
        signal,
      ),
    enabled: !limits,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const effectiveLimits = limits ?? limitsQuery.data?.limits;
  const imageLimit = effectiveLimits?.maxImageSizeBytes;
  const videoLimit = effectiveLimits?.maxVideoSizeBytes;
  const maxImageBytes = typeof imageLimit === 'number' ? imageLimit : undefined;
  const maxVideoBytes = typeof videoLimit === 'number' ? videoLimit : undefined;
  const media = useQuery({
    queryKey: ['panel', cacheScope, 'post-media', record?.id],
    queryFn: ({ signal }) =>
      getJson<PostMedia[]>(`dashboard/showcases/${record!.id}/media`, signal),
    enabled: !product && Boolean(record),
    refetchInterval: (query) =>
      query.state.data?.some((a) => a.status === 'processing') ? 3000 : false,
  });
  const categoryList = useQuery({
    queryKey: ['categories', store.slug, 'my'],
    queryFn: ({ signal }) =>
      getJson<CategoryList>(
        `stores/${encodeURIComponent(store.slug)}/categories/my`,
        signal,
      ),
    enabled: product,
  });
  // Shoppable posts can only point at this shop's own catalogue, so the picker
  // offers exactly the rows the owner already created here.
  const linkSources = useQuery({
    queryKey: ['panel', cacheScope, 'post-link-sources', store.id],
    queryFn: async ({ signal }) => {
      const [products, categories] = await Promise.all([
        getJson<LinkProduct[]>(
          `stores/${encodeURIComponent(store.slug)}/products/my`,
          signal,
        ),
        getJson<CategoryList>(
          `stores/${encodeURIComponent(store.slug)}/categories/my`,
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
  // The item behind the post's shoppable pill. Its price is what the post
  // prints, so the sale switch below writes that row.
  const linkedItem =
    !product && linkValue.startsWith('p:')
      ? linkProducts.find((entry) => `p:${entry.id}` === linkValue)
      : undefined;
  // Picking a different item loads its own sale; the effect is keyed on the
  // item and its stored old price so an unrelated re-render never resets it.
  const saleSource = linkedItem
    ? `${linkedItem.id}:${linkedItem.compareAtPriceCents ?? ''}`
    : '';
  const saleHydrated = useRef('');
  useEffect(() => {
    if (saleHydrated.current === saleSource) return;
    saleHydrated.current = saleSource;
    setOnSale(Boolean(linkedItem?.compareAtPriceCents));
    setOldPrice(
      linkedItem?.compareAtPriceCents
        ? decimalPrice(linkedItem.compareAtPriceCents)
        : '',
    );
  }, [saleSource, linkedItem?.compareAtPriceCents]);
  // Other products owned by this account are the source for copied options.
  // One query covers every store, so a shop can reuse a size chart or color
  // list from a sibling shop without retyping it.
  const optionSources = useQuery({
    queryKey: ['panel', cacheScope, 'product-option-sources'],
    queryFn: ({ signal }) =>
      getJson<Page<Content>>('dashboard/products?limit=100', signal),
    enabled: product,
  });
  const sourceProducts = (optionSources.data?.items ?? []).filter(
    (entry) => entry.id !== record?.id && Boolean(entry.options?.length),
  );
  // Search and sharing settings are stored beside the content and can only be
  // read once the record exists, so a new draft loads them after its first save.
  const seoQuery = useQuery({
    queryKey: ['panel', cacheScope, 'content-seo', kind, record?.id],
    queryFn: ({ signal }) =>
      getJson<ContentSeo | null>(
        `seo/${product ? 'products' : 'showcases'}/${record!.id}`,
        signal,
      ),
    enabled: Boolean(record),
    retry: 0,
  });
  useEffect(() => {
    if (seoHydrated.current || !seoQuery.isSuccess) return;
    // Never replace text the owner typed while the stored settings were still
    // loading; the editor is usable before the request finishes.
    if (JSON.stringify(seo) !== JSON.stringify(emptySeo)) return;
    seoHydrated.current = true;
    const next = seoDraftFrom(seoQuery.data);
    setSeo(next);
    setSeoBaseline(JSON.stringify(next));
  }, [seoQuery.isSuccess, seoQuery.data, seo]);
  // A post may go live while the worker is still encoding its media; the API
  // holds it out of public listings until the first processed variant exists,
  // so publishing never has to wait for a long video encode.
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
  // Categories belong to the shop, so only its owner creates them; a team
  // member still picks from the list the owner maintains.
  async function addCategory() {
    const value = newCategory.trim();
    if (!value || categoryBusy) return;
    setCategoryBusy(true);
    setCategoryError('');
    try {
      const created = await mutate<Category>(
        `stores/${encodeURIComponent(store.slug)}/categories`,
        { name: value },
      );
      setNewCategory('');
      setCategoryFormOpen(false);
      setCategoryId(created.id);
      await client.invalidateQueries({ queryKey: ['categories', store.slug] });
      await categoryList.refetch();
      setNotice(`“${created.name}” was added and selected.`);
    } catch (e) {
      setCategoryError(panelError(e));
    } finally {
      setCategoryBusy(false);
    }
  }
  function onClose() {
    if (busy || uploading) return;
    if (
      (!dirty && !processing) ||
      window.confirm('Discard your unsaved changes?')
    )
      close();
  }
  // Photos and videos need a row to belong to. Picking a file creates the
  // private draft with whatever has been typed so far, so the owner never has
  // to save first and start over.
  const readyForMedia =
    Boolean(name.trim()) && (!product || priceInput(price) !== null);

  async function createDraft(): Promise<Content> {
    const cleanName = name.trim();
    const cents = product ? priceInput(price) : null;
    if (!cleanName || (product && cents === null))
      throw new Error('draft-required-fields');
    const saved = await mutate<Content>(
      product ? `stores/${encodeURIComponent(store.slug)}/products` : 'posts',
      {
        ...(product
          ? {
              name: cleanName,
              priceCents: cents,
              currency,
              categoryId: categoryId || null,
              requiresShipping: shipping,
            }
          : {
              title: cleanName,
              storeId: store.id,
              linkedProductId: linkValue.startsWith('p:')
                ? linkValue.slice(2)
                : null,
              linkedCategoryId: linkValue.startsWith('c:')
                ? linkValue.slice(2)
                : null,
            }),
        description: description.trim() || null,
        status: 'draft',
      },
    );
    setRecord(saved);
    recordRef.current = saved;
    setNotice(
      product
        ? 'Draft item saved. Add your photos, then publish when you are ready.'
        : 'Draft saved. Add your photos or videos, then publish when you are ready.',
    );
    await client.invalidateQueries({ queryKey: ['panel', cacheScope, kind] });
    await client.invalidateQueries({
      queryKey: ['panel', cacheScope, 'summary'],
    });
    return saved;
  }

  function ensureDraftId(): string | Promise<string> {
    if (recordRef.current) return recordRef.current.id;
    // One file at a time, so a second pick reuses the pending draft instead of
    // creating a duplicate row.
    const pending = creating.current ?? createDraft();
    creating.current = pending;
    return pending
      .then((saved) => saved.id)
      .finally(() => {
        if (creating.current === pending) creating.current = null;
      });
  }

  // Attach a freshly uploaded photo to its product immediately: closing the
  // editor before pressing save must not leave the file bound to no item.
  function changeMedia(next: string[]) {
    const added = next.length > keys.length;
    setKeys(next);
    const current = recordRef.current;
    if (!product || !added || !current) return;
    void mutate(
      `stores/${encodeURIComponent(store.slug)}/products/${encodeURIComponent(current.slug)}`,
      { imageKeys: next },
    ).catch(() =>
      setError(
        'The photo uploaded, but attaching it to this item failed. Save again to finish.',
      ),
    );
  }

  async function save(status: string) {
    // A product's photo keys only exist after processing, so that flow still
    // waits. A post attaches media by row on the server and may publish while
    // the worker encodes it in the background.
    if (busy || uploading || (product && processing)) return;
    const awaitingMedia = !product && (processing || Boolean(existingPending));
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
    // Inventory fields are optional, but anything typed must be a whole number
    // the API will accept; blank clears the stored value.
    const stockQuantity = wholeNumber(stock, 4294967295);
    if (product && stockQuantity === undefined) {
      setError('Available stock must be a whole number, or left blank.');
      return;
    }
    const weightGrams = wholeNumber(weight, 4294967295);
    if (product && weightGrams === undefined) {
      setError('Weight must be a whole number of grams, or left blank.');
      return;
    }
    const sortOrderValue = wholeNumber(sortOrder, 4294967295);
    if (product && sortOrderValue === undefined) {
      setError('Sort order must be a whole number, or left blank.');
      return;
    }
    const parsedTags = tagList(tags);
    if (product && parsedTags === undefined) {
      setError(
        'Use up to 20 tags, each under 100 characters, separated by commas.',
      );
      return;
    }
    // The sale is one optional old price. For a post it belongs to the linked
    // item, which is the row whose price the post and the shop both print.
    const saleTargetPrice = product
      ? cents
      : linkedItem && linkedItem.priceCents
        ? Number(linkedItem.priceCents)
        : null;
    const compareAtCents =
      onSale && saleTargetPrice !== null ? priceInput(oldPrice) : null;
    if (onSale && saleTargetPrice !== null) {
      const saleProblem =
        compareAtCents === null
          ? 'Use the old price, such as 20.00, to show the discount.'
          : compareAtCents <= saleTargetPrice
            ? 'The old price must be higher than the price shoppers pay.'
            : '';
      if (saleProblem) {
        // The price field sits in the item form only, so a post reports the
        // same refusal in the form's own error area.
        if (product) setPriceError(saleProblem);
        else setError(saleProblem);
        return;
      }
    }
    const nextSeo = cleanSeo(seo);
    const nextSeoSnapshot = JSON.stringify(nextSeo);
    const seoChanged = nextSeoSnapshot !== seoBaseline;
    if (seoChanged && !product && tagList(nextSeo.articleTags) === undefined) {
      setError(
        'Use up to 20 article tags, each under 100 characters, separated by commas.',
      );
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
        ? `stores/${encodeURIComponent(store.slug)}/products`
        : 'posts';
      // The API derives a unique, readable address from the name for a new
      // product and leaves an existing product's address untouched.
      const body = {
        ...(product
          ? {
              name: cleanName,
              priceCents: cents,
              compareAtPriceCents: compareAtCents,
              currency,
              categoryId: categoryId || null,
              stockQuantity,
              sku: sku.trim() || null,
              weightGrams,
              tags: parsedTags,
              sortOrder: sortOrderValue ?? 0,
              requiresShipping: shipping,
              ...(shouldSaveOptions ? { options: validated.groups } : {}),
              ...(record ? { imageKeys: keys } : {}),
            }
          : {
              title: cleanName,
              ...(!record ? { storeId: store.id } : {}),
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
      // A product owns its sale, so the saved row reports it. A post only links
      // the item: the sale is written to that row after the post itself saved,
      // and a refusal there must not look like a successful save.
      let storedCompareAt: string | null = product
        ? (saved.compareAtPriceCents ?? null)
        : (linkedItem?.compareAtPriceCents ?? null);
      if (!product && linkedItem) {
        const saleChanged =
          compareAtCents === null
            ? Boolean(linkedItem.compareAtPriceCents)
            : String(compareAtCents) !== linkedItem.compareAtPriceCents;
        if (saleChanged) {
          try {
            await mutate(
              `stores/${encodeURIComponent(store.slug)}/products/${encodeURIComponent(linkedItem.slug)}`,
              { compareAtPriceCents: compareAtCents },
              'PATCH',
            );
            storedCompareAt =
              compareAtCents === null ? null : String(compareAtCents);
          } catch (saleError) {
            setRecord(saved);
            setError(
              `The post was saved, but the sale was not. ${panelError(saleError)}`,
            );
            return;
          }
        }
      }
      const nextOldPrice = storedCompareAt ? decimalPrice(storedCompareAt) : '';
      setOnSale(Boolean(storedCompareAt));
      setOldPrice(nextOldPrice);
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
          sku,
          weight,
          tags,
          sortOrder,
          shipping,
          description: cleanDescription,
          keys,
          options: nextOptions,
          link: savedLink,
          sale: `${storedCompareAt ? '1' : '0'}:${nextOldPrice}`,
        }),
      );
      // Search settings are a separate row; save them with the same action so
      // the owner never has to remember a second save just to update the link
      // preview or the search result text.
      let seoFailed = false;
      if (seoChanged) {
        try {
          await mutate(
            `seo/${product ? 'products' : 'showcases'}/${saved.id}`,
            seoWrite(nextSeo, product),
            'PUT',
          );
          setSeo(nextSeo);
          setSeoBaseline(nextSeoSnapshot);
        } catch (e) {
          seoFailed = true;
          setError(
            `The ${product ? 'item' : 'post'} was saved, but its search and sharing settings were not. ${panelError(e)}`,
          );
        }
      }
      await client.invalidateQueries({
        queryKey: ['panel', cacheScope, kind],
      });
      await client.invalidateQueries({
        queryKey: ['panel', cacheScope, 'summary'],
      });
      await client.invalidateQueries({
        queryKey: ['panel', cacheScope, 'product-option-sources'],
      });
      // The shop, the item page and every post card print this price, so a
      // saved sale must not wait for a cache entry to expire.
      if (product || linkedItem) {
        await client.invalidateQueries({
          queryKey: ['panel', cacheScope, 'post-link-sources', store.id],
        });
        await Promise.all(
          [
            ['storefront'],
            ['storefront-product'],
            ['storefront-menu'],
            ['storefront-category-products'],
            ['storefront-posts'],
            ['explore'],
          ].map((queryKey) => client.invalidateQueries({ queryKey })),
        );
      }
      if (seoFailed) return;
      done(
        status === 'draft'
          ? 'Draft saved.'
          : status === 'archived'
            ? 'Item archived.'
            : status === 'out_of_stock'
              ? 'Saved. Shoppers now see this item as out of stock.'
              : awaitingMedia
                ? 'Your post is live. Its media will appear as soon as processing finishes.'
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
    );
  }
  // One switch and one amount: the owner decides a price is a sale price, the
  // shopfront prints the difference everywhere the price already appears.
  const saleEditor = (
    <fieldset className="panel-settings-fieldset">
      <legend>
        Sale <span>Optional</span>
      </legend>
      <label className="panel-toggle">
        <input
          type="checkbox"
          checked={onSale}
          onChange={(e) => {
            setOnSale(e.target.checked);
            setPriceError('');
            setError('');
          }}
        />
        On sale
        <small>
          {product
            ? 'Shoppers see the old price crossed out and a discount badge.'
            : 'Saved on the linked item, so this post and your shop show the same sale.'}
        </small>
      </label>
      {onSale && (
        <label>
          Old price
          <input
            inputMode="decimal"
            maxLength={18}
            value={oldPrice}
            onChange={(e) => {
              setOldPrice(e.target.value);
              setPriceError('');
              setError('');
            }}
            placeholder="20.00"
          />
          <small>
            What it cost before. It must be higher than the price shoppers pay.
          </small>
        </label>
      )}
    </fieldset>
  );
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
              /stores/{store.slug}/p/
              <strong>{addressPreview || 'item-name'}</strong>
            </code>
            <small>
              {record
                ? 'The address stays the same when you rename the item, so shared links keep working.'
                : 'Created automatically from the item name. No setup needed.'}
            </small>
          </div>
        )}
        <label>
          {product ? 'Description' : 'Caption'}
          <textarea
            maxLength={3000}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              product
                ? 'What makes this item special?'
                : 'Say something about this moment…'
            }
          />
        </label>
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
            {saleEditor}
            <label>
              Category
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">No category</option>
                {(categoryList.data?.items ?? []).map((category) => (
                  <option
                    className="notranslate"
                    key={category.id}
                    value={category.id}
                  >
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
            <div className="panel-category-create">
              {categoryFormOpen ? (
                <div className="panel-toolbar">
                  <input
                    autoFocus
                    maxLength={100}
                    value={newCategory}
                    onChange={(e) => {
                      setNewCategory(e.target.value);
                      setCategoryError('');
                    }}
                    onKeyDown={(e) => {
                      // The editor is one big form: Enter must add the section
                      // instead of submitting the item.
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void addCategory();
                      }
                    }}
                    placeholder="New category name"
                    aria-label="New category name"
                  />
                  <button
                    type="button"
                    className="panel-primary"
                    disabled={categoryBusy || !newCategory.trim()}
                    onClick={() => void addCategory()}
                  >
                    {categoryBusy ? 'Adding…' : 'Add'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryFormOpen(false);
                      setNewCategory('');
                      setCategoryError('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                store.teamRole !== 'member' && (
                  <button
                    type="button"
                    onClick={() => setCategoryFormOpen(true)}
                  >
                    <Plus size={15} /> New category
                  </button>
                )
              )}
              {categoryError && (
                <p className="panel-field-error" role="alert">
                  {categoryError}
                </p>
              )}
            </div>
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
            <fieldset className="panel-settings-fieldset">
              <legend>
                Inventory &amp; shipping <span>Optional</span>
              </legend>
              <p className="panel-muted">
                Stock, SKU and weight help you track what you sell. Tags and
                sort order shape how this item appears in your shop.
              </p>
              <div className="panel-two-fields">
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
                <label>
                  SKU
                  <input
                    maxLength={100}
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="e.g. MUG-001"
                  />
                  <small>Your own code for this item.</small>
                </label>
              </div>
              <div className="panel-two-fields">
                <label>
                  Weight (grams)
                  <input
                    type="number"
                    min={0}
                    max={4294967295}
                    step={1}
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder="Used for shipping"
                  />
                </label>
                <label>
                  Sort order
                  <input
                    type="number"
                    min={0}
                    max={4294967295}
                    step={1}
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value)}
                  />
                  <small>Lower numbers appear first in your shop.</small>
                </label>
              </div>
              <label>
                Tags
                <input
                  maxLength={2100}
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. handmade, ceramic, gift"
                />
                <small>
                  Separate tags with commas. Up to 20 tags help shoppers find
                  this item.
                </small>
              </label>
              <label className="panel-toggle">
                <input
                  type="checkbox"
                  checked={shipping}
                  onChange={(e) => setShipping(e.target.checked)}
                />
                This item needs shipping
                <small>
                  Turn off for pickups, digital goods, or dishes served at your
                  place.
                </small>
              </label>
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
        {!product && linkedItem && saleEditor}
        {record ? (
          <details className="panel-optional">
            <summary>
              Search &amp; sharing <span>Optional</span>
            </summary>
            <p className="panel-muted">
              Leave a field blank to use the text {settings.siteName} writes
              from this {product ? 'item' : 'post'}.
            </p>
            <label>
              Page title
              <input
                maxLength={120}
                value={seo.metaTitle}
                onChange={(e) =>
                  setSeo((current) => ({
                    ...current,
                    metaTitle: e.target.value,
                  }))
                }
                placeholder={name || (product ? 'Item name' : 'Post title')}
              />
              <small>
                The title search results and browsers show. Up to 120
                characters.
              </small>
            </label>
            <label>
              Search description
              <textarea
                rows={3}
                maxLength={320}
                value={seo.metaDescription}
                onChange={(e) =>
                  setSeo((current) => ({
                    ...current,
                    metaDescription: e.target.value,
                  }))
                }
                placeholder="A short sentence that makes people want to open it."
              />
            </label>
            <label>
              Keywords
              <input
                maxLength={500}
                value={seo.metaKeywords}
                onChange={(e) =>
                  setSeo((current) => ({
                    ...current,
                    metaKeywords: e.target.value,
                  }))
                }
                placeholder="e.g. handmade mug, ceramic gift"
              />
            </label>
            <div className="panel-two-fields">
              <label>
                Social title
                <input
                  maxLength={120}
                  value={seo.ogTitle}
                  onChange={(e) =>
                    setSeo((current) => ({
                      ...current,
                      ogTitle: e.target.value,
                    }))
                  }
                  placeholder={name || 'Shown when shared'}
                />
              </label>
              <label>
                Social description
                <input
                  maxLength={320}
                  value={seo.ogDescription}
                  onChange={(e) =>
                    setSeo((current) => ({
                      ...current,
                      ogDescription: e.target.value,
                    }))
                  }
                  placeholder="Shown when shared"
                />
              </label>
            </div>
            {product ? (
              <div className="panel-field-grid">
                <label>
                  Brand
                  <input
                    maxLength={100}
                    value={seo.brand}
                    onChange={(e) =>
                      setSeo((current) => ({
                        ...current,
                        brand: e.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  GTIN / barcode
                  <input
                    maxLength={100}
                    value={seo.gtin}
                    onChange={(e) =>
                      setSeo((current) => ({
                        ...current,
                        gtin: e.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  MPN
                  <input
                    maxLength={100}
                    value={seo.mpn}
                    onChange={(e) =>
                      setSeo((current) => ({
                        ...current,
                        mpn: e.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            ) : (
              <>
                <div className="panel-two-fields">
                  <label>
                    Article author
                    <input
                      maxLength={100}
                      value={seo.articleAuthor}
                      onChange={(e) =>
                        setSeo((current) => ({
                          ...current,
                          articleAuthor: e.target.value,
                        }))
                      }
                      placeholder="e.g. your shop name"
                    />
                  </label>
                  <label>
                    Article section
                    <input
                      maxLength={100}
                      value={seo.articleSection}
                      onChange={(e) =>
                        setSeo((current) => ({
                          ...current,
                          articleSection: e.target.value,
                        }))
                      }
                      placeholder="e.g. New arrivals"
                    />
                  </label>
                </div>
                <label>
                  Article tags
                  <input
                    maxLength={2100}
                    value={seo.articleTags}
                    onChange={(e) =>
                      setSeo((current) => ({
                        ...current,
                        articleTags: e.target.value,
                      }))
                    }
                    placeholder="e.g. summer, behind the scenes"
                  />
                  <small>Separate tags with commas.</small>
                </label>
              </>
            )}
            <label className="panel-toggle">
              <input
                type="checkbox"
                checked={seo.hidden}
                onChange={(e) =>
                  setSeo((current) => ({
                    ...current,
                    hidden: e.target.checked,
                  }))
                }
              />
              Hide from search engines
              <small>
                Visitors with the link still see this page; search results stop
                listing it.
              </small>
            </label>
            {seoQuery.isError && (
              <p className="panel-field-error">
                The saved search settings could not be read. Saving replaces
                them with the values above.
              </p>
            )}
          </details>
        ) : (
          <p className="panel-muted">
            Save this {product ? 'item' : 'post'} once to add search and sharing
            settings.
          </p>
        )}
        {!product && record && (
          <>
            {media.isPending ? (
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
                      <video key={asset.id} controls src={storeMediaUrl(key)} />
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
            )}
          </>
        )}
        {/* Media hangs off a saved row, so the first picked file creates the
            private draft instead of asking the owner to save first. */}
        <MediaUpload
          targetId={record ? record.id : ensureDraftId}
          purpose={product ? 'product_image' : 'post'}
          label={product ? 'Product photos' : 'Photos & videos'}
          keys={keys}
          onChange={changeMedia}
          onBusy={setUploading}
          onPending={setProcessing}
          disabled={busy || uploading || processing || !readyForMedia}
          allowVideo={!product}
          maxImageBytes={maxImageBytes}
          maxVideoBytes={maxVideoBytes}
        />
        {!readyForMedia && (
          <p className="panel-muted">
            {product
              ? 'Add a name and a valid price, then choose photos. They upload right away.'
              : 'Add a title, then choose photos or videos. They upload right away.'}
          </p>
        )}
        {!product && (processing || existingPending) && (
          <p className="panel-muted" role="status">
            Media is still processing. You can publish now; it will appear
            automatically when it is ready.
          </p>
        )}
        {existingFailed && (
          <Notice error>
            A media upload failed. You can add a supported replacement; failed
            uploads are not shown publicly.
          </Notice>
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
              (product && processing) ||
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
