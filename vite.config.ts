import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'src/web/ui',
  build: { outDir: '../../../dist/ui', emptyOutDir: true },
  server: {
    proxy: {
      '/api': {
        // The API server binds to 127.0.0.1 by default; target it directly
        // (`localhost` may resolve to ::1 first and miss it).
        target: 'http://127.0.0.1:3000',
        // Keep the browser's Host (localhost:5173) so it still matches the
        // Origin header — the API server rejects cross-origin mutations.
        changeOrigin: false,
      },
    },
  },
});
