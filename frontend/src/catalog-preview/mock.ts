import type { Product } from '../lib/api';
import type { CartItem, ShopCart } from '../lib/cart';
import type { ShopCartController } from '../hooks/useShopCart';
// Served from public/ on purpose: the storefront accepts only http(s) or
// root-relative media URLs, and Vite inlines a bundled SVG import as a data:
// URI, which the catalog guard rejects.
const photo1 = '/catalog-preview-assets/photo-1.svg';
const photo2 = '/catalog-preview-assets/photo-2.svg';
const photo3 = '/catalog-preview-assets/photo-3.svg';
const photo4 = '/catalog-preview-assets/photo-4.svg';
const photo5 = '/catalog-preview-assets/photo-5.svg';
const photo6 = '/catalog-preview-assets/photo-6.svg';

// The preview never talks to the API: these products exercise every state the
// grids paint ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â plain item, sale, sold out, low stock, options and a long name ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â
// so a layout can be judged against real content instead of one tidy row.
const base = {
  storeId: 'preview-store',
  currency: 'USD',
  category: 'Pantry',
  categoryId: null,
  categoryName: null,
  tags: [] as string[],
  sortOrder: 0,
  requiresShipping: false,
  status: 'active' as const,
};

export const previewProducts: Product[] = [
  {
    ...base,
    id: 'preview-1',
    slug: 'wildflower-honey',
    name: 'Wildflower Honey',
    description: 'Raw wildflower honey from the Bekaa valley, jarred by hand.',
    priceCents: '1850',
    stockQuantity: null,
    imageKeys: [photo1, photo2],
  },
  {
    ...base,
    id: 'preview-2',
    slug: 'sea-salt-soap',
    name: 'Sea Salt Soap',
    description: 'Cold-pressed olive oil soap with a whisper of sea salt.',
    priceCents: '1200',
    compareAtPriceCents: '1600',
    stockQuantity: 24,
    imageKeys: [photo2],
  },
  {
    ...base,
    id: 'preview-3',
    slug: 'linen-apron',
    name: 'Linen Apron',
    description: 'Stonewashed linen with an adjustable neck strap.',
    priceCents: '3200',
    stockQuantity: 0,
    imageKeys: [photo3],
  },
  {
    ...base,
    id: 'preview-4',
    slug: 'cedar-candle',
    name: 'Cedar & Amber Candle',
    description: 'Hand-poured soy wax, a 45-hour burn, in a reusable glass.',
    priceCents: '2400',
    stockQuantity: 4,
    imageKeys: [photo4],
  },
  {
    ...base,
    id: 'preview-5',
    slug: 'olive-oil',
    name: 'Extra Virgin Olive Oil',
    description: 'Single-origin, first cold press, 500 ml.',
    priceCents: '2100',
    stockQuantity: null,
    imageKeys: [photo5],
    options: [
      {
        name: 'Size',
        values: [
          { label: '250 ml', priceCents: null },
          { label: '500 ml', priceCents: '2100' },
          { label: '1 L', priceCents: '3800' },
        ],
      },
    ],
  },
  {
    ...base,
    id: 'preview-6',
    slug: 'ceramic-mug',
    name: 'Hand-thrown Ceramic Mug with a Speckled Glaze',
    description:
      'A one-off stoneware mug; every glaze pulls a little differently.',
    priceCents: '1650',
    stockQuantity: null,
    imageKeys: [photo6],
  },
];

/** The pound hint a Lebanese shop shows under the dollar price. */
export const previewLbpRate = 89_500;

/**
 * A cart stub for the grids: they only read `cart.items` and the busy flags,
 * and the preview has no API to write to. The cast covers the React setters and
 * query callbacks useShopCart returns, which no grid touches.
 */
export function previewCart(
  products: Product[],
  firstInCart: boolean,
): ShopCartController {
  const first = products[0];
  const items: CartItem[] =
    firstInCart && first
      ? [
          {
            id: 'preview-line-1',
            productId: first.id,
            productName: first.name,
            productSlug: first.slug,
            quantity: 1,
            unitPriceCents: first.priceCents,
            lineTotalCents: first.priceCents,
            notes: null,
            selectedOptions: null,
          },
        ]
      : [];
  const cart: ShopCart = {
    id: 'preview-cart',
    storeId: 'preview-store',
    storeSlug: 'preview-shop',
    storeName: 'Preview shop',
    currency: 'USD',
    items,
    subtotalCents: items.length && first ? first.priceCents : '0',
    itemCount: items.length,
  };
  return {
    open: false,
    setOpen: () => undefined,
    cart,
    busy: false,
    disabled: false,
    loading: false,
    failed: false,
    error: '',
    checkout: undefined,
    flash: undefined,
    add: () => undefined,
    update: () => undefined,
    clear: () => undefined,
    prepareCheckout: () => undefined,
    retry: () => undefined,
  } as unknown as ShopCartController;
}
