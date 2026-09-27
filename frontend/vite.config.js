import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Single source of truth for the app version: the ROOT package.json (the
// version electron-builder packages and the release tag must match). The
// settings panel and any other UI version string read __APP_VERSION__ so
// they can never drift from the release version again.
const here = path.dirname(fileURLToPath(import.meta.url));
const rootPkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
    },
  },
  base: './',
  build: {
    outDir: 'dist',
  },
});
