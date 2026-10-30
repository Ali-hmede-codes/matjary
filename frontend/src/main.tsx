import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/dm-sans';
// Arabic-script coverage for owner-written names and captions. The two families
// share the stack, so each glyph comes from the first font that has it and the
// Cairo files are only downloaded when Arabic text actually appears.
import '@fontsource-variable/cairo';
import App from './App';
import { getJson } from './lib/api';
import { applyLanguage, storedLanguage } from './lib/language';
import {
  cacheSettings,
  normalizeSettings,
  readSettingsCache,
} from './lib/website';
import './styles.css';

// Resolve the saved language before the first render: <html dir> has to be set
// before the browser lays out the page, and the translate widget reads its
// googtrans cookie when it initializes later in the session.
applyLanguage(storedLanguage());

const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: true },
  },
});

// The static HTML only carries generic copy. Load the live branding before the
// first React paint so a renamed site never flashes the build-time name. A
// cached snapshot is only a fallback for a slow network; the API always wins
// when it answers in time and updates the open tab when it answers later.
async function refreshBranding(): Promise<void> {
  try {
    const settings = normalizeSettings(
      await getJson<unknown>('settings/website'),
    );
    cacheSettings(settings);
    client.setQueryData(['website-settings'], settings);
  } catch {
    // The settings hook retries and falls back to the cached/default values.
  }
}

const cached = readSettingsCache();
void Promise.race([
  refreshBranding(),
  new Promise((resolve) => window.setTimeout(resolve, cached ? 1000 : 2000)),
]).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
});
