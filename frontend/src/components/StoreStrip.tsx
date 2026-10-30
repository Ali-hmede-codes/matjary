import { useState } from 'react';
import { Compass, Plus } from 'lucide-react';
import { loginUrl, type Post, type Store, type StoryGroup } from '../lib/api';
import { enableMouseScrolling } from '../lib/website';
import { liveStories, storyGroupUnseen } from '../lib/stories';
import { storePath } from '../lib/storefront';
import { StoreAvatar, StoreVerifiedBadge } from './StoreAvatar';
import { StoreStorySheet } from './stories/StoreStorySheet';

export function StoreStrip({
  stores,
  selectedStore,
  posts,
  storyGroups = [],
  seen = [],
  onOpenStory,
}: {
  stores: Store[];
  selectedStore: Store | null;
  posts: Post[];
  storyGroups?: StoryGroup[];
  seen?: readonly string[];
  onOpenStory: (storeId: string) => void;
}) {
  // A shop with a live story asks what to open instead of jumping to the shop.
  const [sheetStoreId, setSheetStoreId] = useState<string | null>(null);
  const groupsByStore = new Map<string, StoryGroup>();
  for (const group of storyGroups)
    if (liveStories(group).length > 0) groupsByStore.set(group.store.id, group);
  const sheetStore = stores.find((item) => item.id === sheetStoreId);
  const sheetGroup = sheetStoreId ? groupsByStore.get(sheetStoreId) : undefined;

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
      <a
        className="story all-stores"
        href="/shops"
        title="Open the all shops page"
      >
        <span className="story-ring">
          <Compass size={25} />
        </span>
        <span>All stores</span>
      </a>
      {stores.map((item) => {
        const group = groupsByStore.get(item.id);
        const preview = posts.find((post) => post.store?.id === item.id)
          ?.media[0];
        // A live story never changes the tile's shape: the shop keeps the
        // strip's normal frame, and only the outline turns into a story ring.
        if (group)
          return (
            <button
              type="button"
              key={item.id}
              className={`story has-story ${storyGroupUnseen(group, seen) ? 'is-unseen' : 'is-seen'} ${selectedStore?.id === item.id ? 'selected' : ''}`}
              aria-haspopup="dialog"
              aria-label={`${item.name} story options`}
              onClick={() => setSheetStoreId(item.id)}
            >
              <span className="story-ring">
                <StoreAvatar store={item} large preview={preview} />
              </span>
              <span className="notranslate">{item.name}</span>
              <StoreVerifiedBadge store={item} size={22} />
            </button>
          );
        return (
          <a
            className={`story ${selectedStore?.id === item.id ? 'selected' : ''}`}
            key={item.id}
            href={storePath(item.slug)}
          >
            <span className="story-ring">
              <StoreAvatar store={item} large preview={preview} />
            </span>
            <span className="notranslate">{item.name}</span>
            <StoreVerifiedBadge store={item} size={22} />
          </a>
        );
      })}
      {sheetStore && sheetGroup && (
        <StoreStorySheet
          store={sheetStore}
          group={{ ...sheetGroup, stories: liveStories(sheetGroup) }}
          onViewStory={() => {
            const storeId = sheetStore.id;
            setSheetStoreId(null);
            onOpenStory(storeId);
          }}
          onClose={() => setSheetStoreId(null)}
        />
      )}
    </section>
  );
}
