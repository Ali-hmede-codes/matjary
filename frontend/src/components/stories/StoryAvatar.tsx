import { Plus } from 'lucide-react';
import type { Store } from '../../lib/api';
import { StoreAvatar } from '../StoreAvatar';

// "unseen" wears the colored ring, "seen" goes quiet on this device, and
// "owner" is the dashed placeholder shown before a shop has any live story.
export type StoryRing = 'unseen' | 'seen' | 'owner';

export function StoryAvatar({
  store,
  state = 'unseen',
  large = false,
  expandable = false,
  add = false,
  addLabel = 'Add a story',
  onAdd,
}: {
  store?: Store;
  state?: StoryRing;
  large?: boolean;
  expandable?: boolean;
  add?: boolean;
  addLabel?: string;
  onAdd?: () => void;
}) {
  return (
    <span
      className={`story-avatar story-avatar-${state} ${large ? 'is-large' : ''}`}
    >
      <span className="story-avatar-ring">
        <StoreAvatar store={store} large={large} expandable={expandable} />
      </span>
      {add && (
        <button
          type="button"
          className="story-avatar-add"
          aria-label={addLabel}
          title={addLabel}
          onClick={(event) => {
            // The avatar may sit inside a link or a viewer trigger.
            event.preventDefault();
            event.stopPropagation();
            onAdd?.();
          }}
        >
          <Plus size={15} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
