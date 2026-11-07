import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testMatch: ['spike/*.spec.mjs', 'test/e2e/*.spec.mjs'],
  // A14 builds a ~70 MB presentation and records measurements; run it on purpose:
  // PDE_A14=1 scripts/e2e.sh test/e2e/a14
  testIgnore: process.env.PDE_A14 ? [] : ['test/e2e/a14-*.spec.mjs'],
  reporter: [['list']],
  timeout: 120000,
  expect: { timeout: 10000 },
  use: { acceptDownloads: true },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
