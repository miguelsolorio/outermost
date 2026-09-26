import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // Relative base so the build works from a GitHub Pages project subpath.
  base: './',
  plugins: [svelte()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // Generated for debugging but not linked, so browsers never fetch the maps.
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      // three.js in its own chunk stays cached across app deploys.
      output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] } },
    },
  },
  server: { port: 5173 },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/factcheck/**/*.test.ts', 'tests/assets/**/*.test.ts'],
    environment: 'node',
  },
});
