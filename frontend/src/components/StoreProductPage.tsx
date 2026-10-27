import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Share2 } from 'lucide-react';
import {
  ApiError,
  assetUrl,
  getJson,
  type Product,
  type Store,
  type StoreCategoryList,
} from '../lib/api';
import { demoProducts, demoStores } from '../lib/demo';
import {
  categorySlug,
  categoryIndexGroups,
  decimalPrice,
  formatProductPrice,
  menuCategoryGroups,
  productCategoryKey,
  productFromPriceCents,
  productOptionSelection,
  storeCategoryPath,
  storeMediaUrl,
  storePath,
  storePresentation,
  storeProductPath,
} from '../lib/storefront';
import { productCartLimit } from '../lib/cart';
import { useShopCart } from '../hooks/useShopCart';
import { usePageSeo } from '../hooks/usePageSeo';
import { useShare } from '../hooks/useShare';
import { useWebsiteSettings } from '../hooks/useWebsiteSettings';
import { AddToCart, ShopImage } from './StoreCatalog';
import {
  StoreDetailLoading,
  StoreDetailMissing,
  StoreDetailShell,
  absoluteMediaUrl,
} from './StoreDetail';

function absoluteMedia(value: string | null | undefined): string | undefined {
  return absoluteMediaUrl(value);
}

export function StoreProductPage({
  shopSlug,
  productSlug,
  demo,
}: {
  shopSlug: string;
  productSlug: string;
  demo: boolean;
}) {
  const { settings } = useWebsiteSettings(false, !demo);
  const [imageIndex, setImageIndex] = useState(0);
  const [chosenOptions, setChosenOptions] = useState<Record<string, string>>(
    {},
  );
  const storeQuery = useQuery({
    queryKey: ['storefront', shopSlug],
    queryFn: ({ signal }) =>
      getJson<Store>(`stores/${encodeURIComponent(shopSlug)}`, signal),
    enabled: !demo,
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 404) && count < 1,
  });
  const notFound =
    !demo &&
    storeQuery.error instanceof ApiError &&
    storeQuery.error.status === 404;
  const store = notFound
    ? undefined
    : demo
      ? demoStores.find((item) => item.slug === shopSlug)
      : storeQuery.data;
  const cart = useShopCart(store, demo);
  const productQuery = useQuery({
    queryKey: ['storefront-product', shopSlug, productSlug],
    queryFn: ({ signal }) =>
      getJson<Product>(
        `stores/${encodeURIComponent(shopSlug)}/products/${encodeURIComponent(productSlug)}`,
        signal,
      ),
    enabled: Boolean(store) && !demo,
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 404) && count < 1,
  });
  const categoriesQuery = useQuery({
    queryKey: ['storefront-categories', shopSlug],
    queryFn: ({ signal }) =>
      getJson<StoreCategoryList>(
        `stores/${encodeURIComponent(shopSlug)}/categories`,
        signal,
      ),
    enabled: Boolean(store) && !demo,
    staleTime: 5 * 60_000,
  });
  const demoItem = demo
    ? demoProducts.find(
        (item) => item.storeId === store?.id && item.slug === productSlug,
      )
    : undefined;
  const fetchedProduct = demo ? demoItem : productQuery.data;
  // The product endpoint is slug-global; a shop URL must never render an item
  // that belongs to a different shop.
  const product =
    fetchedProduct && (!store || fetchedProduct.storeId === store.id)
      ? fetchedProduct
      : undefined;
  const groups = demo
    ? menuCategoryGroups(
        demoProducts.filter((item) => item.storeId === store?.id),
      )
    : categoryIndexGroups(
        categoriesQuery.data?.items ?? [],
        categoriesQuery.data?.uncategorized ?? 0,
      );
  const group = product
    ? groups.find(
        (entry) =>
          entry.key ===
          (demo
            ? productCategoryKey(product)
            : (product.categoryId ?? 'uncategorized')),
      )
    : undefined;
  const categoryHref = group
    ? storeCategoryPath(shopSlug, categorySlug(group.name), demo)
    : undefined;
  const share = useShare();
  const images = product?.imageKeys?.filter(Boolean) ?? [];
  const heroImage = images[imageIndex] ?? images[0];
  const shareUrl = `${window.location.origin}${storeProductPath(shopSlug, productSlug, demo)}`;
  const price = product ? decimalPrice(productFromPriceCents(product)) : '';

  usePageSeo(
    store && product
      ? {
          title: `${product.name} — ${store.name} — ${settings.siteName}`,
          description:
            product.description?.trim() ||
            `Order ${product.name} from ${store.name}.`,
          image:
            absoluteMedia(images[0] || store.logoKey) ??
            assetUrl(settings.logoUrl),
          canonical: storeProductPath(shopSlug, productSlug, demo),
          type: 'product',
          siteName: settings.siteName,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: product.name,
            description: product.description ?? undefined,
            image: images
              .map((key) => absoluteMedia(key))
              .filter((url): url is string => Boolean(url)),
            sku: product.slug,
            offers: {
              '@type': 'Offer',
              url: shareUrl,
              priceCurrency: product.currency,
              ...(price ? { price } : {}),
              availability:
                productCartLimit(product) > 0
                  ? 'https://schema.org/InStock'
                  : 'https://schema.org/OutOfStock',
              seller: { '@type': 'Organization', name: store.name },
            },
          },
        }
      : null,
  );

  if (storeQuery.isPending && !demo && !notFound)
    return <StoreDetailLoading label="Opening the shop…" />;
  if (!store)
    return (
      <StoreDetailMissing
        title="This shop couldn’t be found."
        description="Check the address, or discover another independent shop."
        home="/"
        homeLabel="Back to discoveries"
      />
    );
  if (!product && productQuery.isPending && !demo)
    return <StoreDetailLoading label="Loading the item…" />;
  if (!product)
    return (
      <StoreDetailMissing
        title="This item isn’t available."
        description="It may have been sold, hidden, or removed by the shop."
        home={storePath(shopSlug, demo)}
        homeLabel={`Back to ${store.name}`}
      />
    );

  const presentation = storePresentation(store);
  const limit = productCartLimit(product);
  const optionGroups = product.options ?? [];
  const selectedOptions = optionGroups.length
    ? productOptionSelection(product, chosenOptions)
    : null;
  // Update the headline price as soon as a value with its own price is picked,
  // even before every group is complete.
  const chosenPriceCents = optionGroups.reduce<string | null>(
    (found, group) => {
      if (found) return found;
      const value = group.values.find(
        (entry) => entry.label === chosenOptions[group.name],
      );
      return value?.priceCents && /^\d+$/u.test(value.priceCents)
        ? value.priceCents
        : null;
    },
    null,
  );
  const displayPriceCents = chosenPriceCents ?? product.priceCents;
  return (
    <StoreDetailShell
      store={store}
      demo={demo}
      cart={cart}
      products={[product]}
      notice={share.notice}
    >
      <nav className="shop-crumbs" aria-label="Breadcrumb">
        <a href={storePath(shopSlug, demo)}>{store.name}</a>
        {group && categoryHref && (
          <>
            <span aria-hidden="true">/</span>
            <a href={categoryHref}>{group.name}</a>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span aria-current="page">{product.name}</span>
      </nav>
      <article className="shop-product-detail">
        <div className="shop-product-gallery">
          <div className="shop-product-main-image">
            <ShopImage
              value={heroImage}
              alt={product.name}
              eager
              fallbackName={store.name}
            />
          </div>
          {images.length > 1 && (
            <div
              className="shop-product-thumbs"
              role="group"
              aria-label="Product photos"
            >
              {images.map((key, index) => {
                const src = assetUrl(storeMediaUrl(key));
                const selected = index === imageIndex;
                return (
                  <button
                    key={key}
                    type="button"
                    className={selected ? 'is-active' : undefined}
                    aria-label={`Show photo ${index + 1} of ${images.length}`}
                    aria-pressed={selected}
                    onClick={() => setImageIndex(index)}
                  >
                    {src && <img src={src} alt="" loading="lazy" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="shop-product-info">
          <p className="shop-detail-eyebrow">
            {group?.name ??
              (presentation.restaurant ? 'Menu item' : 'Shop item')}
          </p>
          <h1>{product.name}</h1>
          <p className="shop-product-detail-price">
            {formatProductPrice(displayPriceCents, product.currency)}
          </p>
          {product.description && (
            <p className="shop-product-detail-description">
              {product.description}
            </p>
          )}
          {optionGroups.length > 0 && (
            <div className="shop-product-options">
              {optionGroups.map((group) => (
                <fieldset
                  className="shop-product-option-group"
                  key={group.name}
                >
                  <legend>
                    {group.name}
                    <span>Required</span>
                  </legend>
                  <div className="shop-product-option-values">
                    {group.values.map((value) => {
                      const selected =
                        chosenOptions[group.name] === value.label;
                      return (
                        <button
                          key={value.label}
                          type="button"
                          className={selected ? 'is-selected' : undefined}
                          aria-pressed={selected}
                          onClick={() =>
                            setChosenOptions((current) => ({
                              ...current,
                              [group.name]: value.label,
                            }))
                          }
                        >
                          <span>{value.label}</span>
                          {value.priceCents && value.priceCents !== '0' && (
                            <small>
                              {formatProductPrice(
                                value.priceCents,
                                product.currency,
                              )}
                            </small>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
              {!selectedOptions && (
                <p className="shop-product-option-hint">
                  Choose one value in each option to add this item.
                </p>
              )}
            </div>
          )}
          {limit === 0 ? (
            <p className="shop-product-stock is-sold-out">
              Out of stock right now. Ask the shop when it returns.
            </p>
          ) : product.stockQuantity !== null ? (
            <p className="shop-product-stock">
              {product.stockQuantity}{' '}
              {product.stockQuantity === 1 ? 'item' : 'items'} available
            </p>
          ) : null}
          <div className="shop-product-actions">
            <AddToCart
              product={product}
              cart={cart}
              selectedOptions={selectedOptions}
            />
            <button
              type="button"
              className="secondary-button"
              disabled={share.sharing}
              onClick={() =>
                void share.share({
                  title: `${product.name} — ${store.name}`,
                  text: product.description ?? product.name,
                  url: shareUrl,
                })
              }
            >
              <Share2 size={17} aria-hidden="true" />
              Share
            </button>
          </div>
          {group && categoryHref && (
            <a className="shop-product-category-link" href={categoryHref}>
              {presentation.restaurant ? 'More from' : 'See more in'}{' '}
              <strong>{group.name}</strong>
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          )}
        </div>
      </article>
    </StoreDetailShell>
  );
}
