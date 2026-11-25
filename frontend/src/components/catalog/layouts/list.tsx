import { storeProductPath } from '../../../lib/storefront';
import type { CatalogGrid, CatalogGridProps, CatalogItemProps } from '../types';
import {
  AddToCart,
  PriceLabels,
  ProductDescription,
  ProductLink,
  ProductName,
  SaleBadge,
  ShopImage,
  StockBadge,
  isUnavailable,
} from '../primitives';

/** An image-first menu row. Best for dishes with descriptions. */
function ListItem({
  product,
  cart,
  href,
  lbpRate,
  showDescriptions = true,
}: CatalogItemProps) {
  const unavailable = isUnavailable(product);
  return (
    <article
      className={`shop-product shop-menu-item${unavailable ? ' is-unavailable' : ''}`}
    >
      <ProductLink
        product={product}
        href={href}
        className="shop-product-image shop-product-image-link"
        ariaLabel={`Open ${product.name}`}
      >
        <ShopImage value={product.imageKeys?.[0]} alt={product.name} />
        <SaleBadge product={product} />
        <StockBadge product={product} cart={cart} />
      </ProductLink>
      <div className="shop-product-copy">
        <ProductName product={product} href={href} />
        <ProductDescription product={product} visible={showDescriptions} />
        <div className="shop-product-bottom">
          <PriceLabels product={product} lbpRate={lbpRate} />
          <AddToCart product={product} cart={cart} chooseHref={href} />
        </div>
      </div>
    </article>
  );
}

function ListGrid({
  products,
  cart,
  shopSlug,
  lbpRate,
  showDescriptions,
}: CatalogGridProps) {
  return (
    <div className="shop-catalog-items layout-list">
      {products.map((product) => (
        <ListItem
          key={product.id}
          product={product}
          cart={cart}
          href={storeProductPath(shopSlug, product.slug)}
          lbpRate={lbpRate}
          showDescriptions={showDescriptions}
        />
      ))}
    </div>
  );
}

/** Classic rows: a photo, the name, the description and the price. */
export const listGrid: CatalogGrid = {
  key: 'list',
  wire: [
    [2, 3, 8, 8],
    [12, 4, 26, 2],
    [12, 8, 18, 2],
    [2, 15, 8, 8],
    [12, 16, 26, 2],
    [12, 20, 18, 2],
  ],
  skeleton: { shape: 'card', rows: 4, frame: 'layout-list' },
  imageLed: true,
  Grid: ListGrid,
};
