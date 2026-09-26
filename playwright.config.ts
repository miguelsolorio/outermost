import { defineConfig } from '@playwright/test';

// Smoke and journey tests against a production build (npm run build first).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    // WebKit has no EXT_clip_control, which exercises the logarithmic depth fallback.
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
