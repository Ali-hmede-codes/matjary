import './storefront.css';
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
import {
  categorySlug,
  categoryIndexGroups,
  decimalPrice,
  formatProductPrice,
  lbpPriceLabel,
  lbpRateFor,
  productCompareAtPriceCents,
  productDiscountPercent,
  productFromPriceCents,
  productOptionSelection,
  storeCategoryPath,
  storeMediaUrl,
  storePath,
  storePresentation,
  storeProductPath,
} from '../lib/storefront';
import { productCartLimit } from '../lib/cart';
import { brandingUrl } from '../lib/website';
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
}: {
  shopSlug: string;
  productSlug: string;
}) {
  const { settings } = useWebsiteSettings(false, true);
  const [imageIndex, setImageIndex] = useState(0);
  const [chosenOptions, setChosenOptions] = useState<Record<string, string>>(
    {},
  );
  const storeQuery = useQuery({
    queryKey: ['storefront', shopSlug],
    queryFn: ({ signal }) =>
      getJson<Store>(`stores/${encodeURIComponent(shopSlug)}`, signal),
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 404) && count < 1,
  });
  const notFound =
    storeQuery.error instanceof ApiError && storeQuery.error.status === 404;
  const store = notFound ? undefined : storeQuery.data;
  const cart = useShopCart(store);
  const productQuery = useQuery({
    queryKey: ['storefront-product', shopSlug, productSlug],
    queryFn: ({ signal }) =>
      getJson<Product>(
        `stores/${encodeURIComponent(shopSlug)}/products/${encodeURIComponent(productSlug)}`,
        signal,
      ),
    enabled: Boolean(store),
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
    enabled: Boolean(store),
    staleTime: 5 * 60_000,
  });
  // The product endpoint is slug-global; a shop URL must never render an item
  // that belongs to a different shop.
  const product =
    productQuery.data && (!store || productQuery.data.storeId === store.id)
      ? productQuery.data
      : undefined;
  const groups = categoryIndexGroups(
    categoriesQuery.data?.items ?? [],
    categoriesQuery.data?.uncategorized ?? 0,
  );
  const group = product
    ? groups.find(
        (entry) => entry.key === (product.categoryId ?? 'uncategorized'),
      )
    : undefined;
  const categoryHref = group
    ? storeCategoryPath(shopSlug, categorySlug(group.name))
    : undefined;
  const share = useShare();
  const images = product?.imageKeys?.filter(Boolean) ?? [];
  const heroImage = images[imageIndex] ?? images[0];
  const shareUrl = `${window.location.origin}${storeProductPath(shopSlug, productSlug)}`;
  const price = product ? decimalPrice(productFromPriceCents(product)) : '';

  usePageSeo(
    store && product
      ? {
          title: `${product.name} — ${store.name} — ${settings.siteName}`,
          description:
            product.description?.trim() ||
            (store.storeType === 'restaurant_menu'
              ? `Order ${product.name} from the ${store.name} menu.`
              : `Order ${product.name} from ${store.name}.`),
          image:
            absoluteMedia(images[0] || store.logoKey) ??
            brandingUrl(assetUrl(settings.logoUrl)),
          canonical: storeProductPath(shopSlug, productSlug),
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

  if (storeQuery.isPending && !notFound)
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
  if (!product && productQuery.isPending)
    return <StoreDetailLoading label="Loading the item…" />;
  if (!product)
    return (
      <StoreDetailMissing
        title="This item isn’t available."
        description="It may have been sold, hidden, or removed by the shop."
        home={storePath(shopSlug)}
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
  const lbpRate = lbpRateFor(settings.lbpExchangeRate, store);
  const displayPriceLbp = lbpPriceLabel(
    displayPriceCents,
    product.currency,
    lbpRate,
  );
  // A value with its own price replaces the base amount, and the old price
  // belongs to that base item only, so it steps aside for the chosen value.
  const compareAtPriceCents = chosenPriceCents
    ? null
    : productCompareAtPriceCents(product);
  const discountPercent = compareAtPriceCents
    ? productDiscountPercent(product)
    : null;
  return (
    <StoreDetailShell
      store={store}
      cart={cart}
      products={[product]}
      notice={share.notice}
      lbpRate={lbpRate}
    >
      <nav className="shop-crumbs" aria-label="Breadcrumb">
        <a className="notranslate" href={storePath(shopSlug)}>
          {store.name}
        </a>
        {group && categoryHref && (
          <>
            <span aria-hidden="true">/</span>
            <a className="notranslate" href={categoryHref}>
              {group.name}
            </a>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span className="notranslate" aria-current="page">
          {product.name}
        </span>
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
            {group?.name ? (
              <span className="notranslate">{group.name}</span>
            ) : presentation.restaurant ? (
              'Menu item'
            ) : (
              'Shop item'
            )}
          </p>
          <h1 className="notranslate" dir="auto">
            {product.name}
          </h1>
          <p className="shop-product-detail-price">
            {formatProductPrice(displayPriceCents, product.currency)}
            {compareAtPriceCents && (
              <s className="price-was">
                {formatProductPrice(compareAtPriceCents, product.currency)}
              </s>
            )}
            {discountPercent && (
              <span className="shop-detail-sale">{discountPercent}% off</span>
            )}
            {displayPriceLbp && (
              <small className="price-lbp">{displayPriceLbp}</small>
            )}
          </p>
          {product.description && (
            <p
              className="shop-product-detail-description notranslate"
              dir="auto"
            >
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
                    <span className="notranslate">{group.name}</span>
                    <span className="shop-option-required">Required</span>
                  </legend>
                  <div className="shop-product-option-values">
                    {group.values.map((value) => {
                      const selected =
                        chosenOptions[group.name] === value.label;
                      const valueLbp =
                        value.priceCents && value.priceCents !== '0'
                          ? lbpPriceLabel(
                              value.priceCents,
                              product.currency,
                              lbpRate,
                            )
                          : null;
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
                          <span className="notranslate">{value.label}</span>
                          {value.priceCents && value.priceCents !== '0' && (
                            <small>
                              {formatProductPrice(
                                value.priceCents,
                                product.currency,
                              )}
                              {valueLbp && (
                                <span className="price-lbp-inline">
                                  · {valueLbp}
                                </span>
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
                  text:
                    product.description ??
                    (store.storeType === 'restaurant_menu'
                      ? `Order ${product.name} from the ${store.name} menu.`
                      : product.name),
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
              <strong className="notranslate">{group.name}</strong>
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          )}
        </div>
      </article>
    </StoreDetailShell>
  );
}
