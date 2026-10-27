import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { LayoutGrid, Share2, ShoppingBag, Utensils } from 'lucide-react';
import {
  ApiError,
  assetUrl,
  getJson,
  type ProductList,
  type Store,
  type StoreCategoryList,
} from '../lib/api';
import { demoProducts, demoStores } from '../lib/demo';
import { resolveCategoryLayout } from '../lib/design.ts';
import {
  categorySlug,
  catalogLayout,
  menuCategoryGroups,
  categoryIndexGroups,
  productCategoryKey,
  storeCategoryPath,
  storeMediaUrl,
  storeMenuPath,
  storePath,
  storePresentation,
} from '../lib/storefront';
import { useShopCart } from '../hooks/useShopCart';
import { usePageSeo } from '../hooks/usePageSeo';
import { useShare } from '../hooks/useShare';
import { useWebsiteSettings } from '../hooks/useWebsiteSettings';
import { CatalogItems, CatalogLoading } from './StoreCatalog';
import {
  StoreDetailLoading,
  StoreDetailMissing,
  StoreDetailShell,
} from './StoreDetail';
import { StatusBanner } from './Feedback';

export function StoreCategoryPage({
  shopSlug,
  categorySlug: categoryParam,
  demo,
}: {
  shopSlug: string;
  categorySlug: string;
  demo: boolean;
}) {
  const { settings } = useWebsiteSettings(false, !demo);
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
  const groups = demo
    ? menuCategoryGroups(
        demoProducts.filter((item) => item.storeId === store?.id),
      )
    : categoryIndexGroups(
        categoriesQuery.data?.items ?? [],
        categoriesQuery.data?.uncategorized ?? 0,
      );
  const categoryPosition = groups.findIndex(
    (group) => categorySlug(group.name) === categoryParam,
  );
  const group = categoryPosition >= 0 ? groups[categoryPosition] : undefined;
  const productsQuery = useInfiniteQuery({
    queryKey: ['storefront-category-products', shopSlug, group?.key ?? ''],
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({
        limit: '24',
        offset: String(pageParam),
      });
      if (group) params.set('categoryId', group.key);
      return getJson<ProductList>(
        `stores/${encodeURIComponent(shopSlug)}/products?${params}`,
        signal,
      );
    },
    getNextPageParam: (page, _pages, offset) =>
      page.items.length && offset + page.items.length < page.total
        ? offset + page.items.length
        : undefined,
    enabled: Boolean(store) && Boolean(group) && !demo,
  });
  const demoItems = demo
    ? demoProducts.filter(
        (item) =>
          item.storeId === store?.id && productCategoryKey(item) === group?.key,
      )
    : [];
  const items = demo
    ? demoItems
    : (productsQuery.data?.pages.flatMap((page) => page.items) ?? []);
  const share = useShare();

  usePageSeo(
    store && group
      ? {
          title: `${group.name} — ${store.name} — ${settings.siteName}`,
          description: `Explore ${group.count} ${group.count === 1 ? 'item' : 'items'} in ${group.name} at ${store.name}.`,
          image:
            assetUrl(storeMediaUrl(store.bannerKey || store.logoKey)) ??
            assetUrl(settings.logoUrl),
          canonical: storeCategoryPath(shopSlug, categoryParam, demo),
          siteName: settings.siteName,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              {
                '@type': 'ListItem',
                position: 1,
                name: store.name,
                item: `${window.location.origin}${storePath(shopSlug, demo)}`,
              },
              {
                '@type': 'ListItem',
                position: 2,
                name: group.name,
                item: `${window.location.origin}${storeCategoryPath(shopSlug, categoryParam, demo)}`,
              },
            ],
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
  if (!group && !demo && categoriesQuery.isPending)
    return <StoreDetailLoading label="Opening the category…" />;
  if (!group && !demo && categoriesQuery.isError)
    return (
      <StoreDetailMissing
        title="This section couldn’t load."
        description="Please try again in a moment."
        home={storePath(shopSlug, demo)}
        homeLabel={`Back to ${store.name}`}
      />
    );
  if (!group)
    return (
      <StoreDetailMissing
        title="This category isn’t available."
        description="It may have been renamed or removed by the shop owner."
        home={storePath(shopSlug, demo)}
        homeLabel={`Back to ${store.name}`}
      />
    );

  const presentation = storePresentation(store);
  // The section page honours the same design and rhythm as the shop page.
  const layout = presentation.design
    ? resolveCategoryLayout(presentation.design, categoryPosition, group.key)
    : catalogLayout(categoryPosition);
  const shareUrl = `${window.location.origin}${storeCategoryPath(shopSlug, categoryParam, demo)}`;
  return (
    <StoreDetailShell
      store={store}
      demo={demo}
      cart={cart}
      products={items}
      notice={share.notice}
    >
      <nav className="shop-crumbs" aria-label="Breadcrumb">
        <a href={storePath(shopSlug, demo)}>{store.name}</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{group.name}</span>
      </nav>
      <header className="shop-detail-hero">
        <div className="shop-detail-hero-copy">
          <p className="shop-detail-eyebrow">
            {presentation.restaurant ? (
              <Utensils size={13} aria-hidden="true" />
            ) : (
              <ShoppingBag size={13} aria-hidden="true" />
            )}
            {presentation.restaurant ? 'Menu section' : 'Collection'}{' '}
            {categoryPosition + 1} of {groups.length}
          </p>
          <div className="shop-detail-title-row">
            <h1>{group.name}</h1>
            <span className="shop-count-pill">
              {group.count} {group.count === 1 ? 'item' : 'items'}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="shop-detail-share shop-glass"
          aria-label={`Share ${group.name}`}
          title="Share this section"
          disabled={share.sharing}
          onClick={() =>
            void share.share({
              title: `${group.name} — ${store.name}`,
              text: `${group.name} at ${store.name}`,
              url: shareUrl,
            })
          }
        >
          <Share2 size={19} aria-hidden="true" />
        </button>
      </header>
      <nav className="shop-category-switcher" aria-label="Shop categories">
        <a className="shop-switcher-all" href={storeMenuPath(shopSlug, demo)}>
          <LayoutGrid size={15} aria-hidden="true" />
          All items
        </a>
        {groups.map((entry) => {
          const active = entry.key === group.key;
          return (
            <a
              key={entry.key}
              href={storeCategoryPath(shopSlug, categorySlug(entry.name), demo)}
              aria-current={active ? 'page' : undefined}
              className={active ? 'is-active' : undefined}
            >
              {entry.name}
              <span>{entry.count}</span>
            </a>
          );
        })}
      </nav>
      {!demo && productsQuery.isError && (
        <StatusBanner
          action="Try again"
          onAction={() => void productsQuery.refetch()}
        >
          This section couldn’t load. Please try again.
        </StatusBanner>
      )}
      {!demo && productsQuery.isPending ? (
        <CatalogLoading layout={layout} />
      ) : items.length ? (
        <CatalogItems
          products={items}
          cart={cart}
          layout={layout}
          shopSlug={shopSlug}
          demo={demo}
          showImages={presentation.design?.showProductImages}
          showDescriptions={presentation.design?.showProductDescriptions}
        />
      ) : (
        <div className="shop-inline-state">
          <h2>Nothing here yet.</h2>
          <p>The shop hasn’t added items to this section.</p>
          <a className="secondary-button" href={storePath(shopSlug, demo)}>
            Back to {store.name}
          </a>
        </div>
      )}
      {!demo && productsQuery.hasNextPage && (
        <div className="shop-pagination">
          <p>
            Showing {items.length} of {group.count} items in this section.
          </p>
          <button
            className="secondary-button"
            disabled={productsQuery.isFetching}
            onClick={() => void productsQuery.fetchNextPage()}
          >
            {productsQuery.isFetchingNextPage ? 'Loading…' : 'Load more items'}
          </button>
        </div>
      )}
    </StoreDetailShell>
  );
}
