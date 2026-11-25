import type { CatalogLayout } from '../../lib/catalog-layouts';
import type { Product } from '../../lib/api';
import type { ShopCartController } from '../../hooks/useShopCart';
import { catalogGrid } from './registry';

/**
 * Renders one product section. The grid decides its own container and cards;
 * this dispatcher only resolves the saved key and applies the one shared
 * fallback: without photos, an image-led grid would show empty frames, so the
 * compact price list renders instead (a text-only menu keeps its own style).
 */
export function CatalogItems({
  products,
  cart,
  layout,
  shopSlug,
  lbpRate,
  showImages = true,
  showDescriptions = true,
}: {
  products: Product[];
  cart: ShopCartController;
  layout: CatalogLayout;
  shopSlug: string;
  lbpRate?: number | null;
  showImages?: boolean;
  showDescriptions?: boolean;
}) {
  const chosen = catalogGrid(layout);
  const Grid =
    !showImages && chosen.imageLed ? catalogGrid('compact').Grid : chosen.Grid;
  return (
    <Grid
      products={products}
      cart={cart}
      shopSlug={shopSlug}
      lbpRate={lbpRate}
      showDescriptions={showDescriptions}
    />
  );
}
