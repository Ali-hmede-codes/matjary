import { useState } from 'react';
import { Bookmark, Heart, Send } from 'lucide-react';
import { postPath } from '../lib/storefront';
import type { Post } from '../lib/api';

export interface PostActionProps {
  post: Post;
  saved: boolean;
  liking: boolean;
  onLike: () => void;
  onSave: () => void;
  onNotice: (message: string) => void;
}

export function PostActions({
  post,
  saved,
  liking,
  onLike,
  onSave,
  onNotice,
}: PostActionProps) {
  const [sharing, setSharing] = useState(false);
  // A shared post links to its own page. The media file behind it has no title,
  // preview image, or canonical URL for a link preview to read.
  const shareUrl = `${window.location.origin}${postPath(post)}`;

  async function sharePost() {
    if (sharing) return;
    setSharing(true);
    try {
      if (navigator.share) {
        await navigator.share({
          title: post.title,
          text: post.description?.trim() || post.title,
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        onNotice('Post link copied.');
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        onNotice('Sharing is unavailable in this browser.');
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="post-actions">
      <button
        className={`icon-button like-button ${post.engagement.viewerLiked ? 'is-liked' : ''}`}
        aria-label={`${post.engagement.viewerLiked ? 'Unlike' : 'Like'} ${post.title}`}
        aria-pressed={post.engagement.viewerLiked}
        disabled={liking}
        onClick={onLike}
      >
        <Heart
          size={25}
          fill={post.engagement.viewerLiked ? 'currentColor' : 'none'}
        />
      </button>
      <button
        className="icon-button"
        aria-label={`Share ${post.title}`}
        disabled={sharing}
        onClick={() => void sharePost()}
      >
        <Send size={23} />
      </button>
      <button
        className={`icon-button save-button ${saved ? 'is-saved' : ''}`}
        aria-pressed={saved}
        aria-label={`${saved ? 'Unsave' : 'Save'} ${post.title} on this device`}
        onClick={onSave}
      >
        <Bookmark size={24} fill={saved ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}
