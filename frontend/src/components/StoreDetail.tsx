import type { CSSProperties, ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  LoaderCircle,
  Package,
  ShoppingBag,
  ShoppingCart,
} from 'lucide-react';
import { assetUrl, type Product, type Store } from '../lib/api';
import { storeMediaUrl, storePath, storePresentation } from '../lib/storefront';
import type { ShopCartController } from '../hooks/useShopCart';
import { ShopCart } from './ShopCart';
import { ShopCartDock, ShopToast } from './ShopCartDock';
import { StoreAvatar, StoreVerifiedBadge } from './StoreAvatar';

/** Absolute media URL for canonical/OG metadata (relative local keys included). */
export function absoluteMediaUrl(
  value: string | null | undefined,
): string | undefined {
  const url = assetUrl(storeMediaUrl(value));
  if (!url) return undefined;
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return undefined;
  }
}

/**
 * Focused shell for category and product pages: a slim store bar, the cart
 * dialog/dock, and a single content column. The full discovery hero stays on
 * the shop page so these pages load and render faster.
 */
export function StoreDetailShell({
  store,
  demo,
  cart,
  products,
  notice,
  children,
}: {
  store: Store;
  demo: boolean;
  cart: ShopCartController;
  products: Product[];
  notice?: string;
  children: ReactNode;
}) {
  const presentation = storePresentation(store);
  const shopHref = storePath(store.slug, demo);
  const count = cart.cart?.itemCount ?? 0;
  return (
    <div
      className={`app storefront storefront-detail ${presentation.restaurant ? 'storefront-restaurant' : 'storefront-retail'}${count > 0 && !cart.open ? ' has-cart' : ''}${presentation.design ? ` shop-design-${presentation.design.template}` : ''}`}
      style={presentation.theme as CSSProperties}
    >
      <a className="skip-link" href="#shop-detail-main">
        Skip to content
      </a>
      <header className="shop-detail-bar">
        <a
          className="shop-detail-identity"
          href={shopHref}
          aria-label={`Back to ${store.name}`}
          title={`Back to ${store.name}`}
        >
          <span className="shop-detail-back" aria-hidden="true">
            <ArrowLeft size={17} />
          </span>
          <StoreAvatar store={store} />
          <strong>{store.name}</strong>
          <StoreVerifiedBadge store={store} size={16} />
        </a>
        <div
          className="shop-tools"
          role="group"
          aria-label="Shop quick actions"
        >
          <button
            type="button"
            className="shop-glass"
            onClick={() => cart.setOpen(true)}
            aria-label={`Open cart${count ? `, ${count} items` : ''}`}
            aria-haspopup="dialog"
            aria-expanded={cart.open}
            title="Shopping cart"
          >
            <ShoppingCart size={21} aria-hidden="true" />
            {count > 0 && (
              <span className="shop-cart-count" aria-hidden="true">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        </div>
      </header>
      <main id="shop-detail-main" className="shop-detail-main">
        {children}
      </main>
      <footer className="shop-detail-footer">
        <span>
          © {new Date().getFullYear()} {store.name}
        </span>
        <a href={shopHref}>
          Back to shop <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      </footer>
      <ShopCartDock cart={cart} />
      {cart.open && (
        <ShopCart
          store={store}
          products={products}
          controller={cart}
          demo={demo}
          onBrowse={() => {
            cart.setOpen(false);
            window.location.assign(shopHref);
          }}
          onContact={() => {
            cart.setOpen(false);
            window.location.assign(shopHref);
          }}
        />
      )}
      <ShopToast cart={cart} notice={notice} />
    </div>
  );
}

export function StoreDetailLoading({ label }: { label: string }) {
  return (
    <div className="app storefront storefront-detail" aria-busy="true">
      <div className="shop-detail-state" role="status">
        <LoaderCircle className="spin" size={24} aria-hidden="true" />
        <p>{label}</p>
      </div>
    </div>
  );
}

export function StoreDetailMissing({
  title,
  description,
  home,
  homeLabel,
}: {
  title: string;
  description: string;
  home: string;
  homeLabel: string;
}) {
  return (
    <div className="app storefront storefront-detail">
      <div className="shop-detail-state">
        <Package size={34} aria-hidden="true" />
        <h1>{title}</h1>
        <p>{description}</p>
        <a className="secondary-button" href={home}>
          <ShoppingBag size={17} aria-hidden="true" />
          {homeLabel}
        </a>
      </div>
    </div>
  );
}
