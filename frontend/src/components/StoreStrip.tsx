import { Compass, Plus } from 'lucide-react';
import { loginUrl, type Post, type Store } from '../lib/api';
import { enableMouseScrolling } from '../lib/website';
import { storePath } from '../lib/storefront';
import { StoreAvatar, StoreVerifiedBadge } from './StoreAvatar';

export function StoreStrip({
  stores,
  selectedStore,
  posts,
  demo,
  onClearStore,
}: {
  stores: Store[];
  selectedStore: Store | null;
  posts: Post[];
  demo: boolean;
  onClearStore: () => void;
}) {
  return (
    <section
      className="store-strip"
      aria-label="Browse store posts"
      ref={enableMouseScrolling}
      tabIndex={0}
    >
      <a className="story your-store" href={loginUrl}>
        <span className="story-ring">
          <Plus size={25} />
        </span>
        <span>Your store</span>
      </a>
      <button
        className={`story all-stores ${!selectedStore ? 'selected' : ''}`}
        aria-pressed={!selectedStore}
        onClick={onClearStore}
      >
        <span className="story-ring">
          <Compass size={25} />
        </span>
        <span>All stores</span>
      </button>
      {stores.map((item) => (
        <a
          className={`story ${selectedStore?.id === item.id ? 'selected' : ''}`}
          key={item.id}
          href={storePath(item.slug, demo)}
        >
          <span className="story-ring">
            <StoreAvatar
              store={item}
              large
              preview={
                posts.find((post) => post.store?.id === item.id)?.media[0]
              }
            />
          </span>
          <span>{item.name}</span>
          <StoreVerifiedBadge store={item} size={22} />
        </a>
      ))}
    </section>
  );
}
