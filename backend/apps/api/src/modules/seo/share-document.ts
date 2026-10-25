import type { MetaTags } from './seo.service';

/**
 * User agents that fetch a link once and read tags without executing the SPA.
 * They receive a static document with no redirect, so a preview fetcher that
 * happens to run scripts can never replace the tags with the platform's.
 */
const SHARE_CRAWLER_PATTERN =
  /facebookexternalhit|facebookbot|meta-externalagent|WhatsApp|TelegramBot|Twitterbot|LinkedInBot|Slackbot|Discordbot|Pinterest|vkShare|SkypeUriPreview|Iframely|Embedly|redditbot|Mastodon|Misskey/iu;

export function isShareCrawler(userAgent: string | undefined): boolean {
  return Boolean(userAgent && SHARE_CRAWLER_PATTERN.test(userAgent));
}

/**
 * Minimal standalone document for shared shop/category/product links. It must
 * stay free of the frontend bundle: every tag a link preview reads lives in
 * the initial HTML. Real browsers are forwarded to the storefront page, while
 * crawlers get the same content without the script.
 */
export function renderShareDocument(
  meta: MetaTags,
  redirectTo?: string,
): string {
  const escape = escapeXml;
  const tags = [
    `<title>${escape(meta.title)}</title>`,
    `<meta name="description" content="${escape(meta.description)}">`,
    `<meta name="robots" content="${escape(meta.robots)}">`,
    `<link rel="canonical" href="${escape(meta.canonical)}">`,
    `<meta property="og:type" content="${escape(meta.og.type)}">`,
    `<meta property="og:title" content="${escape(meta.og.title)}">`,
    `<meta property="og:description" content="${escape(meta.og.description)}">`,
    `<meta property="og:url" content="${escape(meta.og.url)}">`,
    `<meta property="og:site_name" content="${escape(meta.og.siteName ?? 'Matjary')}">`,
    meta.og.image
      ? `<meta property="og:image" content="${escape(meta.og.image)}">`
      : '',
    meta.og.image
      ? `<meta property="og:image:alt" content="${escape(meta.og.title)}">`
      : '',
    `<meta name="twitter:card" content="${escape(meta.twitter.card)}">`,
    `<meta name="twitter:title" content="${escape(meta.twitter.title)}">`,
    `<meta name="twitter:description" content="${escape(meta.twitter.description)}">`,
    meta.twitter.image
      ? `<meta name="twitter:image" content="${escape(meta.twitter.image)}">`
      : '',
  ];
  // Escaping '<' keeps an owner-authored canonical from closing the script tag.
  const redirect = redirectTo
    ? `<script>location.replace(${JSON.stringify(redirectTo).replace(/</gu, '\\u003c')});</script>\n`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${tags.filter(Boolean).join('\n')}
</head>
<body>
${redirect}<main>
<h1>${escape(meta.title)}</h1>
<p>${escape(meta.description)}</p>
<p><a href="${escape(meta.canonical)}">Open this page</a></p>
</main>
</body>
</html>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
