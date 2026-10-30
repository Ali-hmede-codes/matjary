import {
  ArrowRight,
  Bookmark,
  Check,
  Compass,
  LoaderCircle,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { Fragment } from 'react';
import type { DiscoveryFeedController } from '../hooks/useDiscoveryFeed';
import { AdCard } from './AdCard';
import { ExploreGrid } from './ExploreGrid';
import { PostCard } from './PostCard';

type FeedPostsProps = Pick<
  DiscoveryFeedController,
  | 'feed'
  | 'layout'
  | 'view'
  | 'exploreActive'
  | 'posts'
  | 'ads'
  | 'withLikes'
  | 'liking'
  | 'likePost'
  | 'setNotice'
  | 'saved'
  | 'savePost'
  | 'openPost'
  | 'navigate'
>;

export function FeedPosts({
  feed,
  layout,
  view,
  exploreActive,
  posts,
  ads,
  withLikes,
  liking,
  likePost,
  setNotice,
  saved,
  savePost,
  openPost,
  navigate,
}: FeedPostsProps) {
  return (
    <>
      {feed.isPending && (
        <div
          className={
            exploreActive
              ? 'explore-grid'
              : `post-grid ${layout === 'grid' ? 'compact-grid' : ''} ${view === 'videos' ? 'video-feed' : ''}`
          }
          role="status"
          aria-label="Loading discoveries"
        >
          <span className="sr-only">Finding your next favorites…</span>
          {exploreActive
            ? Array.from({ length: 9 }, (_, id) => (
                <div key={id} className="explore-skeleton" aria-hidden="true" />
              ))
            : [0, 1].map((id) => (
                <div key={id} className="skeleton-card" aria-hidden="true">
                  <div />
                  <div />
                  <div />
                </div>
              ))}
        </div>
      )}
      {feed.isError && (
        <div className="empty-state" role="status">
          <span className="empty-icon">
            <RefreshCw size={25} />
          </span>
          <h3>Let’s try that again.</h3>
          <p>We couldn’t load your feed. Try again in a moment.</p>
          <div className="empty-actions">
            <button
              className="primary-button"
              onClick={() => void feed.refetch()}
              disabled={feed.isFetching}
            >
              <RefreshCw size={15} />
              Try again
            </button>
          </div>
        </div>
      )}
      {posts.length > 0 && exploreActive && (
        <ExploreGrid posts={posts} onOpen={openPost} />
      )}
      {posts.length > 0 && !exploreActive && (
        <div
          className={`post-grid ${layout === 'grid' ? 'compact-grid' : ''} ${view === 'videos' ? 'video-feed' : ''}`}
        >
          {posts.map((post, index) => {
            // Sponsored cards appear after every fourth post. Short feeds still
            // show one at the end so a first campaign is never invisible.
            const slot = posts.length < 4 ? posts.length : 4;
            const adIndex = (index + 1) / slot - 1;
            const ad =
              (index + 1) % slot === 0 && view !== 'saved'
                ? ads[adIndex]
                : undefined;
            return (
              <Fragment key={`${view}:${post.id}`}>
                <PostCard
                  post={withLikes(post)}
                  preferVideo={view === 'videos'}
                  index={index}
                  liking={liking}
                  onLike={() => void likePost(post)}
                  onNotice={setNotice}
                  saved={saved.includes(post.id)}
                  onSave={() => savePost(post.id)}
                  onOpen={(index) => openPost(post, index)}
                />
                {ad && <AdCard ad={ad} />}
              </Fragment>
            );
          })}
        </div>
      )}
      {!feed.isPending && !feed.isError && posts.length === 0 && (
        <div className="empty-state">
          <span className="empty-icon">
            {view === 'saved' ? <Bookmark size={26} /> : <Compass size={26} />}
          </span>
          <h3>
            {view === 'saved'
              ? 'All your favorites, right here.'
              : 'Nothing here just yet.'}
          </h3>
          <p>
            {view === 'saved'
              ? 'Tap the bookmark on a discovery to save it here.'
              : 'Try another category or check back for new posts.'}
          </p>
          <button
            className="secondary-button"
            onClick={() => navigate('discover')}
          >
            Explore all finds <ArrowRight size={15} />
          </button>
        </div>
      )}
      {feed.hasNextPage && (
        <button
          className="load-more secondary-button"
          disabled={feed.isFetching}
          onClick={() => void feed.fetchNextPage()}
        >
          {feed.isFetchingNextPage ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Plus size={17} />
          )}
          Load more posts
        </button>
      )}
      {posts.length > 0 && !feed.hasNextPage && (
        <div className="feed-end">
          <Check size={17} />
          <span>You’re all caught up.</span>
        </div>
      )}
    </>
  );
}
