import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ command, mode }) => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const env = loadEnv(mode, root, '');
  const backendOrigin = new URL(env.BACKEND_ORIGIN || 'http://localhost:3000')
    .origin;

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
        '/api': { target: backendOrigin, changeOrigin: true },
      },
    },
    preview: {
      port: 4173,
      strictPort: true,
      proxy: {
        '/api': { target: backendOrigin, changeOrigin: true },
      },
    },
  };
});
