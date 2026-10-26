import { useRef, useState } from 'react';
import { registerPostView, togglePostLike, type Post } from '../lib/api';
import { readSavedIds } from '../lib/website';

type Engagement = Pick<Post['engagement'], 'likes' | 'viewerLiked'>;

/**
 * Likes, saved posts and view counters are shared by the discovery feed and
 * every shop's post viewer, so both surfaces show the same optimistic state
 * and a like is never toggled twice while the first request is in flight.
 */
export function usePostEngagement({
  demo,
  onNotice,
}: {
  demo: boolean;
  onNotice: (message: string) => void;
}) {
  const [likes, setLikes] = useState<Record<string, Engagement>>({});
  const [views, setViews] = useState<Record<string, number>>({});
  const [liking, setLiking] = useState(false);
  const likeLock = useRef(false);
  const viewed = useRef(new Set<string>());
  const [saved, setSaved] = useState<string[]>(() => {
    try {
      return readSavedIds(window.localStorage);
    } catch {
      return [];
    }
  });

  function savePost(id: string) {
    const removing = saved.includes(id);
    const next = removing
      ? saved.filter((item) => item !== id)
      : [...saved, id].slice(-500);
    setSaved(next);
    try {
      window.localStorage.setItem('matjary:saved-posts', JSON.stringify(next));
      onNotice(
        removing ? 'Removed from your saved finds.' : 'Saved on this device.',
      );
    } catch {
      onNotice('Saved for this visit only. Browser storage is unavailable.');
    }
  }

  async function likePost(post: Post) {
    // Serialize first-time visitor mutations so the server can establish one cookie.
    if (likeLock.current) return;
    likeLock.current = true;
    setLiking(true);
    const previous = likes[post.id] ?? post.engagement;
    const optimistic = {
      viewerLiked: !previous.viewerLiked,
      likes: Math.max(0, previous.likes + (previous.viewerLiked ? -1 : 1)),
    };
    setLikes((current) => ({ ...current, [post.id]: optimistic }));
    try {
      if (!demo) {
        const result = await togglePostLike(post.id);
        setLikes((current) => ({ ...current, [post.id]: result }));
      }
    } catch {
      setLikes((current) => ({ ...current, [post.id]: previous }));
      onNotice('Couldn’t update your like. Please try again.');
    } finally {
      likeLock.current = false;
      setLiking(false);
    }
  }

  async function registerView(post: Post) {
    // Opening a post is the view. One request per post and visit keeps the
    // server's dedupe window from being hit by repeated viewer visits.
    if (demo || viewed.current.has(post.id)) return;
    viewed.current.add(post.id);
    try {
      const result = await registerPostView(post.id);
      setViews((current) => ({ ...current, [post.id]: result.views }));
    } catch {
      // A view failure must never interrupt someone opening a post.
    }
  }

  const withLikes = (post: Post): Post => ({
    ...post,
    engagement: {
      ...post.engagement,
      ...likes[post.id],
      views: views[post.id] ?? post.engagement.views,
    },
  });

  return { saved, liking, likePost, savePost, registerView, withLikes };
}
