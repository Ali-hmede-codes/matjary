import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Share2,
  ShoppingCart,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { formatProductPrice, lbpPriceLabel } from '../lib/storefront';
import type { ShopCartController } from '../hooks/useShopCart';

export function ShopCartDock({
  cart,
  lbpRate,
}: {
  cart: ShopCartController;
  lbpRate?: number | null;
}) {
  const count = cart.cart?.itemCount ?? 0;
  if (count < 1 || cart.open) return null;
  const subtotal = formatProductPrice(
    cart.cart?.subtotalCents ?? '0',
    cart.cart?.currency ?? 'USD',
  );
  const lbpSubtotal = lbpPriceLabel(
    cart.cart?.subtotalCents ?? '0',
    cart.cart?.currency ?? 'USD',
    lbpRate,
  );
  return (
    <div className="shop-cart-dock">
      <button
        type="button"
        className="shop-cart-dock-button"
        onClick={() => cart.setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`View cart, ${count} ${count === 1 ? 'item' : 'items'}, subtotal ${subtotal}`}
      >
        <span className="shop-cart-dock-count" aria-hidden="true">
          <ShoppingCart size={21} />
          <strong>{count > 99 ? '99+' : count}</strong>
        </span>
        <span className="shop-cart-dock-copy">
          <small>
            {count} {count === 1 ? 'item' : 'items'} in cart
          </small>
          <strong>{subtotal}</strong>
          {lbpSubtotal && <small className="price-lbp">{lbpSubtotal}</small>}
        </span>
        <span className="shop-cart-dock-action" aria-hidden="true">
          View cart
          <ArrowUpRight size={15} />
        </span>
      </button>
    </div>
  );
}

/**
 * Cart feedback lives here so every storefront page shows the same short
 * confirmation (or failure) without opening the cart panel.
 */
export function ShopToast({
  cart,
  notice,
  noticeIcon,
}: {
  cart: ShopCartController;
  notice?: string;
  noticeIcon?: ReactNode;
}) {
  const toast = cart.flash
    ? {
        tone: cart.flash.tone,
        text: cart.flash.text,
        key: `cart-${cart.flash.key}`,
      }
    : notice
      ? { tone: 'info' as const, text: notice, key: 'notice' }
      : null;
  if (!toast) return null;
  return (
    <div
      key={toast.key}
      className={`toast shop-notice is-${toast.tone}`}
      role={toast.tone === 'error' ? 'alert' : 'status'}
    >
      {toast.tone === 'success' ? (
        <Check size={16} aria-hidden="true" />
      ) : toast.tone === 'error' ? (
        <AlertCircle size={16} aria-hidden="true" />
      ) : (
        (noticeIcon ?? <Share2 size={16} aria-hidden="true" />)
      )}
      {toast.text}
    </div>
  );
}
