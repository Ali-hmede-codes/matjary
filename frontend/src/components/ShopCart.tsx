import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  LoaderCircle,
  MessageCircle,
  Minus,
  Package,
  Plus,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';
import { assetUrl, type Product, type Store } from '../lib/api';
import { formatProductPrice, storeMediaUrl } from '../lib/storefront';
import { productCartLimit } from '../lib/cart';
import type { ShopCartController } from '../hooks/useShopCart';
import './ShopCart.css';

function CartThumbnail({ product }: { product?: Product }) {
  const src = assetUrl(storeMediaUrl(product?.imageKeys?.[0]));
  const [failed, setFailed] = useState<string>();
  return (
    <span className="shop-cart-image" aria-hidden="true">
      <Package size={24} />
      {src && failed !== src && (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} />
      )}
    </span>
  );
}

export function ShopCart({
  store,
  products,
  controller,
  demo,
  onBrowse,
  onContact,
}: {
  store: Store;
  products: Product[];
  controller: ShopCartController;
  demo: boolean;
  onBrowse: () => void;
  onContact: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { cart, busy, disabled, loading, error, failed, checkout } = controller;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const close = () => controller.setOpen(false);

  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="shop-cart-dialog"
      aria-labelledby="shop-cart-title"
      onCancel={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="shop-cart-panel">
        <header className="shop-cart-header">
          <div className="shop-cart-heading">
            <span className="shop-cart-mark">
              <ShoppingCart size={22} />
            </span>
            <div>
              <h2 id="shop-cart-title">Your cart</h2>
              <p>{store.name}</p>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close cart"
            onClick={close}
            autoFocus
          >
            <X size={22} />
          </button>
        </header>
        <div className="shop-cart-body" aria-busy={busy || loading}>
          {demo && (
            <p className="shop-cart-hint">
              Demo cart · Saved only in this browser. No orders will be sent.
            </p>
          )}
          {(busy || loading) && (
            <p className="shop-cart-progress" role="status">
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
              {busy ? 'Updating your cart…' : 'Loading your cart…'}
            </p>
          )}
          {error && (
            <div className="shop-cart-error" role="alert">
              <p>{error}</p>
              <button
                type="button"
                className="text-button"
                disabled={busy || loading}
                onClick={controller.retry}
              >
                Refresh cart
              </button>
              <button type="button" className="text-button" onClick={onContact}>
                Contact shop
              </button>
            </div>
          )}
          {checkout ? (
            <section
              className="shop-cart-complete"
              aria-labelledby="shop-order-title"
            >
              <span className="shop-cart-mark">
                <Check size={25} />
              </span>
              <h3 id="shop-order-title">Your order message is ready</h3>
              <p>
                Send it to the shop on WhatsApp to confirm availability,
                delivery, and payment. Nothing has been sent yet.
              </p>
              <strong>
                {formatProductPrice(checkout.totalCents, checkout.currency)}
              </strong>
              {checkout.whatsappUrl ? (
                <a
                  className="primary-button"
                  href={checkout.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle size={18} /> Open WhatsApp{' '}
                  <ArrowUpRight size={16} />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : (
                <p>
                  The shop’s WhatsApp link is unavailable. Copy the message
                  below and contact the shop directly.
                </p>
              )}
              <label className="shop-cart-field">
                Order message
                <textarea readOnly value={checkout.message} rows={8} />
              </label>
              <button
                type="button"
                className="secondary-button"
                onClick={onBrowse}
              >
                Continue shopping
              </button>
            </section>
          ) : cart?.items.length ? (
            <>
              <div className="shop-cart-summary">
                <p role="status">
                  {cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'}
                </p>
                <button
                  type="button"
                  className="text-button"
                  disabled={disabled}
                  onClick={() => setConfirmClear(!confirmClear)}
                >
                  <Trash2 size={14} /> Clear cart
                </button>
              </div>
              {confirmClear && (
                <div className="shop-cart-confirm">
                  <p>Remove all items from this cart?</p>
                  <button
                    type="button"
                    className="text-button"
                    disabled={disabled}
                    onClick={() => {
                      controller.clear();
                      setConfirmClear(false);
                    }}
                  >
                    Remove all
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setConfirmClear(false)}
                  >
                    Keep items
                  </button>
                </div>
              )}
              <ul className="shop-cart-items">
                {cart.items.map((item) => {
                  const product = products.find(
                    (entry) => entry.id === item.productId,
                  );
                  return (
                    <li key={item.id} className="shop-cart-item">
                      <CartThumbnail product={product} />
                      <div className="shop-cart-item-copy">
                        <h3>{item.productName}</h3>
                        <p>
                          {formatProductPrice(
                            item.unitPriceCents,
                            cart.currency,
                          )}{' '}
                          each
                        </p>
                        {item.notes && <p>{item.notes}</p>}
                        <div className="shop-cart-item-actions">
                          <div
                            className="shop-cart-quantity"
                            role="group"
                            aria-label={`Quantity for ${item.productName}`}
                          >
                            <button
                              type="button"
                              disabled={disabled}
                              aria-label={
                                item.quantity === 1
                                  ? `Remove ${item.productName}`
                                  : `Decrease quantity of ${item.productName}`
                              }
                              onClick={() =>
                                controller.update(item, item.quantity - 1)
                              }
                            >
                              <Minus size={15} />
                            </button>
                            <output
                              aria-label={`Quantity of ${item.productName}`}
                            >
                              {item.quantity}
                            </output>
                            <button
                              type="button"
                              disabled={
                                disabled ||
                                item.quantity >= productCartLimit(product)
                              }
                              aria-label={`Increase quantity of ${item.productName}`}
                              onClick={() =>
                                controller.update(item, item.quantity + 1)
                              }
                            >
                              <Plus size={15} />
                            </button>
                          </div>
                          <button
                            type="button"
                            className="icon-button"
                            disabled={disabled}
                            aria-label={`Remove ${item.productName} from cart`}
                            onClick={() => controller.update(item, 0)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      <strong className="shop-cart-line-total">
                        {formatProductPrice(item.lineTotalCents, cart.currency)}
                      </strong>
                    </li>
                  );
                })}
              </ul>
              <form
                id="shop-cart-checkout"
                className="shop-cart-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  controller.prepareCheckout({
                    customerName: name.trim(),
                    customerPhone: phone.trim(),
                    customerNotes: notes.trim(),
                  });
                }}
              >
                <h3>
                  Order details <span>(optional)</span>
                </h3>
                <div className="shop-cart-fields">
                  <label className="shop-cart-field">
                    Your name
                    <input
                      autoComplete="name"
                      maxLength={255}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <label className="shop-cart-field">
                    Phone number
                    <input
                      type="tel"
                      autoComplete="tel"
                      maxLength={255}
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                </div>
                <label className="shop-cart-field">
                  Note to the shop
                  <textarea
                    rows={3}
                    maxLength={1000}
                    placeholder={
                      store.storeType === 'restaurant_menu'
                        ? 'Allergies, pickup time, or special requests…'
                        : 'Delivery details or special requests…'
                    }
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    disabled={busy}
                  />
                </label>
              </form>
            </>
          ) : (
            !loading &&
            !busy &&
            !failed && (
              <section className="shop-cart-empty">
                <span className="shop-cart-mark">
                  <ShoppingCart size={30} />
                </span>
                <h3>Your cart is waiting</h3>
                <p>
                  Add something you love from {store.name}. Each shop has its
                  own cart.
                </p>
                <button
                  type="button"
                  className="primary-button"
                  onClick={onBrowse}
                >
                  {store.storeType === 'restaurant_menu'
                    ? 'Explore the menu'
                    : 'Explore products'}
                </button>
              </section>
            )
          )}
        </div>
        {!checkout && cart && cart.items.length > 0 && (
          <footer className="shop-cart-footer">
            <div className="shop-cart-total" aria-live="polite">
              <span>Subtotal</span>
              <strong>
                {formatProductPrice(cart.subtotalCents, cart.currency)}
              </strong>
            </div>
            <p>
              Delivery and any additional charges are confirmed with the shop.
            </p>
            <button
              className="primary-button"
              type="submit"
              form="shop-cart-checkout"
              disabled={disabled || demo || !cart?.storeWhatsApp}
            >
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <MessageCircle size={18} />
              )}
              {demo
                ? 'Checkout unavailable in preview'
                : 'Prepare WhatsApp order'}
            </button>
            {!demo && !cart?.storeWhatsApp && (
              <p>
                This shop hasn’t set up WhatsApp orders yet.{' '}
                <button
                  type="button"
                  className="text-button"
                  onClick={onContact}
                >
                  Contact shop
                </button>
              </p>
            )}
          </footer>
        )}
      </div>
    </dialog>
  );
}
