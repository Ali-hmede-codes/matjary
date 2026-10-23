import { useEffect, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { assetUrl, getJson } from '../lib/api';
import { contrastColor, defaults, normalizeSettings } from '../lib/website';

export function useWebsiteSettings() {
  const settingsQuery = useQuery({
    queryKey: ['website-settings'],
    queryFn: async ({ signal }) =>
      normalizeSettings(await getJson<unknown>('settings/website', signal)),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const settings = settingsQuery.data ?? defaults;
  useEffect(() => {
    document.title = `${settings.siteName} — ${settings.tagline || 'Discover something good'}`;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        settings.description ||
          'Discover independent stores, beautiful finds, and everyday inspiration.',
      );
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', settings.primaryColor);
    document
      .getElementById('site-favicon')
      ?.setAttribute('href', assetUrl(settings.faviconUrl) || '/favicon.svg');
  }, [settings]);
  const theme = {
    '--brand-primary': settings.primaryColor,
    '--brand-secondary': settings.secondaryColor,
    '--brand-surface': settings.backgroundColor,
    '--brand-ink': settings.textColor,
    '--brand-on-primary': contrastColor(settings.primaryColor),
  } as CSSProperties;
  return { settingsQuery, settings, theme };
}
