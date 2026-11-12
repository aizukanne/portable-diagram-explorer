// S7 (#16): presentations viewed inside another site's viewer. The host pages are
// written by `build --test` (test/e2e/harness/host-wrapper.mjs) under dist/test/.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const { FRAME_SCRIPT_HASH, FRAME_START_DEADLINE_MS } = JSON.parse(readFileSync(path.resolve('dist/test/constants.json'), 'utf8'));
const P = (f) => pathToFileURL(path.resolve('dist/test', f)).href;
const host = (page, f) => page.goto(P(f));
const inner = (page) => page.frameLocator('iframe').first();

// The refusal wording differs per engine (measured in the Playwright 1.64.1 containers):
//   Chromium  "Executing inline script violates the following Content Security Policy directive ... a hash ('sha256-...')"
//   Firefox   "Content-Security-Policy: The page's settings blocked an inline script ... Consider using a hash ('sha256-...')"
//   WebKit    "Refused to execute a script because its hash, its nonce, or 'unsafe-inline' does not appear ..." (no hash given)
// Chromium and Firefox name the refused script's hash, so the frame's own hash is asserted.
// WebKit does not, so there the guard asserts the refusal happened AFTER the click (the
// presentation's own script had already run, being the one that opened the modal) and
// that the frame never rendered anything.
const REFUSAL = /Content[ -]Security[ -]Policy|Refused to execute a script/i;

test('the harness reproduces #16 before the fix (run once in Step 6, then keep as a guard)', async ({ page, browserName }) => {
  const violations = [];
  page.on('console', (m) => { if (REFUSAL.test(m.text())) violations.push(m.text()); });
  await host(page, 'hosted-hash-only.html');
  expect(violations, 'the presentation itself must run under the host policy').toEqual([]);
  await inner(page).locator('.pde-root-view rect.pde-hotspot').first().click();
  if (browserName === 'webkit') {
    await expect.poll(() => violations.length, { message: 'no CSP refusal seen' }).toBeGreaterThan(0);
  } else {
    await expect.poll(() => violations.some((v) => v.includes(FRAME_SCRIPT_HASH)), { message: violations.join('\n') }).toBe(true); // the frame's own hash is the one refused
  }
  // Whatever the fix does, the sealed frame itself must not have rendered anything.
  await expect(inner(page).frameLocator('iframe.pde-frame').locator('.pde-image')).toHaveCount(0);
});

test('A25 (H1 model): host nonce is passed on; drill-down renders in the sealed frame', async ({ page }) => {
  await host(page, 'hosted-nonce.html');
  await inner(page).locator('.pde-root-view rect.pde-hotspot').first().click();
  await expect(inner(page).frameLocator('iframe.pde-frame').locator('.pde-image')).toBeVisible();
  await expect(inner(page).locator('.pde-host-notice')).toContainText('For the full experience, download the file');
  await expect(inner(page).locator('.pde-host-notice')).not.toContainText('reduced isolation');
  await expect(inner(page).locator('.pde-inpage-scene')).toHaveCount(0);
});

test('bridge: a frame that never sends READY triggers onStartFailed within the deadline', async ({ page }) => {
  await page.goto(P('bridge-harness.html') + '?broken');
  await expect.poll(() => page.evaluate(() => window.__startFailedAt), { timeout: FRAME_START_DEADLINE_MS + 5000 }).toBeTruthy();
  // The pending render is rejected as "start failed", not as an error the viewer would announce.
  expect(await page.evaluate(() => window.__renderRejection)).toEqual({ startFailed: true });
});

test('bridge: a healthy frame does not trigger onStartFailed', async ({ page }) => {
  await page.goto(P('bridge-harness.html'));
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await page.waitForTimeout(FRAME_START_DEADLINE_MS + 500);
  expect(await page.evaluate(() => window.__startFailedAt)).toBe(0);
});

for (const f of ['hosted-hash-only.html']) {
  test(`A26: frame cannot start (${f}) -> in-page fallback within the deadline, notice says so`, async ({ page }) => {
    await host(page, f);
    const t0 = Date.now();
    await inner(page).locator('.pde-root-view rect.pde-hotspot').first().click();
    await expect(inner(page).locator('.pde-modal .pde-inpage-scene .pde-image')).toBeVisible({ timeout: FRAME_START_DEADLINE_MS + 5000 });
    expect(Date.now() - t0).toBeLessThan(FRAME_START_DEADLINE_MS + 5000);
    await expect(inner(page).locator('.pde-host-notice')).toContainText('Drill-down diagrams are being shown with reduced isolation.');
    await expect(inner(page).locator('.pde-host-notice')).toContainText('For the full experience, download the file');
    // The sealed frame is gone for the session.
    await expect(inner(page).locator('iframe.pde-frame')).toHaveCount(0);
    // Navigation still works in the fallback: Back, breadcrumbs, and going deeper.
    await expect(inner(page).locator('.pde-modal-title')).toHaveText('Identity HLD');
    await inner(page).locator('.pde-inpage-scene rect.pde-hotspot[aria-label="Account association"]').click();
    await expect(inner(page).locator('.pde-modal-title')).toHaveText('Account association LLD');
    await inner(page).getByRole('button', { name: 'Back', exact: true }).click();
    await expect(inner(page).locator('.pde-modal-title')).toHaveText('Identity HLD');
    await inner(page).locator('.pde-modal .pde-crumbs button').first().click(); // the first crumb returns to the overview
    await expect(inner(page).locator('.pde-modal-layer')).toBeHidden();
    // Reopening in the same session stays in the fallback and renders at once.
    await inner(page).locator('.pde-root-view rect.pde-hotspot').first().click();
    await expect(inner(page).locator('.pde-modal .pde-inpage-scene .pde-image')).toBeVisible();
    await inner(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(inner(page).locator('.pde-modal-layer')).toBeHidden();
  });
}

test('A26b: in the fallback the slide keys reach the viewer exactly once, and Escape closes the drill-down', async ({ page }) => {
  await host(page, 'hosted-hash-only-slides.html');
  const slideLabel = inner(page).locator('.pde-slide-count');
  await expect(slideLabel).toHaveText('');
  await inner(page).locator('.pde-root-view rect.pde-hotspot').first().click();
  const scene = inner(page).locator('.pde-modal .pde-inpage-scene');
  await expect(scene.locator('.pde-image')).toBeVisible({ timeout: FRAME_START_DEADLINE_MS + 5000 });
  await scene.locator('rect.pde-hotspot').first().focus();
  await page.keyboard.press('Escape'); // the first Escape only hides the focus tooltip, in the frame and in the page alike
  await page.keyboard.press('Escape');
  await expect(inner(page).locator('.pde-modal-layer')).toBeHidden();
  // Reopen, then step a slide from inside the in-page scene: one key, one slide.
  await inner(page).locator('.pde-root-view rect.pde-hotspot').first().click();
  await expect(scene.locator('.pde-image')).toBeVisible();
  await scene.locator('rect.pde-hotspot').first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(inner(page).locator('.pde-modal-layer')).toBeHidden();
  // The overview is not in this running order, so the label starts empty; one key is one step.
  await expect(slideLabel).toHaveText('1 of 3');
});

test('A27: no notice on file:// or in the editor preview; Dismiss hides it', async ({ page }) => {
  await page.goto(P('viewer-fixture.presentation.html'));
  await expect(page.locator('.pde-root-view')).toBeVisible();
  await expect(page.locator('.pde-host-notice')).toHaveCount(0);
  await host(page, 'hosted-nonce.html');
  await inner(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(inner(page).locator('.pde-host-notice')).toHaveCount(0);
});

test('A26c: a notice dismissed earlier comes back when the fallback changes the isolation state', async ({ page }) => {
  await host(page, 'hosted-hash-only.html');
  await inner(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(inner(page).locator('.pde-host-notice')).toHaveCount(0);
  await inner(page).locator('.pde-root-view rect.pde-hotspot').first().click();
  await expect(inner(page).locator('.pde-host-notice')).toContainText('reduced isolation', { timeout: FRAME_START_DEADLINE_MS + 5000 });
});

test('Review focus 4: a malformed nonce is ignored, the frame starts as on file://', async ({ page }) => {
  // The host nonce is `a" onload="x`: the stamped attribute must not appear, and nothing runs.
  await host(page, 'hosted-bad-nonce.html');
  await inner(page).locator('.pde-root-view rect.pde-hotspot').first().click();
  await expect(inner(page).locator('.pde-host-notice')).toContainText('reduced isolation', { timeout: FRAME_START_DEADLINE_MS + 5000 }); // fallback, nonce refused
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  expect(await inner(page).locator('body').evaluate(() => window.top.pwned)).toBeUndefined();
});
