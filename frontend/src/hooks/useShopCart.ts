import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Product, SelectedProductOption, Store } from '../lib/api';
import { productHasOptions } from '../lib/storefront';
import {
  cartApi,
  cartErrorMessage,
  checkoutUrl,
  MAX_CART_QUANTITY,
  productCartLimit,
  type CartCheckout,
  type CartItem,
  type CheckoutDetails,
  type ShopCart,
} from '../lib/cart';

export function useShopCart(store: Store | undefined) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState('');
  const [checkout, setCheckout] = useState<CartCheckout>();
  // Adding to the cart must not steal the page: a short toast confirms the
  // write and the cart stays closed until the shopper asks for it.
  const [flash, setFlash] = useState<{
    tone: 'success' | 'error';
    text: string;
    key: number;
  }>();
  const flashKey = useRef(0);
  const notify = (tone: 'success' | 'error', text: string) => {
    flashKey.current += 1;
    setFlash({ tone, text, key: flashKey.current });
  };
  useEffect(() => {
    if (!flash) return;
    const timeout = window.setTimeout(() => setFlash(undefined), 3600);
    return () => window.clearTimeout(timeout);
  }, [flash]);
  const queryKey = ['shop-cart', store?.slug];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      if (!store) throw new Error('Shop unavailable');
      return cartApi.get(store.slug, signal);
    },
    enabled: Boolean(store) && !busy,
    retry: false,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const cart = query.data;
  // Wait for the first GET to establish the HttpOnly anonymous cart cookie.
  const disabled = busy || query.isFetching || query.isError || !cart;

  async function change(
    operation: (current: ShopCart) => Promise<ShopCart>,
    action: 'update' | 'checkout' = 'update',
  ): Promise<boolean> {
    if (!store || !cart || disabled || lock.current) return false;
    lock.current = true;
    setBusy(true);
    setMessage('');
    let saved = false;
    try {
      // A stale read must not overwrite the result of a cart mutation.
      await client.cancelQueries({ queryKey });
      const updated = await operation(cart);
      client.setQueryData(queryKey, updated);
      saved = true;
    } catch (error) {
      const failure = cartErrorMessage(error, action);
      setMessage(failure);
      notify('error', failure);
      // Reconcile an uncertain write, but never automatically replay it.
      await query.refetch();
    } finally {
      lock.current = false;
      setBusy(false);
    }
    return saved;
  }

  function add(
    product: Product,
    selectedOptions: SelectedProductOption[] | null = null,
  ) {
    setCheckout(undefined);
    if (!store || product.storeId !== store.id) return;
    if (productHasOptions(product) && !selectedOptions?.length) {
      const failure = 'Choose a value for each option before adding this item.';
      setMessage(failure);
      notify('error', failure);
      return;
    }
    const productQuantity =
      cart?.items
        .filter((item) => item.productId === product.id)
        .reduce((sum, item) => sum + item.quantity, 0) ?? 0;
    if (productQuantity + 1 > productCartLimit(product)) {
      setMessage('You’ve reached the available quantity for this item.');
      notify('error', 'You’ve reached the available quantity for this item.');
      return;
    }
    // The existing server cart has one currency. Never silently relabel a price.
    if (cart && product.currency !== cart.currency) {
      const failure =
        'This item’s currency is not supported by this shop’s cart. Please contact the shop to order it.';
      setMessage(failure);
      notify('error', failure);
      return;
    }
    void change(async () =>
      cartApi.add(store.slug, product.id, selectedOptions),
    ).then((ok) => {
      if (ok) notify('success', `${product.name} added to cart`);
    });
  }

  function update(item: CartItem, quantity: number) {
    if (!store || !Number.isInteger(quantity) || quantity < 0) return;
    if (quantity > MAX_CART_QUANTITY) return;
    void change(async () => {
      if (quantity > 0) return cartApi.update(store.slug, item.id, quantity);
      await cartApi.remove(store.slug, item.id);
      return cartApi.get(store.slug);
    });
  }

  function clear() {
    if (!store) return;
    void change(async () => {
      await cartApi.clear(store.slug);
      return cartApi.get(store.slug);
    });
  }

  function prepareCheckout(details: CheckoutDetails) {
    if (!store || !cart?.items.length) return;
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
    flash,
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
