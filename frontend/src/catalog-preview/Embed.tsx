import { useEffect, type CSSProperties } from 'react';
import { CatalogItems } from '../components/catalog';
import { catalogLayouts, type CatalogLayout } from '../lib/catalog-layouts';
import { defaultDesign, designTheme } from '../lib/design';
import { previewCart, previewLbpRate, previewProducts } from './mock';

export function isCatalogLayout(value: string | null): value is CatalogLayout {
  return Boolean(
    value && (catalogLayouts as readonly string[]).includes(value),
  );
}

/** One grid alone, at the iframe's own width, with no gallery chrome around it. */
export function Embed({ params }: { params: URLSearchParams }) {
  const requested = params.get('layout');
  const layout: CatalogLayout = isCatalogLayout(requested)
    ? requested
    : 'cards';
  const parsed = Number(params.get('count') ?? 6);
  const count = Number.isFinite(parsed) ? Math.min(12, Math.max(1, parsed)) : 6;
  const products = previewProducts.slice(0, count);
  const cart = previewCart(products, params.get('incart') === '1');
  const theme = designTheme(defaultDesign);
  const frame = params.get('frame');

  useEffect(() => {
    document.body.classList.add('is-embed');
    return () => document.body.classList.remove('is-embed');
  }, []);

  // The gallery cannot know when this grid has painted, so the frame reports its
  // own height. The gallery only needs the frame name it assigned in the URL.
  useEffect(() => {
    if (!frame) return;
    const content = document.querySelector<HTMLElement>(
      '.catalog-preview-embed',
    );
    if (!content) return;
    const report = () =>
      window.parent.postMessage(
        {
          type: 'catalog-preview-height',
          frame,
          height: Math.ceil(content.getBoundingClientRect().height),
        },
        '*',
      );
    report();
    void document.fonts.ready.then(report);
    const observer = new ResizeObserver(report);
    observer.observe(content);
    return () => observer.disconnect();
  }, [frame, layout, count]);

  return (
    <div
      className="app storefront catalog-preview-embed"
      style={theme as CSSProperties}
      dir={params.get('dir') === 'rtl' ? 'rtl' : undefined}
    >
      <main className="shop-main">
        <div className="shop-section">
          <CatalogItems
            products={products}
            cart={cart}
            layout={layout}
            shopSlug="preview-shop"
            lbpRate={previewLbpRate}
            showImages={params.get('images') !== '0'}
            showDescriptions={params.get('descriptions') !== '0'}
          />
        </div>
      </main>
    </div>
  );
}
