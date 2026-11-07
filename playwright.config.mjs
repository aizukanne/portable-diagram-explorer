import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testMatch: ['spike/*.spec.mjs', 'test/e2e/*.spec.mjs'],
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
