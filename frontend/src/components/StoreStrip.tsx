import { BadgeCheck, Compass, Plus } from 'lucide-react';
import { loginUrl, type Post, type Store } from '../lib/api';
import { enableMouseScrolling } from '../lib/website';
import { StoreAvatar } from './StoreAvatar';

export function StoreStrip({
  stores,
  selectedStore,
  posts,
  onSelectStore,
  onClearStore,
}: {
  stores: Store[];
  selectedStore: Store | null;
  posts: Post[];
  onSelectStore: (store: Store) => void;
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
        <button
          className={`story ${selectedStore?.id === item.id ? 'selected' : ''}`}
          key={item.id}
          aria-pressed={selectedStore?.id === item.id}
          onClick={() => onSelectStore(item)}
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
          {item.hasVerificationBadge && <BadgeCheck size={15} />}
        </button>
      ))}
    </section>
  );
}
