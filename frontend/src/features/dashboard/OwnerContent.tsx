import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ImagePlus, Package, Plus, Trash2 } from 'lucide-react';
import { assetUrl, deleteStory, type Store } from '../../lib/api';
import { storyTimeLabel } from '../../lib/stories';
import { useMyStories } from '../../hooks/useStories';
import { StoryComposer } from '../../components/stories/StoryComposer';
import { getJson, mutate, panelError, type Page } from '../shared/panel-api';
import {
  Empty,
  Loading,
  Modal,
  Notice,
  PageTitle,
  Pagination,
  Retry,
} from '../shared/PanelUI';
import {
  formatProductPrice,
  productPriceLabel,
  productStatusLabel,
  storeMediaUrl,
} from '../../lib/storefront';
import {
  ContentEditor,
  type Category,
  type CategoryList,
  type Content,
} from '../shared/ContentEditor';
import { useOwner } from './OwnerPanel';

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
  const { store, session, summary } = useOwner();
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
  // Categories are account-level sections; the shop team reads them while
  // authoring products but does not rename or delete them.
  const member = store?.teamRole === 'member';
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
          allowance.{' '}
          {member ? (
            'Ask the shop owner to turn it back on.'
          ) : (
            <>
              <Link to="/dashboard/settings">Turn it back on</Link>.
            </>
          )}
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
        {product && !member && (
          <button type="button" onClick={() => setCategoriesOpen(true)}>
            Manage categories
          </button>
        )}
        {!member && <Link to="/dashboard/plan">View my plan limits</Link>}
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
                          {item.compareAtPriceCents && (
                            <s className="price-was">
                              {formatProductPrice(
                                item.compareAtPriceCents,
                                item.currency || 'USD',
                              )}
                            </s>
                          )}
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
          store={store!}
          cacheScope={session.user.id}
          limits={summary.limits}
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
