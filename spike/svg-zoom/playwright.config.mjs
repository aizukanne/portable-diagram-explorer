import { defineConfig, devices } from '@playwright/test';

// Spike config: only spike/svg-zoom/*.spec.mjs. Run: PW_CONFIG=spike/svg-zoom/playwright.config.mjs scripts/e2e.sh
// deviceScaleFactor is forced to 1 so every engine is measured at the same device pixel ratio
// (Playwright's Desktop Safari profile defaults to 2).
export default defineConfig({
  testMatch: ['spike/svg-zoom/*.spec.mjs'],
  testDir: '../..',
  reporter: [['list']],
  workers: 1,
  timeout: 600000,
  expect: { timeout: 10000 },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], deviceScaleFactor: 1 } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], deviceScaleFactor: 1 } },
  ],
});
