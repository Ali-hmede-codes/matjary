import type { MetaTags } from './seo.service';
import { renderShareHeadTags } from './share-document';

// Storefront URLs only ever contain lower-case slug segments. Validating every
// segment keeps file writes inside the mounted share directory.
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

// The built index.html may carry its own default preview tags. They are
// removed first so an injected shell never ends up with two titles or two
// og:image values, where the stale one can win.
const PREVIEW_TAGS = new RegExp(
  [
    '<title\\b[^>]*>[\\s\\S]*?</title>\\s*',
    '<meta\\b(?=[^>]*\\bname=["\']description["\'])[^>]*>\\s*',
    '<meta\\b(?=[^>]*\\b(?:property|name)=["\'](?:og|twitter):)[^>]*>\\s*',
    '<meta\\b(?=[^>]*\\bname=["\']robots["\'])[^>]*>\\s*',
    '<link\\b(?=[^>]*\\brel=["\']canonical["\'])[^>]*>\\s*',
    '<script\\b(?=[^>]*\\btype=["\']application/ld\\+json["\'])[^>]*>[\\s\\S]*?</script>\\s*',
  ].join('|'),
  'giu',
);

export function shareShellSegments(...segments: string[]): string[] | null {
  return segments.length > 0 &&
    segments.every((segment) => segment.length <= 191 && SEGMENT.test(segment))
    ? segments
    : null;
}

/**
 * The published SPA document with link-preview tags injected. Static hosts
 * serve this file at the clean storefront URL, so crawlers read real metadata
 * without any host-level crawler rule, while browsers still boot the app.
 */
export function renderShareShell(template: string, meta: MetaTags): string {
  const cleaned = template.replace(PREVIEW_TAGS, '');
  if (!/<\/head>/iu.test(cleaned)) return cleaned;
  return cleaned.replace(/<\/head>/iu, `${renderShareHeadTags(meta)}\n</head>`);
}
