import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  ShoppingBag,
} from 'lucide-react';
import { ApiError, assetUrl, getPost } from '../lib/api';
import { demoPosts } from '../lib/demo';
import {
  categorySlug,
  formatProductPrice,
  postPath,
  storeCategoryPath,
  storePath,
  storeProductPath,
} from '../lib/storefront';
import { usePageSeo } from '../hooks/usePageSeo';
import { usePostEngagement } from '../hooks/usePostEngagement';
import { useWebsiteSettings } from '../hooks/useWebsiteSettings';
import { AutoplayVideo } from './AutoplayVideo';
import { MediaView } from './MediaView';
import { PostActions } from './PostActions';
import { StoreAvatar } from './StoreAvatar';
import { StoreDetailLoading, StoreDetailMissing } from './StoreDetail';

function sharedDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * The page behind a shared post link. A shared link used to point at the media
 * file itself, so previews had no title and the visitor landed on raw bytes.
 */
export function PostPage({
  shopSlug,
  postSlug,
  demo,
}: {
  shopSlug?: string;
  postSlug: string;
  demo: boolean;
}) {
  const { settings } = useWebsiteSettings(false, !demo);
  const [mediaIndex, setMediaIndex] = useState(0);
  const [notice, setNotice] = useState('');
  const { saved, liking, likePost, savePost, registerView, withLikes } =
    usePostEngagement({ demo, onNotice: setNotice });
  const postQuery = useQuery({
    queryKey: ['post', postSlug],
    queryFn: ({ signal }) => getPost(postSlug, signal),
    enabled: !demo,
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 404) && count < 1,
  });
  const sample = demo
    ? demoPosts.find(
        (item) =>
          item.slug === postSlug &&
          (!shopSlug || item.store?.slug === shopSlug),
      )
    : undefined;
  const loaded = demo ? sample : postQuery.data;
  // The address carries the shop, so another shop's post must never render here.
  const post =
    loaded && (!shopSlug || loaded.store?.slug === shopSlug)
      ? withLikes(loaded)
      : undefined;
  const postId = post?.id;
  const media = post?.media[mediaIndex] ?? post?.media[0];
  const shop = post?.store;
  const home = demo ? '/?demo=1' : '/';
  const previewImage =
    post?.media.find((item) => item.kind === 'image')?.primaryUrl ??
    post?.media[0]?.posterUrl ??
    assetUrl(settings.logoUrl);

  useEffect(() => {
    // Opening the shared page is the view; the hook dedupes per visit.
    if (post) void registerView(post);
  }, [postId]);

  usePageSeo(
    post && media
      ? {
          title: shop
            ? `${post.title} — ${shop.name}`
            : `${post.title} — ${settings.siteName}`,
          description:
            post.description?.trim() ||
            `A post shared by ${shop?.name ?? settings.siteName}.`,
          image: previewImage,
          canonical: postPath(post, demo),
          type: 'article',
          siteName: settings.siteName,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: post.title,
            description: post.description ?? undefined,
            image: previewImage,
            datePublished: post.publishedAt ?? undefined,
            author: {
              '@type': 'Organization',
              name: shop?.name ?? settings.siteName,
            },
            mainEntityOfPage: {
              '@type': 'WebPage',
              '@id': `${window.location.origin}${postPath(post, demo)}`,
            },
          },
        }
      : null,
  );

  if (!demo && postQuery.isPending)
    return <StoreDetailLoading label="Opening the post…" />;
  if (!post || !media)
    return (
      <StoreDetailMissing
        title="This post isn’t available."
        description="It may have been removed, hidden, or the shop changed its address."
        home={shopSlug ? storePath(shopSlug, demo) : home}
        homeLabel={shopSlug ? 'Back to the shop' : 'Back to discoveries'}
      />
    );

  const multiple = post.media.length > 1;
  const published = sharedDate(post.publishedAt);
  const link = post.link;
  return (
    <div className="app storefront storefront-detail post-page">
      <header className="post-page-bar">
        <a
          className="post-page-back"
          href={shop ? storePath(shop.slug, demo) : home}
        >
          <ArrowLeft size={17} aria-hidden="true" />
          {shop ? shop.name : settings.siteName}
        </a>
        <a className="shop-platform" href={home}>
          <ShoppingBag size={18} aria-hidden="true" />
          {settings.siteName}
        </a>
      </header>
      <main className="post-page-main">
        <article className="post-page-card" aria-labelledby="post-page-title">
          <div className="post-page-media">
            {media.kind === 'video' ? (
              <AutoplayVideo
                key={media.id}
                media={media}
                title={post.title}
                eager
                fit="contain"
              />
            ) : (
              <MediaView
                key={media.id}
                media={media}
                title={post.title}
                eager
                sizes="(max-width: 900px) 100vw, 620px"
              />
            )}
            {multiple && (
              <div className="post-page-pager">
                <button
                  type="button"
                  disabled={mediaIndex === 0}
                  onClick={() => setMediaIndex(mediaIndex - 1)}
                  aria-label="Previous photo or video"
                >
                  <ChevronLeft size={17} aria-hidden="true" />
                </button>
                <span aria-live="polite">
                  {mediaIndex + 1} / {post.media.length}
                </span>
                <button
                  type="button"
                  disabled={mediaIndex === post.media.length - 1}
                  onClick={() => setMediaIndex(mediaIndex + 1)}
                  aria-label="Next photo or video"
                >
                  <ChevronRight size={17} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
          <div className="post-page-info">
            {shop && (
              <a
                className="store-identity"
                href={storePath(shop.slug, demo)}
                aria-label={`Visit ${shop.name}`}
              >
                <StoreAvatar store={shop} preview={media} />
                <span>
                  <strong>{shop.name}</strong>
                  <small>
                    {shop.location?.city ||
                      shop.businessCategoryLabel ||
                      'Independent store'}
                  </small>
                </span>
              </a>
            )}
            <h1 id="post-page-title">{post.title}</h1>
            {published && <p className="post-page-date">Shared {published}</p>}
            {post.description && (
              <p className="post-page-description">{post.description}</p>
            )}
            {link && shop && (
              <a
                className="post-page-link"
                href={
                  link.type === 'product' && link.slug
                    ? storeProductPath(shop.slug, link.slug, demo)
                    : storeCategoryPath(
                        shop.slug,
                        categorySlug(link.name),
                        demo,
                      )
                }
              >
                {link.type === 'product' ? (
                  <ShoppingBag size={16} aria-hidden="true" />
                ) : (
                  <LayoutGrid size={16} aria-hidden="true" />
                )}
                <span>
                  <strong>{link.name}</strong>
                  {link.type === 'product' &&
                    link.priceCents &&
                    link.currency && (
                      <small>
                        {formatProductPrice(link.priceCents, link.currency)}
                      </small>
                    )}
                </span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            )}
            <div className="post-page-actions">
              <PostActions
                post={post}
                demo={demo}
                saved={saved.includes(post.id)}
                liking={liking}
                onLike={() => void likePost(post)}
                onSave={() => savePost(post.id)}
                onNotice={setNotice}
              />
              <p className="post-page-stats">
                {post.engagement.likes}{' '}
                {post.engagement.likes === 1 ? 'like' : 'likes'} ·{' '}
                {post.engagement.views}{' '}
                {post.engagement.views === 1 ? 'view' : 'views'}
              </p>
            </div>
            {notice && (
              <p className="post-page-notice" role="status">
                {notice}
              </p>
            )}
            {shop && (
              <a className="post-page-shop" href={storePath(shop.slug, demo)}>
                Visit {shop.name}
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            )}
          </div>
        </article>
      </main>
    </div>
  );
}
