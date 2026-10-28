import { useState } from 'react';
import {
  ChevronRight,
  Clock3,
  Sparkles,
  Store as StoreIcon,
} from 'lucide-react';
import { storyGroupUnseen, storyTimeLabel } from '../lib/stories';
import { usePageSeo } from '../hooks/usePageSeo';
import { useSeenStories, useStoryGroups } from '../hooks/useStories';
import { useWebsiteSettings } from '../hooks/useWebsiteSettings';
import { StatusBanner } from './Feedback';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import { StoryAvatar } from './stories/StoryAvatar';
import { StoryViewer } from './stories/StoryViewer';

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

// Every shop with live stories in one place, so the rail has a full page too.
export function StoriesPage() {
  const { settings, theme, settingsQuery } = useWebsiteSettings();
  const { seen, markSeen } = useSeenStories();
  const storiesQuery = useStoryGroups();
  const groups = storiesQuery.data?.groups ?? [];
  const [openStoreId, setOpenStoreId] = useState<string | null>(null);
  const openGroup = groups.find((group) => group.store.id === openStoreId);

  usePageSeo({
    title: `Stories — ${settings.siteName}`,
    description: 'The 24-hour stories independent shops shared today.',
    siteName: settings.siteName,
    canonical: '/stories',
  });

  return (
    <div className="app shops-page stories-page" style={theme}>
      <a className="skip-link" href="#stories-main">
        Skip to stories
      </a>
      <SiteHeader settings={settings} view="stories" />
      <div className="page-shell">
        <main className="shops-main" id="stories-main" tabIndex={-1}>
          <header className="shops-head">
            <span className="shops-kicker">
              <Sparkles size={13} aria-hidden="true" /> Live now
            </span>
            <h1 id="stories-title">Stories from the shops you follow</h1>
            <p className="shops-lede">
              {groups.length > 0
                ? `${groups.length} ${groups.length === 1 ? 'shop is' : 'shops are'} sharing in the last 24 hours. Tap a shop to watch its story.`
                : 'Everything shared by independent shops in the last 24 hours appears here.'}
            </p>
          </header>

          {storiesQuery.isError && (
            <StatusBanner
              action="Try again"
              onAction={() => void storiesQuery.refetch()}
            >
              Stories couldn’t load right now.
            </StatusBanner>
          )}
          {settingsQuery.isError && (
            <StatusBanner
              action="Retry settings"
              onAction={() => void settingsQuery.refetch()}
            >
              Website settings are unavailable. Default branding is shown.
            </StatusBanner>
          )}

          {storiesQuery.isPending ? (
            <>
              <p className="shops-status" role="status">
                Looking for live stories…
              </p>
              <div className="stories-list" aria-hidden="true">
                {Array.from({ length: 4 }, (_, index) => (
                  <span className="story-row-skeleton" key={index} />
                ))}
              </div>
            </>
          ) : groups.length === 0 ? (
            <div className="shops-empty" role="status">
              <StoreIcon size={26} aria-hidden="true" />
              <h2>No stories right now</h2>
              <p>
                Stories last 24 hours. Check back later, or open a shop and tap
                its ring to watch.
              </p>
              <a className="primary-button" href="/shops">
                Browse all shops
              </a>
            </div>
          ) : (
            <ul className="stories-list">
              {groups.map((group) => {
                const newest = group.stories[group.stories.length - 1];
                return (
                  <li key={group.store.id}>
                    <button
                      type="button"
                      className="story-row"
                      onClick={() => setOpenStoreId(group.store.id)}
                      aria-label={`Watch ${group.store.name} story`}
                    >
                      <StoryAvatar
                        store={group.store}
                        large
                        state={
                          storyGroupUnseen(group, seen) ? 'unseen' : 'seen'
                        }
                      />
                      <span className="story-row-body">
                        <strong>{group.store.name}</strong>
                        <small>{group.store.businessCategoryLabel}</small>
                        <span className="story-row-meta">
                          <Clock3 size={13} aria-hidden="true" />
                          {newest ? storyTimeLabel(newest.createdAt) : 'Live'}
                          {' · '}
                          {plural(group.stories.length, 'story', 'stories')}
                        </span>
                      </span>
                      <ChevronRight
                        className="story-row-arrow"
                        size={18}
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <SiteFooter settings={settings} />
        </main>
      </div>
      {openGroup && (
        <StoryViewer
          key={openGroup.store.id}
          groups={groups}
          initialStoreId={openGroup.store.id}
          onSeen={markSeen}
          onClose={() => setOpenStoreId(null)}
        />
      )}
    </div>
  );
}
