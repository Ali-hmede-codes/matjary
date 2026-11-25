import { useId, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { StoreDesign } from '../lib/design.ts';
import {
  categorySlug,
  storeCategoryPath,
  type MenuCategoryGroup,
} from '../lib/storefront';
import { useUiLabel } from '../hooks/useUiLabel';

/** Split a category name into the two-tone lines used by the reference cards. */
function splitTitle(name: string): [string, string] | null {
  const words = name.trim().split(/\s+/u);
  if (words.length < 2) return null;
  const firstLine = Math.ceil(words.length / 2);
  return [
    words.slice(0, firstLine).join(' '),
    words.slice(firstLine).join(' '),
  ];
}

function initialOf(name: string): string {
  return (name.trim()[0] ?? '•').toUpperCase();
}

function CategoryCard({
  group,
  design,
  shopSlug,
}: {
  group: MenuCategoryGroup;
  design: StoreDesign;
  shopSlug: string;
}) {
  const label = useUiLabel();
  const imageSrc = (design.showCategoryImages && group.imageUrl?.trim()) || '';
  // Remember which URL failed instead of a boolean: updating the link must get
  // one fresh attempt without remounting the whole card.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(imageSrc) && failedUrl !== imageSrc;
  const lines = design.splitCategoryTitle ? splitTitle(group.name) : null;
  const countLabel = `${group.count} ${group.count === 1 ? 'item' : 'items'}`;
  return (
    <a
      className={`shop-category-card is-${design.categoryIndexStyle}${showImage ? '' : ' is-empty'}`}
      href={storeCategoryPath(shopSlug, categorySlug(group.name))}
      aria-label={`${group.name} — ${countLabel}`}
    >
      <span className="shop-category-media" aria-hidden="true">
        {showImage && (
          <img
            src={imageSrc}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailedUrl(imageSrc)}
          />
        )}
        <span className="shop-category-initial">{initialOf(group.name)}</span>
      </span>
      <span className="shop-category-copy">
        <span
          className={`shop-category-title${lines ? ' is-split' : ''}`}
          dir="auto"
        >
          {lines ? (
            <>
              <span>{lines[0]}</span>
              <span>{lines[1]}</span>
            </>
          ) : (
            <span>{group.name}</span>
          )}
        </span>
        {design.showCategoryAction && (
          <span className="shop-category-action">
            <span className="shop-category-arrow" aria-hidden="true">
              <ArrowUpRight size={12} strokeWidth={2.5} />
            </span>
            <span className="notranslate">{label('Learn more')}</span>
          </span>
        )}
      </span>
    </a>
  );
}

/**
 * The owner's category directory. The card style comes from the design studio;
 * each card carries the category name, the owner's image link and the same
 * "learn more" affordance as the reference boards. Categories without an image
 * keep a typographic fallback, so an old shop never renders an empty box.
 */
export function CategoryShowcase({
  categories,
  design,
  shopSlug,
}: {
  categories: MenuCategoryGroup[];
  design: StoreDesign;
  shopSlug: string;
}) {
  // `chips` is the classic storefront, which keeps its own filter row.
  const headingId = useId();
  if (design.categoryIndexStyle === 'chips' || !categories.length) return null;
  return (
    <section
      className="shop-categories"
      data-style={design.categoryIndexStyle}
      aria-labelledby={headingId}
    >
      <h2 id={headingId} className="sr-only">
        Shop categories
      </h2>
      <div className="shop-category-grid">
        {categories.map((group) => (
          <CategoryCard
            key={group.key}
            group={group}
            design={design}
            shopSlug={shopSlug}
          />
        ))}
      </div>
    </section>
  );
}
