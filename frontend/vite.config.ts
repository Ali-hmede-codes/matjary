import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLocalFrontendRequest } from './src/lib/website';

// These files keep their public names across releases. Hashing their bytes
// gives every change a new URL, which is the only reliable way to evict a
// favicon or logo a browser has already cached under the previous URL.
const BRANDING_FILES = [
  'apple-touch-icon.png',
  'favicon-96x96.png',
  'favicon.ico',
  'favicon.svg',
  'logo.png',
  'site.webmanifest',
  'web-app-manifest-192x192.png',
  'web-app-manifest-512x512.png',
] as const;

function brandingVersion(publicDir: string): string {
  const hash = createHash('sha256');
  for (const file of BRANDING_FILES) {
    hash.update(file);
    const path = resolve(publicDir, file);
    if (existsSync(path)) hash.update(readFileSync(path));
  }
  return hash.digest('hex').slice(0, 12);
}

function versioned(path: string, version: string): string {
  const url = new URL(path, 'https://matjary.invalid');
  url.searchParams.set('v', version);
  return `${url.pathname}${url.search}${url.hash}`;
}

function brandingAssets(version: string): Plugin {
  let outDir = '';
  return {
    name: 'matjary-branding-assets',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml(html) {
      // The manifest link is versioned as well: a cached manifest would keep
      // pointing at the previous icon URLs even when the HTML is fresh.
      return html
        .replaceAll(
          '/favicon-96x96.png',
          versioned('/favicon-96x96.png', version),
        )
        .replaceAll('/favicon.ico', versioned('/favicon.ico', version))
        .replaceAll('/favicon.svg', versioned('/favicon.svg', version))
        .replaceAll(
          '/apple-touch-icon.png',
          versioned('/apple-touch-icon.png', version),
        )
        .replaceAll(
          '/site.webmanifest',
          versioned('/site.webmanifest', version),
        );
    },
    // Public files are copied verbatim, so rewrite the emitted manifest too;
    // otherwise an installed app icon could keep the previous branding.
    closeBundle() {
      const path = resolve(outDir, 'site.webmanifest');
      if (!existsSync(path)) return;
      try {
        const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
          icons?: { src?: unknown }[];
        };
        for (const icon of manifest.icons ?? [])
          if (typeof icon.src === 'string' && icon.src.startsWith('/'))
            icon.src = versioned(icon.src, version);
        writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
      } catch {
        // Branding must never fail an otherwise valid production build.
      }
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const branding = brandingVersion(resolve(root, 'public'));
  const env = loadEnv(mode, root, '');
  const backendOrigin = new URL(env.BACKEND_ORIGIN || 'http://localhost:3000')
    .origin;
  const apiProxy: ProxyOptions = {
    target: backendOrigin,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (outgoing, incoming) => {
        // Bridge only same-origin loopback previews; production CSRF checks stay intact.
        if (
          ['localhost', '127.0.0.1', '[::1]'].includes(
            new URL(backendOrigin).hostname,
          ) &&
          isLocalFrontendRequest(incoming.headers.origin, incoming.headers.host)
        ) {
          outgoing.setHeader('Origin', backendOrigin);
        }
      });
    },
  };

  return {
    plugins: [react(), brandingAssets(branding)],
    // Only this public origin is exposed; backend secrets never enter the bundle.
    define: {
      __DEV_BACKEND_ORIGIN__: JSON.stringify(
        command === 'serve' ? backendOrigin : null,
      ),
      __BRANDING_VERSION__: JSON.stringify(branding),
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': apiProxy,
      },
    },
    preview: {
      port: 4173,
      strictPort: true,
      proxy: {
        '/api': apiProxy,
      },
    },
  };
});
