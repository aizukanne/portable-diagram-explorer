import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testMatch: ['spike/frame-ready/*.spec.mjs'],
  reporter: [['list']],
  timeout: 1800000,
  expect: { timeout: 10000 },
  workers: 1,
  // Keep the default test-results/ (which holds the A14 envelope) out of Playwright's start-of-run wipe.
  outputDir: 'spike/frame-ready/out/pw-results',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
