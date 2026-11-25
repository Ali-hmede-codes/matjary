import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/cairo';
import '../styles.css';
import '../components/storefront.css';
import '../components/ShopCart.css';
import './preview.css';
import { Embed } from './Embed';
import { PreviewApp } from './PreviewApp';

// The whole page is a developer tool. It is not a Vite build entry, so it never
// ships to production; `npm run dev` serves it at /catalog-preview.html.
const params = new URLSearchParams(window.location.search);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {params.get('embed') === '1' ? (
      <Embed params={params} />
    ) : (
      <PreviewApp params={params} />
    )}
  </StrictMode>,
);
