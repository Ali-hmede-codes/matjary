import { useState } from 'react';
import { Bookmark, Heart, Send } from 'lucide-react';
import { assetUrl, type Media, type Post } from '../lib/api';

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
  media,
  saved,
  liking,
  onLike,
  onSave,
  onNotice,
  showCount = true,
}: PostActionProps & { media?: Media; showCount?: boolean }) {
  const [sharing, setSharing] = useState(false);
  const shareUrl = assetUrl(media?.primaryUrl);
  async function shareMedia() {
    if (!shareUrl || sharing) return;
    setSharing(true);
    try {
      const url = new URL(shareUrl, window.location.origin).href;
      if (navigator.share) {
        await navigator.share({ title: post.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        onNotice('Media link copied.');
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
      {showCount && (
        <span className="likes-count">
          {post.engagement.likes.toLocaleString()}
          <span className="sr-only"> likes</span>
        </span>
      )}
      <button
        className="icon-button"
        aria-label={`Share ${media?.kind === 'video' ? 'video' : 'photo'} from ${post.title}`}
        disabled={!shareUrl || sharing}
        onClick={() => void shareMedia()}
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
