import { Layers, Play } from 'lucide-react';
import type { Post } from '../lib/api';
import { MediaView } from './MediaView';

// Instagram-style discovery: tiles carry the visual only. The shop name,
// caption and action bar belong to the viewer that a tap opens.
export function ExploreGrid({
  posts,
  onOpen,
  demo,
}: {
  posts: Post[];
  onOpen: (post: Post, mediaIndex: number) => void;
  demo: boolean;
}) {
  return (
    <div className="explore-grid">
      {posts.map((post, index) => {
        const media = post.media[0];
        const hasVideo = post.media.some((item) => item.kind === 'video');
        return (
          <button
            key={`${demo ? 'demo' : 'live'}:${post.id}`}
            type="button"
            className="explore-tile"
            aria-label={`Open ${post.title}`}
            onClick={() => onOpen(post, 0)}
          >
            <MediaView
              media={media}
              title={post.title}
              eager={index < 4}
              sizes="(max-width: 600px) 33vw, (max-width: 900px) 25vw, 160px"
            />
            {post.media.length > 1 ? (
              <span className="explore-tile-badge" aria-hidden="true">
                <Layers size={14} />
              </span>
            ) : hasVideo ? (
              <span className="explore-tile-badge" aria-hidden="true">
                <Play size={13} fill="currentColor" />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
