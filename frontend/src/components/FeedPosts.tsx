import {
  ArrowRight,
  Bookmark,
  Check,
  Compass,
  LoaderCircle,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { DiscoveryFeedController } from '../hooks/useDiscoveryFeed';
import { PostCard } from './PostCard';

type FeedPostsProps = Pick<
  DiscoveryFeedController,
  | 'demo'
  | 'feed'
  | 'layout'
  | 'view'
  | 'posts'
  | 'withLikes'
  | 'liking'
  | 'likePost'
  | 'setNotice'
  | 'saved'
  | 'savePost'
  | 'openPost'
  | 'chooseStore'
  | 'source'
  | 'navigate'
  | 'toggleDemo'
>;

export function FeedPosts({
  demo,
  feed,
  layout,
  view,
  posts,
  withLikes,
  liking,
  likePost,
  setNotice,
  saved,
  savePost,
  openPost,
  chooseStore,
  source,
  navigate,
  toggleDemo,
}: FeedPostsProps) {
  return (
    <>
      {!demo && feed.isPending && (
        <div
          className={`post-grid ${layout === 'grid' ? 'compact-grid' : ''} ${view === 'videos' ? 'video-feed' : ''}`}
          role="status"
          aria-label="Loading discoveries"
        >
          <span className="sr-only">Finding your next favorites…</span>
          {[0, 1].map((id) => (
            <div key={id} className="skeleton-card" aria-hidden="true">
              <div />
              <div />
              <div />
            </div>
          ))}
        </div>
      )}
      {!demo && feed.isError && (
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
            <button className="secondary-button" onClick={toggleDemo}>
              Preview the design
            </button>
          </div>
        </div>
      )}
      {posts.length > 0 && (
        <div
          className={`post-grid ${layout === 'grid' ? 'compact-grid' : ''} ${view === 'videos' ? 'video-feed' : ''}`}
        >
          {posts.map((post, index) => (
            <PostCard
              key={`${view}:${post.id}`}
              post={withLikes(post)}
              preferVideo={view === 'videos'}
              index={index}
              liking={liking}
              onLike={() => void likePost(post)}
              onNotice={setNotice}
              saved={saved.includes(post.id)}
              onSave={() => savePost(post.id)}
              onOpen={(index) => openPost(post, index)}
              onStore={chooseStore}
              demo={demo}
            />
          ))}
        </div>
      )}
      {(demo || (!feed.isPending && !feed.isError)) && posts.length === 0 && (
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
          {!demo && !source.length && (
            <button className="text-button" onClick={toggleDemo}>
              See a sample of the design
            </button>
          )}
        </div>
      )}
      {!demo && feed.hasNextPage && (
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
      {posts.length > 0 && (demo || !feed.hasNextPage) && (
        <div className="feed-end">
          <Check size={17} />
          <span>You’re all caught up.</span>
        </div>
      )}
    </>
  );
}
