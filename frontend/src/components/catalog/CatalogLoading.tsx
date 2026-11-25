import type { CatalogLayout } from '../../lib/catalog-layouts';
import { catalogGrid } from './registry';

/**
 * The loading placeholder of a section. It mirrors the chosen grid's container
 * class and box shape, so the page does not jump when the products arrive; the
 * shape itself is declared by the grid file.
 */
export function CatalogLoading({ layout }: { layout: CatalogLayout }) {
  const { shape, rows, frame } = catalogGrid(layout).skeleton;
  return (
    <div
      className={`shop-catalog-items ${frame}`}
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading items…</span>
      {Array.from({ length: rows }, (_, index) =>
        shape === 'overlay' ? (
          <div
            className="shop-overlay-card shop-skeleton"
            key={index}
            aria-hidden="true"
          />
        ) : (
          <div
            className={
              shape === 'line'
                ? 'shop-price-row shop-skeleton'
                : 'shop-product shop-skeleton'
            }
            key={index}
            aria-hidden="true"
          >
            {shape !== 'line' && (
              <div className="shop-product-image shop-skeleton" />
            )}
            <div className="shop-product-copy">
              <div className="shop-skeleton shop-skeleton-title" />
              <div className="shop-skeleton shop-skeleton-short" />
            </div>
          </div>
        ),
      )}
    </div>
  );
}
