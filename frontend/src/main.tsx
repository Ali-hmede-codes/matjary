import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/dm-sans';
// Arabic-script coverage for owner-written names and captions. The two families
// share the stack, so each glyph comes from the first font that has it and the
// Cairo files are only downloaded when Arabic text actually appears.
import '@fontsource-variable/cairo';
import App from './App';
import { applyLanguage, storedLanguage } from './lib/language';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
