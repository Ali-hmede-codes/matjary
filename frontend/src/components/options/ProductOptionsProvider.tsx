import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Product } from '../../lib/api';
import type { ShopCartController } from '../../hooks/useShopCart';
import { ProductOptionsDialog } from '../ProductOptionsDialog';
import { ProductOptionsContext } from './context';

/**
 * Owns the single option sheet for one storefront route. Every card shares it,
 * so opening a product never loads a page or another request, and the last
 * chosen combination is remembered for a fast repeat add.
 */
export function ProductOptionsProvider({
  cart,
  products,
  shopSlug,
  lbpRate,
  menuMode = false,
  initialSlug,
  onClose,
  children,
}: {
  cart: ShopCartController;
  products: readonly Product[];
  shopSlug?: string;
  lbpRate?: number | null;
  menuMode?: boolean;
  initialSlug?: string | null;
  onClose?: () => void;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<Product | null>(null);
  const lastChoices = useRef(new Map<string, Record<string, string>>());
  const openedSlug = useRef<string | null>(null);
  const openedFromSlug = useRef(false);

  const open = useCallback((product: Product) => setSelected(product), []);
  const close = useCallback(() => {
    setSelected(null);
    onClose?.();
  }, [onClose]);

  // A shared menu item arrives as ?item=<slug>; open its sheet as soon as the
  // catalogue containing it has loaded. The same effect follows a second item
  // link without a reload, and closes a deep-linked sheet when Back clears it.
  useEffect(() => {
    if (!initialSlug) {
      openedSlug.current = null;
      if (openedFromSlug.current) {
        openedFromSlug.current = false;
        setSelected(null);
      }
      return;
    }
    if (openedSlug.current === initialSlug) return;
    const product = products.find((entry) => entry.slug === initialSlug);
    if (!product) return;
    openedSlug.current = initialSlug;
    openedFromSlug.current = true;
    setSelected(product);
  }, [initialSlug, products]);

  const value = useMemo(
    () => ({ open, quickView: menuMode, shopSlug }),
    [open, menuMode, shopSlug],
  );

  return (
    <ProductOptionsContext.Provider value={value}>
      {children}
      {selected && (
        <ProductOptionsDialog
          key={selected.id}
          product={selected}
          cart={cart}
          shopSlug={shopSlug}
          lbpRate={lbpRate}
          menuMode={menuMode}
          rememberedChoices={lastChoices.current.get(selected.id)}
          onAdded={(choices) => {
            lastChoices.current.set(selected.id, choices);
            close();
          }}
          onClose={close}
        />
      )}
    </ProductOptionsContext.Provider>
  );
}
