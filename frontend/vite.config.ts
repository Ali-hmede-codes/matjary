import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { isLocalFrontendRequest } from './src/lib/website';

export default defineConfig(({ command, mode }) => {
  const root = fileURLToPath(new URL('.', import.meta.url));
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
    plugins: [react()],
    // Only this public origin is exposed; backend secrets never enter the bundle.
    define: {
      __DEV_BACKEND_ORIGIN__: JSON.stringify(
        command === 'serve' ? backendOrigin : null,
      ),
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
