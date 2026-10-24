import { createContext, useContext, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import {
  ArrowUpRight,
  BadgeCheck,
  ImagePlus,
  Package,
  Palette,
  Plus,
  Store as StoreIcon,
} from 'lucide-react';
import type { Store } from '../../lib/api';
import { storeMediaUrl, isStoreVerified } from '../../lib/storefront';
import { getJson, dateLabel, type Session } from '../shared/panel-api';
import {
  Empty,
  Loading,
  PageTitle,
  PanelShell,
  Retry,
} from '../shared/PanelUI';
import { StoreEditor } from './StoreEditor.tsx';
import { OwnerContent } from './OwnerContent.tsx';

export interface OwnerStore extends Store {
  enableCart: boolean;
  enableWhatsAppCheckout: boolean;
}
export interface OwnerSummary {
  stats: Record<string, number>;
  limits: Record<string, number | string | boolean | null>;
  subscription: {
    planName: string;
    expiresAt: string | null;
    status: string;
  } | null;
}
interface OwnerState {
  session: Session;
  stores: OwnerStore[];
  store?: OwnerStore;
  summary: OwnerSummary;
  savedStore: (store: OwnerStore) => Promise<void>;
}
const OwnerContext = createContext<OwnerState | null>(null);
export function useOwner() {
  const value = useContext(OwnerContext);
  if (!value) throw new Error('Owner workspace unavailable');
  return value;
}
export default function OwnerPanel({ session }: { session: Session }) {
  const [selected, setSelected] = useState('');
  const client = useQueryClient();
  const stores = useQuery({
    queryKey: ['panel', session.user.id, 'my-stores'],
    queryFn: ({ signal }) => getJson<OwnerStore[]>('stores/my', signal),
  });
  const summary = useQuery({
    queryKey: ['panel', session.user.id, 'summary'],
    queryFn: ({ signal }) => getJson<OwnerSummary>('dashboard', signal),
  });
  const store = stores.data?.find((s) => s.id === selected) ?? stores.data?.[0];
  async function savedStore(updated: OwnerStore) {
    client.setQueryData<OwnerStore[]>(
      ['panel', session.user.id, 'my-stores'],
      (old) => [...(old ?? []).filter((s) => s.id !== updated.id), updated],
    );
    setSelected(updated.id);
    await client.invalidateQueries({
      queryKey: ['panel', session.user.id, 'summary'],
    });
    await client.invalidateQueries({ queryKey: ['stores'] });
  }
  return (
    <PanelShell session={session}>
      {stores.isPending || summary.isPending ? (
        <Loading />
      ) : stores.isError || summary.isError ? (
        <Retry
          error={stores.error || summary.error}
          retry={() => {
            void stores.refetch();
            void summary.refetch();
          }}
        />
      ) : (
        <OwnerContext.Provider
          value={{
            session,
            stores: stores.data,
            store,
            summary: summary.data,
            savedStore,
          }}
        >
          {stores.data.length > 1 && (
            <label className="panel-store-switch">
              Your store
              <select
                value={store?.id}
                onChange={(e) => {
                  if (window.confirm('Switch stores? Save any changes first.'))
                    setSelected(e.target.value);
                }}
              >
                {stores.data.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Routes>
            <Route index element={<OwnerHome />} />
            <Route path="store/new" element={<StoreEditor key="new" />} />
            <Route
              path="store"
              element={
                store ? (
                  <StoreEditor key={store.id} store={store} />
                ) : (
                  <NoStore />
                )
              }
            />
            <Route
              path="products"
              element={
                store ? (
                  <OwnerContent key={`products-${store.id}`} kind="products" />
                ) : (
                  <NoStore />
                )
              }
            />
            <Route
              path="posts"
              element={
                store ? (
                  <OwnerContent key={`posts-${store.id}`} kind="posts" />
                ) : (
                  <NoStore />
                )
              }
            />
            <Route path="plan" element={<OwnerPlan />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </OwnerContext.Provider>
      )}
    </PanelShell>
  );
}
function NoStore() {
  return (
    <>
      <PageTitle
        title="Let's make it yours."
        description="Your store starts with a name. Everything else can come later."
      />
      <Empty title="A home for your business">
        <p>A shop, a menu, or your next big idea. You're in control.</p>
        <Link className="panel-primary" to="/dashboard/store/new">
          <Plus size={18} /> Create my store
        </Link>
      </Empty>
    </>
  );
}
function OwnerHome() {
  const { store, session, summary } = useOwner();
  if (!store) return <NoStore />;
  return (
    <>
      <PageTitle
        eyebrow="YOUR PERSONAL STUDIO"
        title={`Welcome back, ${session.user.displayName.split(' ')[0] || 'there'}.`}
        description="A little update can make a big difference."
        action={
          <Link className="panel-secondary" to={`/stores/${store.slug}`}>
            View my store <ArrowUpRight size={16} />
          </Link>
        }
      />
      <section className="panel-store-hero">
        <div>
          <span className="panel-pill">YOUR STORE</span>
          <h2>
            {store.name} {isStoreVerified(store) && <BadgeCheck size={25} />}
          </h2>
          <p>
            {store.description ||
              'Your space to share what makes your business special.'}
          </p>
          <Link className="panel-primary" to="/dashboard/store">
            Make it yours <Palette size={17} />
          </Link>
        </div>
        <div
          className="panel-hero-art"
          style={
            {
              '--store-accent': store.brandColor || '#254e40',
            } as React.CSSProperties
          }
        >
          {store.logoKey ? (
            <img src={storeMediaUrl(store.logoKey)} alt={store.name} />
          ) : (
            <StoreIcon size={72} />
          )}
          <span>
            {store.storeType === 'restaurant_menu'
              ? 'Made to savor.'
              : 'Made by you.'}
          </span>
        </div>
      </section>
      <div className="panel-stats">
        {[
          ['Products', 'totalProducts'],
          ['Posts', 'totalPosts'],
          ['Photos & videos', 'totalMedia'],
        ].map(([label, key]) => (
          <div className="panel-stat" key={key}>
            <span>{label}</span>
            <strong>{summary.stats[key!] ?? 0}</strong>
            <small>Across your stores</small>
          </div>
        ))}
      </div>
      <h2 className="panel-section-title">What would you like to do?</h2>
      <div className="panel-quick-actions">
        <Link to="/dashboard/products">
          <Package />
          <strong>Add a product</strong>
          <span>Bring your collection or menu to life.</span>
          <ArrowUpRight />
        </Link>
        <Link to="/dashboard/posts">
          <ImagePlus />
          <strong>Share something new</strong>
          <span>A photo, a moment, a new arrival.</span>
          <ArrowUpRight />
        </Link>
        <Link to="/dashboard/store">
          <Palette />
          <strong>Refresh your look</strong>
          <span>Pick colors and upload your branding.</span>
          <ArrowUpRight />
        </Link>
      </div>
      <p className="panel-muted">
        Growing another business?{' '}
        <Link to="/dashboard/store/new">Create another store</Link>
      </p>
    </>
  );
}
function OwnerPlan() {
  const { summary, store } = useOwner();
  const limits = [
    ['Products', 'maxProducts', 'totalProducts'],
    ['Total posts', 'maxTotalPosts', 'totalPosts'],
  ] as const;
  return (
    <>
      <PageTitle
        title="Your plan, at a glance."
        description="Simple limits. No surprises."
      />
      <div className="panel-two-columns">
        <section className="panel-card panel-feature">
          <span className="panel-pill">CURRENT PLAN</span>
          <h2>{summary.subscription?.planName || 'Free'}</h2>
          <p>
            {summary.subscription
              ? `Expires ${dateLabel(summary.subscription.expiresAt)}`
              : 'A great place to start your business.'}
          </p>
          {limits.map(([label, limit, used]) => (
            <div className="panel-usage" key={limit}>
              <span>{label}</span>
              <strong>
                {summary.stats[used] ?? 0} /{' '}
                {summary.limits[limit] == null
                  ? 'Unlimited'
                  : String(summary.limits[limit])}
              </strong>
            </div>
          ))}
          <Link className="panel-primary" to="/pricing">
            Explore plans <ArrowUpRight size={16} />
          </Link>
          <small>
            Subscriptions are assigned by an administrator. There is no
            automatic payment or checkout.
          </small>
        </section>
        <section className="panel-card panel-feature">
          <BadgeCheck size={32} />
          <h2>
            {isStoreVerified(store)
              ? 'Your store is verified.'
              : 'Build a trusted presence.'}
          </h2>
          <p>
            {isStoreVerified(store)
              ? 'Your verification badge is visible on your storefront.'
              : 'Verification is reviewed and granted by an administrator. A subscription alone does not verify your store.'}
          </p>
          <div className="panel-usage">
            <span>Shopping cart</span>
            <strong>
              {summary.limits.enableCart ? 'Included' : 'Not included'}
            </strong>
          </div>
          <div className="panel-usage">
            <span>WhatsApp checkout</span>
            <strong>
              {summary.limits.enableWhatsAppCheckout
                ? 'Included'
                : 'Not included'}
            </strong>
          </div>
        </section>
      </div>
    </>
  );
}
