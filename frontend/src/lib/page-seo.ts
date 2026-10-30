export interface PageSeoInput {
  title: string;
  description?: string | null;
  image?: string | null;
  canonical?: string;
  type?: string;
  siteName?: string;
  robots?: string;
  keywords?: string;
  verificationMeta?: string[];
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  og?: {
    title: string;
    description: string;
    image?: string;
    type: string;
    siteName?: string;
    url: string;
    locale?: string;
  };
  twitter?: {
    title: string;
    description: string;
    image?: string;
    card: string;
    site?: string;
    creator?: string;
  };
}

/** Replace the previous route's head, including tags from a static shell. */
export function applyPageSeo(
  document: Document,
  value: PageSeoInput,
  origin: string,
  pathname: string,
): () => void {
  const head = document.head;
  const absolute = (url: string) => new URL(url, origin).href;
  const canonical = absolute(value.canonical ?? pathname);
  const image = value.og?.image ?? value.image;
  const twitterImage = value.twitter?.image ?? image;
  // A single description matters: some clients select the first, others the
  // last. Never restore the initial build's old title when a route unmounts.
  for (const node of head.querySelectorAll(
    'meta[name="description"], meta[name="keywords"], meta[name="google-site-verification"], meta[name="msvalidate.01"], meta[name="yandex-verification"], meta[property^="og:"], meta[name^="twitter:"], meta[name="robots"], link[rel="canonical"], script[type="application/ld+json"]',
  ))
    node.remove();
  const nodes: Element[] = [];
  const track = <T extends Element>(node: T): T => {
    node.setAttribute('data-matjary-seo', '');
    head.appendChild(node);
    nodes.push(node);
    return node;
  };
  const meta = (attribute: string, name: string, content?: string | null) => {
    if (!content) return;
    const node = track(document.createElement('meta'));
    node.setAttribute(attribute, name);
    node.setAttribute('content', content);
  };
  // The API exposes legacy verification markup. Accept only its documented
  // names/token syntax and create elements; never insert response HTML.
  for (const tag of value.verificationMeta ?? []) {
    const match =
      /^<meta name="(google-site-verification|msvalidate\.01|yandex-verification)" content="([A-Za-z0-9_-]+)">$/u.exec(
        tag,
      );
    if (match?.[1] && match[2]) meta('name', match[1], match[2]);
  }
  document.title = value.title;
  meta('name', 'description', value.description);
  meta('name', 'keywords', value.keywords);
  meta('name', 'robots', value.robots ?? 'index, follow');
  meta('property', 'og:type', value.og?.type ?? value.type ?? 'website');
  meta('property', 'og:title', value.og?.title ?? value.title);
  meta(
    'property',
    'og:description',
    value.og?.description ?? value.description,
  );
  meta('property', 'og:url', value.og?.url ?? canonical);
  meta('property', 'og:site_name', value.og?.siteName ?? value.siteName);
  meta('property', 'og:locale', value.og?.locale);
  meta('property', 'og:image', image ? absolute(image) : null);
  meta(
    'name',
    'twitter:card',
    value.twitter?.card ?? (image ? 'summary_large_image' : 'summary'),
  );
  meta('name', 'twitter:title', value.twitter?.title ?? value.title);
  meta(
    'name',
    'twitter:description',
    value.twitter?.description ?? value.description,
  );
  meta('name', 'twitter:image', twitterImage ? absolute(twitterImage) : null);
  meta('name', 'twitter:site', value.twitter?.site);
  meta('name', 'twitter:creator', value.twitter?.creator);
  const link = track(document.createElement('link'));
  link.setAttribute('rel', 'canonical');
  link.setAttribute('href', canonical);
  if (value.jsonLd) {
    const script = track(document.createElement('script'));
    script.setAttribute('type', 'application/ld+json');
    script.textContent = JSON.stringify(value.jsonLd);
  }
  // Only remove this render's nodes: an older request/route must not tear down
  // metadata that the next route has already installed.
  return () => {
    for (const node of nodes) node.remove();
  };
}
