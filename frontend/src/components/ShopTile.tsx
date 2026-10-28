import { Heart, MapPin } from 'lucide-react';
import type { StoreDirectoryItem } from '../lib/api';
import { storePath } from '../lib/storefront';
import { StoreAvatar, StoreVerifiedBadge } from './StoreAvatar';

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

function shopLocation(item: StoreDirectoryItem): string | null {
  const city = item.city?.trim();
  const country = item.country?.trim();
  if (city && country && city !== country) return `${city}, ${country}`;
  return city || country || null;
}

/**
 * One compact shop row, shared by the directory and the favorites page so a
 * shop looks the same wherever it is listed. The heart is a sibling of the
 * link, because a button nested inside an anchor is invalid HTML.
 */
export function ShopTile({
  item,
  favorite,
  onToggleFavorite,
}: {
  item: StoreDirectoryItem;
  favorite: boolean;
  onToggleFavorite: (item: StoreDirectoryItem) => void;
}) {
  const location = shopLocation(item);
  const details = [
    item.postsCount > 0 ? plural(item.postsCount, 'post', 'posts') : null,
    item.productsCount > 0 ? plural(item.productsCount, 'item', 'items') : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className={`shop-tile ${favorite ? 'is-favorite' : ''}`}>
      <a className="shop-tile-link" href={storePath(item.slug)}>
        <StoreAvatar store={item} large />
        <span className="shop-tile-body">
          <span className="shop-tile-name">
            <span title={item.name}>{item.name}</span>
            <StoreVerifiedBadge store={item} size={15} />
          </span>
          <span className="shop-tile-category">
            {item.businessCategoryLabel}
          </span>
          <span className="shop-tile-meta">
            {location && (
              <span>
                <MapPin size={11} aria-hidden="true" />
                {location}
              </span>
            )}
            {details.map((detail) => (
              <span key={detail}>{detail}</span>
            ))}
            {!location && !details.length && <span>New shop</span>}
          </span>
        </span>
      </a>
      <button
        type="button"
        className="shop-tile-favorite"
        aria-pressed={favorite}
        aria-label={
          favorite
            ? `Remove ${item.name} from favorite shops`
            : `Add ${item.name} to favorite shops`
        }
        title={favorite ? 'Remove from favorites' : 'Add to favorites'}
        onClick={() => onToggleFavorite(item)}
      >
        <Heart
          size={17}
          fill={favorite ? 'currentColor' : 'none'}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
