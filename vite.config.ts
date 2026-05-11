import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Renderer-only Vite config. Electron main/preload are not bundled by Vite —
// they are plain CommonJS files in the `electron/` folder loaded directly.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome120',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  clearScreen: false,
});
