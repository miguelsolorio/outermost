import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // Relative base so the build works from a GitHub Pages project subpath.
  base: './',
  plugins: [svelte()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
  server: { port: 5173 },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/factcheck/**/*.test.ts', 'tests/assets/**/*.test.ts'],
    environment: 'node',
  },
});
