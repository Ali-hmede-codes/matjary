import type { StoryGroup } from '../../lib/api';
import { storyGroupUnseen } from '../../lib/stories';
import { enableMouseScrolling } from '../../lib/website';
import { StoreVerifiedBadge } from '../StoreAvatar';
import { StoryAvatar } from './StoryAvatar';

// The Instagram-style strip on the favorites page: one ring per saved shop
// with live stories, colored until this device watched them.
export function StoryRail({
  groups,
  seen,
  onOpen,
}: {
  groups: StoryGroup[];
  seen: readonly string[];
  onOpen: (storeId: string) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <section className="story-rail" aria-label="Shop stories">
      <div className="story-rail-head">
        <h2>Stories</h2>
      </div>
      <div className="story-rail-track" ref={enableMouseScrolling} tabIndex={0}>
        {groups.map((group) => (
          <button
            key={group.store.id}
            type="button"
            className="story-chip"
            onClick={() => onOpen(group.store.id)}
            aria-label={`Open ${group.store.name} story`}
          >
            <StoryAvatar
              store={group.store}
              large
              state={storyGroupUnseen(group, seen) ? 'unseen' : 'seen'}
            />
            <span className="story-chip-label">
              <span className="story-chip-name notranslate">
                {group.store.name}
              </span>
              <StoreVerifiedBadge store={group.store} size={13} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
