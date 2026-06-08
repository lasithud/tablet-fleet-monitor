import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server runs on :5173 (PRD §14). The frontend talks to the backend at
// http://localhost:3001 directly (CORS is open on the backend), so no proxy is
// strictly required — but one is provided for /api in case you want to serve
// the built frontend from the same origin later.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
