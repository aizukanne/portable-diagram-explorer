import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const url = pathToFileURL(path.resolve('spike/out/spike.html')).href;

test('portability spike over file://', async ({ page, browserName }) => {
  const external = [];
  page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && !r.url().startsWith('about:')) external.push(r.url()); });
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => window.__spike.sceneReady && window.__spike.frameNetworkBlocked !== undefined && window.__spike.deflateRoundTrip !== undefined && window.__spike.parentNetworkBlocked !== undefined), { timeout: 15000 }).toBeTruthy();
  const frame = page.frameLocator('iframe');
  await frame.locator('body').click();
  await frame.locator('body').press('Escape');
  await expect.poll(() => page.evaluate(() => !!(window.__spike.activated && window.__spike.escapeForwarded))).toBeTruthy();
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);
  const r = await page.evaluate(() => window.__spike);
  r.download = download.suggestedFilename();
  console.log(browserName, JSON.stringify(r));
  console.log(browserName, 'external requests:', JSON.stringify(external));
  expect(r.ready).toBe(true);
  expect(r.sceneReady.w).toBe(1);
  expect(r.childRejectedWrongChannel).toBe(true);
  expect(r.activated).toBe('h1');
  expect(r.escapeForwarded).toBe(true);
  expect(r.frameNetworkBlocked).toBe(true);
  expect(r.parentNetworkBlocked).toBe(true);
  expect(r.parentBlobImage).toBe(true);
  expect(r.deflateRoundTrip).toBe(true);
  expect(r.inert).toBe(true);
  expect(r.download).toBe('spike.txt');
});
