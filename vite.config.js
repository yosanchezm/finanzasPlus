import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // The pure debt core lives outside src/ (Nia imports it by relative path instead).
    alias: { '@finance-core': fileURLToPath(new URL('./packages/finance-core', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
    // Lazy-loaded views import slowly in jsdom when every file runs in parallel.
    testTimeout: 15000,
  },
});
