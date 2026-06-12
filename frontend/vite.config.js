import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server runs on :5173. The dashboard uses same-origin URLs (matching the
// hosted deployment), so we proxy /api and the /ws WebSocket through to the
// backend on :3001 during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
