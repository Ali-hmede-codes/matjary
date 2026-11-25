import { useId, useLayoutEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  LoaderCircle,
  ShoppingCart,
  X,
} from 'lucide-react';
import type { Product, ProductOptionValue } from '../lib/api';
import {
  defaultProductOptionChoices,
  formatProductPrice,
  lbpPriceLabel,
  productCompareAtPriceCents,
  productOptionSelection,
  selectedOptionsKey,
  selectedUnitPriceCents,
  storeProductPath,
} from '../lib/storefront';
import { productCartLimit } from '../lib/cart';
import type { ShopCartController } from '../hooks/useShopCart';
import { ShopImage } from './catalog/primitives';

/** A value with its own amount; zero and missing both mean the base price. */
function ownPrice(value: ProductOptionValue): string | null {
  return value.priceCents &&
    value.priceCents !== '0' &&
    /^\d+$/u.test(value.priceCents)
    ? value.priceCents
    : null;
}

function initialChoices(
  product: Product,
  remembered: Record<string, string> | undefined,
): Record<string, string> {
  // A remembered value may have been renamed or removed since the last add.
  const kept = (product.options ?? []).flatMap((group) => {
    const label = remembered?.[group.name];
    return label && group.values.some((value) => value.label === label)
      ? [[group.name, label]]
      : [];
  });
  return {
    ...defaultProductOptionChoices(product),
    ...Object.fromEntries(kept),
  };
}

/**
 * The in-place option picker. It opens from the card itself, preselects one
 * value per group, and closes after a successful add so a second combination is
 * one tap away. A `<dialog>` gives it the browser's focus trap and Escape
 * handling with no animation delay on open.
 */
export function ProductOptionsDialog({
  product,
  cart,
  shopSlug,
  lbpRate,
  menuMode = false,
  rememberedChoices,
  onAdded,
  onClose,
}: {
  product: Product;
  cart: ShopCartController;
  shopSlug?: string;
  lbpRate?: number | null;
  menuMode?: boolean;
  rememberedChoices?: Record<string, string>;
  onAdded: (choices: Record<string, string>) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    initialChoices(product, rememberedChoices),
  );
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const groups = product.options ?? [];
  const selection = productOptionSelection(product, chosen);
  const unitPriceCents = selectedUnitPriceCents(product.priceCents, selection);
  const unitLbp = lbpPriceLabel(unitPriceCents, product.currency, lbpRate);
  // A chosen value with its own price steps away from the base item's old
  // price; an unpriced value still sells at the base amount and keeps the sale.
  const compareAt =
    unitPriceCents === product.priceCents
      ? productCompareAtPriceCents(product)
      : null;
  const limit = productCartLimit(product);
  const optionKey = selectedOptionsKey(selection);
  const matchingItem = cart.cart?.items.find(
    (item) =>
      item.productId === product.id &&
      selectedOptionsKey(item.selectedOptions) === optionKey,
  );
  const lineQuantity = matchingItem?.quantity ?? 0;
  const productQuantity =
    cart.cart?.items
      .filter((item) => item.productId === product.id)
      .reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const limitReached = limit > 0 && productQuantity >= limit;
  const cartReady = !cart.disabled;
  const canAdd =
    limit > 0 &&
    !limitReached &&
    cartReady &&
    !adding &&
    (!groups.length || Boolean(selection));

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    // Announce the item first; the first Tab reaches the close control, and
    // the focus ring does not jump to an option the shopper did not pick.
    element
      .querySelector<HTMLElement>('[data-options-title]')
      ?.focus({ preventScroll: true });
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  async function add() {
    if (!canAdd) return;
    setAdding(true);
    setError('');
    const added = await cart.add(product, selection);
    if (added) {
      onAdded(chosen);
      return;
    }
    setAdding(false);
    setError('This item could not be added. Please try again.');
  }

  return (
    <dialog
      ref={dialog}
      className="shop-options-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A backdrop tap targets the dialog itself, not its content.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="shop-options-panel">
        <header className="shop-options-head">
          <span className="shop-options-photo">
            <ShopImage
              value={product.imageKeys?.[0]}
              alt={product.name}
              eager
            />
          </span>
          <div className="shop-options-id">
            <p className="shop-options-eyebrow">
              {menuMode
                ? 'From the menu'
                : groups.length
                  ? 'Choose your options'
                  : 'Product'}
            </p>
            <h2
              id={titleId}
              className="notranslate"
              dir="auto"
              tabIndex={-1}
              data-options-title
            >
              {product.name}
            </h2>
            <p className="shop-options-price">
              <strong>
                {formatProductPrice(unitPriceCents, product.currency)}
              </strong>
              {compareAt && (
                <s>{formatProductPrice(compareAt, product.currency)}</s>
              )}
              {unitLbp && <small className="price-lbp">{unitLbp}</small>}
            </p>
          </div>
          <button
            type="button"
            className="shop-options-close"
            aria-label="Close options"
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="shop-options-body">
          {product.description && (
            <p className="shop-options-description notranslate" dir="auto">
              {product.description}
            </p>
          )}
          {groups.map((group) => (
            <fieldset className="shop-options-group" key={group.name}>
              <legend>
                <span className="notranslate">{group.name}</span>
                <span className="shop-options-required">Required</span>
              </legend>
              <div className="shop-options-values">
                {group.values.map((value) => {
                  const selected = chosen[group.name] === value.label;
                  const price = ownPrice(value);
                  return (
                    <button
                      key={value.label}
                      type="button"
                      className={selected ? 'is-selected' : undefined}
                      aria-pressed={selected}
                      onClick={() => {
                        setChosen((current) => ({
                          ...current,
                          [group.name]: value.label,
                        }));
                        setError('');
                      }}
                    >
                      <span className="notranslate">{value.label}</span>
                      {price && (
                        <small>
                          {formatProductPrice(price, product.currency)}
                        </small>
                      )}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
          {limit === 0 && (
            <p className="shop-options-stock" role="status">
              This item is sold out right now. Ask the shop when it returns.
            </p>
          )}
          {!menuMode && shopSlug && (
            <a
              className="shop-options-details"
              href={storeProductPath(shopSlug, product.slug)}
            >
              See full details
              <ChevronRight size={15} aria-hidden="true" />
            </a>
          )}
        </div>
        <footer className="shop-options-foot">
          {(error || cart.error) && (
            <p className="shop-options-error" role="alert">
              {error || cart.error}
            </p>
          )}
          <div className="shop-options-actions">
            <div className="shop-options-summary" aria-live="polite">
              <strong>
                {formatProductPrice(unitPriceCents, product.currency)}
              </strong>
              {unitLbp && <small className="price-lbp">{unitLbp}</small>}
              {productQuantity > 0 && (
                <span className="shop-options-incart">
                  <Check size={12} aria-hidden="true" />
                  {productQuantity} in cart
                </span>
              )}
            </div>
            <button
              type="button"
              className="shop-options-add"
              disabled={!canAdd}
              aria-busy={adding}
              onClick={() => void add()}
            >
              {adding ? (
                <LoaderCircle className="spin" size={17} aria-hidden="true" />
              ) : (
                <ShoppingCart size={17} aria-hidden="true" />
              )}
              {limit === 0
                ? 'Sold out'
                : limitReached
                  ? 'Limit reached'
                  : cart.failed
                    ? 'Cart unavailable'
                    : !cart.cart
                      ? 'Loading cart…'
                      : adding
                        ? 'Adding…'
                        : lineQuantity > 0
                          ? 'Add another'
                          : 'Add to cart'}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
