import { useEffect, useRef } from 'react';

export interface PageSeoInput {
  title: string;
  description?: string | null;
  /** Absolute URL or a same-origin path; resolved against the current origin. */
  image?: string | null;
  canonical?: string;
  type?: 'website' | 'product' | 'article';
  siteName?: string;
  robots?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

function absoluteUrl(value: string): string {
  try {
    return new URL(value, window.location.origin).href;
  } catch {
    return value;
  }
}

/**
 * Keeps the document head in sync with the current storefront page. Social
 * crawlers that execute JavaScript and browser share sheets read these tags;
 * crawlers that do not are served by the API's share endpoint.
 */
export function usePageSeo(input: PageSeoInput | null | undefined) {
  // The serialized value keeps the effect stable across re-renders that pass
  // an equivalent object (builders run on every render).
  const key = input ? JSON.stringify(input) : '';
  const latest = useRef(input);
  latest.current = input;
  useEffect(() => {
    const value = latest.current;
    if (!value) return;
    const head = document.head;
    const previousTitle = document.title;
    const descriptionTag = head.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    const previousDescription = descriptionTag?.content;
    const nodes: Element[] = [];

    // Prerendered share shells already carry preview tags. Replace them so the
    // live document never ends up with two sets of crawler metadata.
    for (const node of head.querySelectorAll(
      'meta[property^="og:"], meta[name^="twitter:"], meta[name="robots"], link[rel="canonical"]',
    )) {
      if (!node.hasAttribute('data-matjary-seo')) node.remove();
    }

    const track = <T extends Element>(node: T): T => {
      node.setAttribute('data-matjary-seo', '');
      head.appendChild(node);
      nodes.push(node);
      return node;
    };
    const meta = (
      attribute: 'name' | 'property',
      name: string,
      content: string | null | undefined,
    ) => {
      if (!content) return;
      const element = track(document.createElement('meta'));
      element.setAttribute(attribute, name);
      element.setAttribute('content', content);
    };

    const canonical = absoluteUrl(
      value.canonical ?? window.location.pathname + window.location.search,
    );
    const image = value.image ? absoluteUrl(value.image) : null;
    descriptionTag?.setAttribute('content', value.description ?? '');

    document.title = value.title;
    meta('name', 'description', value.description);
    meta('name', 'robots', value.robots ?? 'index, follow');
    meta('property', 'og:type', value.type ?? 'website');
    meta('property', 'og:title', value.title);
    meta('property', 'og:description', value.description);
    meta('property', 'og:url', canonical);
    meta('property', 'og:site_name', value.siteName);
    meta('property', 'og:image', image);
    meta('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    meta('name', 'twitter:title', value.title);
    meta('name', 'twitter:description', value.description);
    meta('name', 'twitter:image', image);

    const link = track(document.createElement('link'));
    link.setAttribute('rel', 'canonical');
    link.setAttribute('href', canonical);

    if (value.jsonLd) {
      const script = track(document.createElement('script'));
      script.setAttribute('type', 'application/ld+json');
      script.textContent = JSON.stringify(value.jsonLd);
    }

    return () => {
      for (const node of nodes) node.remove();
      document.title = previousTitle;
      if (descriptionTag && previousDescription !== undefined)
        descriptionTag.setAttribute('content', previousDescription);
    };
  }, [key]);
}
