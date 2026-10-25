import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Store as StoreIcon } from 'lucide-react';
import {
  isCurrentStore,
  storeLifecycleActions,
  storeStatusLabel,
  type StoreLifecycleAction,
} from '../../lib/storefront';
import { mutate, panelError } from '../shared/panel-api';
import { Empty, Modal, Notice, PageTitle } from '../shared/PanelUI';
import { useOwner, type OwnerStore } from './OwnerPanel';

const actionLabels: Record<StoreLifecycleAction, string> = {
  active: 'Turn on',
  offline: 'Turn off',
  archived: 'Archive',
  trashed: 'Move to Trash',
  restore: 'Restore',
  delete: 'Delete permanently',
};
const actionDescriptions: Record<StoreLifecycleAction, string> = {
  active:
    'Your store and its published content will become available to visitors. Administrator restrictions still apply.',
  offline:
    'Your store, products, posts, and images will be hidden from visitors. You can keep editing and turn it on again anytime.',
  archived:
    'Your store, products, posts, and images will be hidden from visitors. The store moves to Archived and remains editable.',
  trashed:
    'Your store, products, posts, and images will be hidden and kept safely in Trash. Editing and uploads stop until you restore it. Nothing is deleted until you choose Delete permanently in Trash.',
  restore:
    'Your store and its content will be restored with the store turned off. Turn it on separately when you are ready for visitors.',
  delete:
    'This permanently deletes the store, its products, posts, and images. This cannot be undone.',
};

export function StoreLifecycleControls({
  store,
  disabled = false,
  dirty = false,
  onBusyChange,
}: {
  store: OwnerStore;
  disabled?: boolean;
  dirty?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { savedStore, removedStore } = useOwner();
  const [action, setAction] = useState<StoreLifecycleAction>();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const close = () => {
    setAction(undefined);
    setConfirmation('');
  };
  async function confirm() {
    if (!action || disabled || inFlight.current) return;
    if (action === 'delete' && confirmation.trim() !== store.name) return;
    if (dirty && !window.confirm('Continue without saving your changes?'))
      return;
    inFlight.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    setNotice('');
    const path = `stores/${encodeURIComponent(store.slug)}`;
    try {
      if (action === 'delete') {
        await mutate(`${path}/permanent`, {}, 'DELETE');
        close();
        await removedStore(store);
        return;
      }
      let updated: OwnerStore;
      if (action === 'trashed') {
        await mutate(path, {}, 'DELETE');
        updated = {
          ...store,
          status: 'trashed',
          trashedAt: store.trashedAt || new Date().toISOString(),
        };
      } else {
        updated =
          action === 'restore'
            ? await mutate<OwnerStore>(`${path}/restore`)
            : await mutate<OwnerStore>(
                `${path}/status`,
                { status: action },
                'PATCH',
              );
      }
      close();
      await savedStore(updated, true);
      setNotice('Store status updated.');
    } catch (e) {
      setError(panelError(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <div className="store-lifecycle">
      <div
        className="store-lifecycle-actions"
        aria-label={`Actions for ${store.name}`}
      >
        {storeLifecycleActions(store).map((value) => (
          <button
            key={value}
            type="button"
            className={
              value === 'trashed' || value === 'delete'
                ? 'store-trash-action'
                : 'panel-secondary'
            }
            disabled={disabled || busy}
            onClick={() => {
              setError('');
              setConfirmation('');
              setAction(value);
            }}
          >
            {actionLabels[value]}
          </button>
        ))}
      </div>
      {notice && <Notice>{notice}</Notice>}
      {error && !action && <Notice error>{error}</Notice>}
      {action && (
        <Modal
          title={
            action === 'delete'
              ? `Permanently delete ${store.name}?`
              : `${actionLabels[action]} ${store.name}?`
          }
          busy={busy}
          onClose={close}
        >
          <p>{actionDescriptions[action]}</p>
          {action === 'delete' && (
            <label>
              Type “{store.name}” to confirm
              <input
                autoComplete="off"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
          )}
          {store.restricted && action !== 'delete' && (
            <p className="panel-muted">
              The administrator restriction will remain in place.
            </p>
          )}
          {error && <Notice error>{error}</Notice>}
          <div className="store-lifecycle-actions">
            <button
              type="button"
              className="panel-secondary"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </button>
            <button
              type="button"
              className={
                action === 'trashed' || action === 'delete'
                  ? 'panel-primary store-trash-confirm'
                  : 'panel-primary'
              }
              disabled={
                busy ||
                disabled ||
                (action === 'delete' && confirmation.trim() !== store.name)
              }
              onClick={() => void confirm()}
            >
              {busy
                ? action === 'delete'
                  ? 'Deleting…'
                  : 'Updating…'
                : actionLabels[action]}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function StoreManager() {
  const { stores, summary } = useOwner();
  const [params, setParams] = useSearchParams();
  const tab =
    params.get('tab') === 'archived'
      ? 'archived'
      : params.get('tab') === 'trashed'
        ? 'trashed'
        : 'current';
  const matches = (store: OwnerStore, value: string) =>
    value === 'current' ? isCurrentStore(store) : store.status === value;
  const visible = stores.filter((store) => matches(store, tab));
  const usedSlots = stores.filter((store) => store.status !== 'trashed').length;
  const maxShops = summary.limits.maxShops;
  return (
    <>
      <PageTitle
        eyebrow="YOUR BUSINESSES"
        title="My stores"
        description="Keep things current, take a break, or start again. You're in control."
        action={
          <Link className="panel-primary" to="/dashboard/store/new">
            <Plus size={18} /> New store
          </Link>
        }
      />
      <p className="panel-muted">
        {maxShops == null
          ? 'Your plan includes unlimited shops.'
          : `${usedSlots} of ${String(maxShops)} shop slots in use. Trashed shops do not count.`}
      </p>
      <div className="store-manager-tabs" role="group" aria-label="Store lists">
        {(
          [
            ['current', 'Current'],
            ['archived', 'Archived'],
            ['trashed', 'Trash'],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={tab === value}
            onClick={() => setParams(value === 'current' ? {} : { tab: value })}
          >
            {label}{' '}
            <span>
              {stores.filter((store) => matches(store, value)).length}
            </span>
          </button>
        ))}
      </div>
      {tab === 'trashed' && (
        <p className="panel-muted">
          Restore a store to keep it, or delete it permanently to remove it and
          its content from your account. Permanent deletion cannot be undone.
        </p>
      )}
      {!visible.length ? (
        <Empty
          title={
            tab === 'current'
              ? 'No current stores'
              : tab === 'archived'
                ? 'No archived stores'
                : 'Trash is empty'
          }
        >
          <p>
            {tab === 'current'
              ? 'Create a store, or restore one from Archived or Trash.'
              : 'Your stores will appear here when you move them.'}
          </p>
        </Empty>
      ) : (
        <div className="store-manager-grid">
          {visible.map((store) => (
            <article className="store-manager-card" key={store.id}>
              <div className="store-manager-heading">
                <span className="store-manager-icon">
                  <StoreIcon size={24} />
                </span>
                <div>
                  <h2>{store.name}</h2>
                  <p>
                    {store.storeType === 'restaurant_menu'
                      ? 'Restaurant / menu'
                      : 'Shop'}
                  </p>
                </div>
              </div>
              <div className="store-lifecycle-actions">
                <span
                  className={`panel-pill ${store.status === 'active' ? '' : 'muted'}`}
                >
                  {storeStatusLabel[store.status]}
                </span>
                {store.restricted && (
                  <span className="panel-pill muted">
                    Administrator restriction
                  </span>
                )}
              </div>
              {store.status !== 'trashed' && !store.restricted && (
                <Link
                  className="panel-primary"
                  to={`/dashboard/store?store=${encodeURIComponent(store.id)}`}
                >
                  Edit store
                </Link>
              )}
              {store.restricted && (
                <p className="panel-muted">
                  Contact the administrator about this restriction. You can
                  still archive this store or move it to Trash.
                </p>
              )}
              <StoreLifecycleControls store={store} />
            </article>
          ))}
        </div>
      )}
    </>
  );
}
