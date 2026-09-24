import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The browser only ever talks to :5173; API calls are proxied to Express.
    // This keeps the login cookie same-origin (no CORS / third-party cookie issues).
    proxy: { '/api': { target: 'http://localhost:5000', changeOrigin: true } },
  },
  build: { outDir: 'dist' },
});
