import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testMatch: ['spike/a29/*.spec.mjs'],
  reporter: [['list']],
  timeout: 180000,
  expect: { timeout: 10000 },
  workers: 1,
  use: { acceptDownloads: true },
  outputDir: 'spike/a29/out/pw-results',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
