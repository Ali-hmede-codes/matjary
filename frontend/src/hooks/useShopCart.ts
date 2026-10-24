import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Product, Store } from '../lib/api';
import { demoProducts } from '../lib/demo';
import {
  cartApi,
  cartErrorMessage,
  checkoutUrl,
  demoCartKey,
  emptyCart,
  productCartLimit,
  restoreDemoCart,
  serializeDemoCart,
  updateDemoCart,
  type CartCheckout,
  type CartItem,
  type CheckoutDetails,
  type ShopCart,
} from '../lib/cart';

export function useShopCart(store: Store | undefined, demo: boolean) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const unsavedPreview = useRef<ShopCart | undefined>(undefined);
  const [message, setMessage] = useState('');
  const [checkout, setCheckout] = useState<CartCheckout>();
  const queryKey = ['shop-cart', demo ? 'demo' : 'live', store?.slug];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      if (!store) throw new Error('Shop unavailable');
      if (!demo) return cartApi.get(store.slug, signal);
      if (unsavedPreview.current?.storeId === store.id)
        return unsavedPreview.current;
      let raw: string | null = null;
      try {
        raw = window.localStorage.getItem(demoCartKey(store.slug));
      } catch {
        return client.getQueryData<ShopCart>(queryKey) ?? emptyCart(store);
      }
      return restoreDemoCart(store, demoProducts, raw);
    },
    enabled: Boolean(store) && !busy,
    retry: false,
    staleTime: demo ? Infinity : 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: !demo,
  });
  const cart = query.data;
  // Wait for the first GET to establish the HttpOnly anonymous cart cookie.
  const disabled = busy || query.isFetching || query.isError || !cart;

  async function change(
    operation: (current: ShopCart) => Promise<ShopCart>,
    action: 'update' | 'checkout' = 'update',
  ) {
    if (!store || !cart || disabled || lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      // A stale read must not overwrite the result of a cart mutation.
      await client.cancelQueries({ queryKey });
      const updated = await operation(cart);
      client.setQueryData(queryKey, updated);
      if (demo) {
        try {
          window.localStorage.setItem(
            demoCartKey(store.slug),
            serializeDemoCart(updated),
          );
          unsavedPreview.current = undefined;
        } catch {
          unsavedPreview.current = updated;
          setMessage(
            'Your demo cart is available for this visit, but this browser couldn’t save it.',
          );
        }
      }
    } catch (error) {
      setMessage(cartErrorMessage(error, action));
      // Reconcile an uncertain write, but never automatically replay it.
      if (!demo) await query.refetch();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function add(product: Product) {
    setOpen(true);
    setCheckout(undefined);
    const quantity =
      (cart?.items.find((item) => item.productId === product.id)?.quantity ??
        0) + 1;
    if (!store || product.storeId !== store.id) return;
    if (quantity > productCartLimit(product)) {
      setMessage('You’ve reached the available quantity for this item.');
      return;
    }
    // The existing server cart has one currency. Never silently relabel a price.
    if (cart && product.currency !== cart.currency) {
      setMessage(
        'This item’s currency is not supported by this shop’s cart. Please contact the shop to order it.',
      );
      return;
    }
    void change(async (current) =>
      demo
        ? updateDemoCart(current, product, quantity)
        : cartApi.add(store.slug, product.id),
    );
  }

  function update(item: CartItem, quantity: number) {
    if (!store || !Number.isInteger(quantity) || quantity < 0) return;
    const product = demoProducts.find((entry) => entry.id === item.productId);
    if (quantity > productCartLimit(demo ? product : undefined)) return;
    void change(async (current) => {
      if (demo) {
        if (!product) return current;
        return updateDemoCart(current, product, quantity);
      }
      if (quantity > 0) return cartApi.update(store.slug, item.id, quantity);
      await cartApi.remove(store.slug, item.id);
      return cartApi.get(store.slug);
    });
  }

  function clear() {
    if (!store) return;
    void change(async () => {
      if (demo) return emptyCart(store);
      await cartApi.clear(store.slug);
      return cartApi.get(store.slug);
    });
  }

  function prepareCheckout(details: CheckoutDetails) {
    if (!store || demo || !cart?.items.length) return;
    void change(async (current) => {
      const result = await cartApi.checkout(store.slug, details);
      const url = checkoutUrl(result.whatsappUrl);
      // Keep the message even if a shop has configured an invalid phone number.
      setCheckout({ ...result, whatsappUrl: url ?? '' });
      return { ...current, items: [], itemCount: 0, subtotalCents: '0' };
    }, 'checkout');
  }

  return {
    open,
    setOpen,
    cart,
    busy,
    disabled,
    loading: query.isFetching,
    failed: query.isError,
    error: query.isError ? cartErrorMessage(query.error, 'load') : message,
    checkout,
    add,
    update,
    clear,
    prepareCheckout,
    retry: () => {
      if (lock.current) return;
      setMessage('');
      void query.refetch();
    },
  };
}

export type ShopCartController = ReturnType<typeof useShopCart>;
