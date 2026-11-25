import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/cairo';
import '../styles.css';
import '../components/storefront.css';
import './preview.css';
import { PreviewApp } from './PreviewApp';

// Developer bench, not a build entry: `npm run dev` serves it at
// /category-preview.html and no production bundle imports this module.
const params = new URLSearchParams(window.location.search);
// ?dir=rtl previews the mirrored Arabic storefront, including the curated
// "Learn more" wording.
if (params.get('dir') === 'rtl') {
  document.documentElement.dir = 'rtl';
  document.documentElement.lang = 'ar';
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
);
