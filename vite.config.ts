import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  build: {
    // React + Motion make up most of the main bundle; that's expected here.
    chunkSizeWarningLimit: 700,
  },
});
