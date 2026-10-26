import type { MetaTags } from './seo.service';
import { renderShareHeadTags } from './share-document';

// Storefront URLs only ever contain lower-case slug segments. Validating every
// segment keeps file writes inside the mounted share directory.
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

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
  const cleaned = template
    .replace(/<title>[\s\S]*?<\/title>\s*/iu, '')
    .replace(/<meta\s+name=["']description["'][^>]*>\s*/iu, '');
  if (!/<\/head>/iu.test(cleaned)) return cleaned;
  return cleaned.replace(/<\/head>/iu, `${renderShareHeadTags(meta)}\n</head>`);
}
