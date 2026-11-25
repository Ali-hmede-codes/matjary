import { createContext, useContext } from 'react';
import type { Product } from '../../lib/api';

/**
 * The storefront's one option sheet. Cards call `open(product)` instead of
 * navigating, so a shopper chooses a size or colour in place and the page never
 * reloads. `quickView` is on for menu shops: their items have no detail page,
 * so every product link opens the sheet as a compact quick view.
 */
export interface ProductOptionsContextValue {
  open: (product: Product) => void;
  quickView: boolean;
  /** The shop whose menu hosts the sheet; links use ?item= in menu mode. */
  shopSlug?: string;
}

export const ProductOptionsContext =
  createContext<ProductOptionsContextValue | null>(null);

export function useProductOptions(): ProductOptionsContextValue | null {
  return useContext(ProductOptionsContext);
}
