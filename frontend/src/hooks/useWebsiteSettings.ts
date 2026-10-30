import { useEffect, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { assetUrl, getJson } from '../lib/api';
import {
  brandingUrl,
  cacheSettings,
  contrastColor,
  defaults,
  normalizeSettings,
  readSettingsCache,
} from '../lib/website';
import { setBrandName } from '../lib/language';

export function useWebsiteSettings(applyMetadata = true, enabled = true) {
  // Read the snapshot once per mount; storage parsing must not run per render.
  const [cached] = useState(readSettingsCache);
  const settingsQuery = useQuery({
    queryKey: ['website-settings'],
    queryFn: async ({ signal }) => {
      const settings = normalizeSettings(
        await getJson<unknown>('settings/website', signal),
      );
      // Only a real API answer refreshes the pre-paint snapshot; re-saving
      // `initialData` would make a stale name look freshly confirmed.
      cacheSettings(settings);
      return settings;
    },
    // Paint the last known branding immediately instead of the build-time
    // defaults, then revalidate as soon as that snapshot is stale.
    initialData: cached?.values,
    initialDataUpdatedAt: cached?.savedAt,
    staleTime: 30_000,
    // Branding changes are rare; a five-minute refresh keeps every open tab in
    // sync without a per-minute request from every visitor.
    refetchInterval: 300_000,
    enabled,
  });
  const settings = settingsQuery.data ?? defaults;
  useEffect(() => {
    // The translation widget must keep the administrator's name, not the
    // build-time one, when it restores transliterated brand text.
    setBrandName(settings.siteName);
  }, [settings.siteName]);
  useEffect(() => {
    if (!applyMetadata) return;
    // Page SEO owns titles/descriptions; a branding refetch must not replace
    // the current shop or product's metadata with the home page defaults.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', settings.primaryColor);
    document
      .getElementById('site-favicon')
      ?.setAttribute(
        'href',
        brandingUrl(assetUrl(settings.faviconUrl) || '/favicon.svg') ||
          '/favicon.svg',
      );
  }, [settings, applyMetadata]);
  const theme = {
    '--brand-primary': settings.primaryColor,
    '--brand-secondary': settings.secondaryColor,
    '--brand-surface': settings.backgroundColor,
    '--brand-ink': settings.textColor,
    '--brand-on-primary': contrastColor(settings.primaryColor),
  } as CSSProperties;
  return { settingsQuery, settings, theme };
}
