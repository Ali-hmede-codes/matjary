import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { getJson } from '../lib/api';
import { applyPageSeo, type PageSeoInput } from '../lib/page-seo';
export type { PageSeoInput } from '../lib/page-seo';

/** Browser tabs and share crawlers resolve the same saved page metadata. */
export function usePageSeo(input: PageSeoInput | null | undefined) {
  const { pathname, search } = useLocation();
  const demo = new URLSearchParams(search).get('demo') === '1';
  const publicPage =
    /^\/(?:$|shops\/?$|pricing\/?$|terms\/?$|privacy\/?$|favorites\/?$|stores\/|post\/)/u.test(
      pathname,
    );
  const enabled = !!input && publicPage && !demo;
  const seo = useQuery({
    queryKey: ['page-seo', pathname],
    queryFn: ({ signal }) =>
      getJson<PageSeoInput>(
        `seo/meta/page?path=${encodeURIComponent(pathname)}`,
        signal,
      ),
    enabled,
    staleTime: 0,
    refetchInterval: 300_000,
    retry: false,
  });
  // Do not merge fallback images into server metadata: a removed or private
  // image must disappear when the server deliberately returns no OG image.
  const value = enabled && seo.data ? seo.data : input;
  const key = value ? JSON.stringify(value) : '';
  useEffect(() => {
    if (!key) return;
    return applyPageSeo(
      document,
      JSON.parse(key) as PageSeoInput,
      window.location.origin,
      pathname,
    );
  }, [key, pathname]);
}
