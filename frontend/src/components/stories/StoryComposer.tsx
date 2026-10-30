import './StoryComposer.css';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImagePlus, LoaderCircle, Sparkles, X } from 'lucide-react';
import {
  ApiError,
  assetUrl,
  createStory,
  getJson,
  type MyStories,
  type ProductList,
  type Store,
  type StoreCategoryList,
} from '../../lib/api';
import { storeMediaUrl } from '../../lib/storefront';
import { useMediaUpload } from '../../features/shared/useMediaUpload';

const MAX_STORY_SECONDS = 30;

function readVideoSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const element = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (value: number) => {
      URL.revokeObjectURL(url);
      element.removeAttribute('src');
      resolve(value);
    };
    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      if (Number.isFinite(element.duration)) done(element.duration);
      else done(0);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('video-unreadable'));
    };
    element.src = url;
  });
}

// Owner sheet behind the "+" on the shop logo. One photo or one video (30s
// ceiling), an optional single link to a product or a section, and a 24-hour
// life — no title, no description.
export function StoryComposer({
  store,
  myStories,
  onClose,
  onShared,
}: {
  store: Store;
  myStories?: MyStories;
  onClose: () => void;
  onShared: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [media, setMedia] = useState<{ id: string; key: string }>();
  const [link, setLink] = useState('');
  const [notice, setNotice] = useState('');
  const [sharing, setSharing] = useState(false);
  const upload = useMediaUpload({
    targetId: store.id,
    purpose: 'store_story',
    allowVideo: true,
    readyMessage: 'Ready. Add a link or share your story.',
    onReady: setMedia,
  });

  const limit = myStories?.limit ?? null;
  const used = myStories?.used ?? 0;
  const remaining =
    myStories?.remaining ?? (limit == null ? null : Math.max(0, limit - used));
  const blocked =
    limit === 0 || (remaining != null && remaining <= 0) || upload.busy;

  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // The link picker only needs the public catalogue; a draft product is not
  // linkable from a story, matching what readers can actually open.
  const productsQuery = useQuery({
    queryKey: ['story-products', store.slug],
    queryFn: ({ signal }) =>
      getJson<ProductList>(`stores/${store.slug}/products?limit=60`, signal),
    enabled: Boolean(media),
    staleTime: 120_000,
  });
  const categoriesQuery = useQuery({
    queryKey: ['story-categories', store.slug],
    queryFn: ({ signal }) =>
      getJson<StoreCategoryList>(`stores/${store.slug}/categories`, signal),
    enabled: Boolean(media),
    staleTime: 120_000,
  });

  async function pick(file: File) {
    setNotice('');
    if (file.type.startsWith('video/')) {
      try {
        const seconds = await readVideoSeconds(file);
        if (seconds > MAX_STORY_SECONDS + 0.5) {
          setNotice(
            'Stories can be up to 30 seconds long. Trim the clip first.',
          );
          return;
        }
      } catch {
        setNotice('That video could not be read. Choose another file.');
        return;
      }
    }
    await upload.upload(file);
  }

  async function share() {
    if (!media || sharing) return;
    setSharing(true);
    setNotice('');
    try {
      const [kind, id] = link.split(':');
      await createStory({
        storeSlug: store.slug,
        mediaId: media.id,
        ...(kind === 'product' && id ? { linkedProductId: id } : {}),
        ...(kind === 'category' && id ? { linkedCategoryId: id } : {}),
      });
      onShared();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'STORY_LIMIT')
        setNotice(
          'Every live story slot for this shop is in use. Delete a story or wait for one to end.',
        );
      else if (
        error instanceof ApiError &&
        error.code === 'STORY_STORE_OFFLINE'
      )
        setNotice('Bring the shop online before sharing a story.');
      else if (error instanceof ApiError && error.code === 'TRIAL_EXPIRED')
        setNotice(
          'Your free trial has ended. Choose a paid plan to share a story.',
        );
      else if (error instanceof ApiError && error.status === 409)
        setNotice(
          'This story cannot be published right now. Check the shop and try again.',
        );
      else if (error instanceof ApiError && error.status === 403)
        setNotice('You cannot add a story to this shop right now.');
      else setNotice('Could not share this story. Please try again.');
    } finally {
      setSharing(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="story-composer"
      aria-label="Add a story"
      onCancel={onClose}
    >
      <div className="story-composer-head">
        <div>
          <span className="story-composer-kicker">
            <Sparkles size={14} aria-hidden="true" /> 24-hour story
          </span>
          <h2>Share a moment</h2>
          <p>
            {limit == null
              ? 'Unlimited live stories on this plan.'
              : limit === 0
                ? 'Stories are not included in this plan.'
                : `${used} of ${limit} live ${limit === 1 ? 'story' : 'stories'} used · a slot frees up when a story ends or is deleted.`}
          </p>
        </div>
        <button
          type="button"
          className="story-composer-close"
          aria-label="Close story composer"
          onClick={onClose}
        >
          <X size={19} aria-hidden="true" />
        </button>
      </div>

      <div className="story-composer-body">
        {media ? (
          <figure className="story-composer-preview">
            {/\.mp4$/i.test(media.key) ? (
              <video
                src={storeMediaUrl(media.key)}
                controls
                playsInline
                preload="metadata"
              />
            ) : (
              <img
                src={assetUrl(storeMediaUrl(media.key))}
                alt="Your story preview"
              />
            )}
            <figcaption>Live for 24 hours after you share it.</figcaption>
          </figure>
        ) : (
          <label
            className={`story-composer-pick ${blocked ? 'is-disabled' : ''}`}
          >
            {upload.busy ? (
              <LoaderCircle className="spin" size={26} aria-hidden="true" />
            ) : (
              <ImagePlus size={26} aria-hidden="true" />
            )}
            <strong>
              {upload.busy ? upload.progress : 'Choose a photo or video'}
            </strong>
            <small>
              JPG, PNG, WebP, AVIF, MP4, MOV or WebM · video up to 30s
            </small>
            <input
              type="file"
              disabled={blocked}
              accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/quicktime,video/webm"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void pick(file);
              }}
            />
          </label>
        )}

        {media && (
          <label className="story-composer-link">
            <span>Link to a product or section (optional)</span>
            <select
              value={link}
              onChange={(event) => setLink(event.target.value)}
            >
              <option value="">No link</option>
              {(productsQuery.data?.items ?? []).length > 0 && (
                <optgroup label="Products">
                  {(productsQuery.data?.items ?? []).map((product) => (
                    <option key={product.id} value={`product:${product.id}`}>
                      {product.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {(categoriesQuery.data?.items ?? []).length > 0 && (
                <optgroup label="Sections">
                  {(categoriesQuery.data?.items ?? []).map((category) => (
                    <option key={category.id} value={`category:${category.id}`}>
                      {category.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
        )}

        {(upload.error || notice) && (
          <p className="story-composer-notice" role="status">
            {upload.error || notice}
          </p>
        )}
      </div>

      <div className="story-composer-actions">
        {media && (
          <button
            type="button"
            className="text-button"
            disabled={sharing}
            onClick={() => setMedia(undefined)}
          >
            Choose another
          </button>
        )}
        <button
          type="button"
          className="primary-button"
          disabled={!media || sharing}
          onClick={() => void share()}
        >
          {sharing && (
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
          )}
          Share story
        </button>
      </div>
    </dialog>
  );
}
