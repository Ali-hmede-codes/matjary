import { useEffect, useRef } from 'react';
import { ChevronRight, Play, Store as StoreIcon, X } from 'lucide-react';
import type { Store, StoryGroup } from '../../lib/api';
import { storyTimeLabel } from '../../lib/stories';
import { storePath } from '../../lib/storefront';
import { StoreAvatar, StoreVerifiedBadge } from '../StoreAvatar';

// Tapping a shop that has a live story opens this bottom sheet instead of
// jumping straight to the shop: watch the story, or visit the shop.
export function StoreStorySheet({
  store,
  group,
  demo = false,
  onViewStory,
  onClose,
}: {
  store: Store;
  group: StoryGroup;
  demo?: boolean;
  onViewStory: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const newest = group.stories[group.stories.length - 1];

  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    element?.querySelector<HTMLElement>('.store-story-choice')?.focus({
      preventScroll: true,
    });
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="store-story-sheet"
      aria-label={`${store.name} options`}
      onCancel={onClose}
      onClick={(event) => {
        // A backdrop tap targets the dialog itself, not its content.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <span className="store-story-sheet-grip" aria-hidden="true" />
      <header className="store-story-sheet-head">
        <StoreAvatar store={store} large />
        <span className="store-story-sheet-id">
          <strong className="store-story-sheet-name">
            {store.name}
            <StoreVerifiedBadge store={store} size={15} />
          </strong>
          <small>
            {group.stories.length}{' '}
            {group.stories.length === 1 ? 'story' : 'stories'} live
            {newest ? ` · ${storyTimeLabel(newest.createdAt)}` : ''}
          </small>
        </span>
        <button
          type="button"
          className="store-story-sheet-close"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={19} aria-hidden="true" />
        </button>
      </header>
      <div className="store-story-sheet-actions">
        <button
          type="button"
          className="store-story-choice is-story"
          onClick={onViewStory}
        >
          <span className="store-story-choice-icon" aria-hidden="true">
            <Play size={18} fill="currentColor" />
          </span>
          <span className="store-story-choice-copy">
            <strong>View story</strong>
            <small>Watch what the shop shared today</small>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <a
          className="store-story-choice"
          href={storePath(store.slug, demo)}
          onClick={onClose}
        >
          <span className="store-story-choice-icon" aria-hidden="true">
            <StoreIcon size={18} />
          </span>
          <span className="store-story-choice-copy">
            <strong>View shop</strong>
            <small>Posts, products and shop details</small>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </a>
      </div>
      <button
        type="button"
        className="store-story-sheet-cancel"
        onClick={onClose}
      >
        Cancel
      </button>
    </dialog>
  );
}
