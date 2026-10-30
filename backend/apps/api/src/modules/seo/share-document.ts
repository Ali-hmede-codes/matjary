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
  // Escaping '<' keeps an owner-authored canonical from closing the script tag.
  const redirect = redirectTo
    ? `<script>location.replace(${JSON.stringify(redirectTo).replace(/</gu, '\\u003c')});</script>\n`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${renderShareHeadTags(meta)}
</head>
<body>
${redirect}<main>
<h1>${escapeXml(meta.title)}</h1>
<p>${escapeXml(meta.description)}</p>
<p><a href="${escapeXml(meta.canonical)}">Open this page</a></p>
</main>
</body>
</html>`;
}

/** Head tags shared by the crawler page and the prerendered SPA shells. */
export function renderShareHeadTags(meta: MetaTags): string {
  return [
    `<title>${escapeXml(meta.title)}</title>`,
    `<meta name="description" content="${escapeXml(meta.description)}">`,
    `<meta name="robots" content="${escapeXml(meta.robots)}">`,
    meta.keywords
      ? `<meta name="keywords" content="${escapeXml(meta.keywords)}">`
      : '',
    `<link rel="canonical" href="${escapeXml(meta.canonical)}">`,
    `<meta property="og:type" content="${escapeXml(meta.og.type)}">`,
    `<meta property="og:title" content="${escapeXml(meta.og.title)}">`,
    `<meta property="og:description" content="${escapeXml(meta.og.description)}">`,
    `<meta property="og:url" content="${escapeXml(meta.og.url)}">`,
    `<meta property="og:site_name" content="${escapeXml(meta.og.siteName ?? 'Matjary')}">`,
    meta.og.image
      ? `<meta property="og:image" content="${escapeXml(meta.og.image)}">`
      : '',
    meta.og.image
      ? `<meta property="og:image:alt" content="${escapeXml(meta.og.title)}">`
      : '',
    `<meta name="twitter:card" content="${escapeXml(meta.twitter.card)}">`,
    meta.twitter.site
      ? `<meta name="twitter:site" content="${escapeXml(meta.twitter.site)}">`
      : '',
    meta.twitter.creator
      ? `<meta name="twitter:creator" content="${escapeXml(meta.twitter.creator)}">`
      : '',
    meta.og.locale
      ? `<meta property="og:locale" content="${escapeXml(meta.og.locale)}">`
      : '',
    `<meta name="twitter:title" content="${escapeXml(meta.twitter.title)}">`,
    `<meta name="twitter:description" content="${escapeXml(meta.twitter.description)}">`,
    meta.twitter.image
      ? `<meta name="twitter:image" content="${escapeXml(meta.twitter.image)}">`
      : '',
    // Verification and structured data belong in the first response: search
    // engines and AI agents must find them without running the SPA.
    ...(meta.verificationMeta ?? []),
    meta.jsonLd?.length ? renderJsonLd(meta.jsonLd) : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** One script element; '<' is escaped so page copy cannot close it early. */
function renderJsonLd(jsonLd: Record<string, unknown>[]): string {
  return `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</gu, '\\u003c')}</script>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
