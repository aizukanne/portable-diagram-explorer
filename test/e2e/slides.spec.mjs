// S4: presentation slides — Previous/Next, counter, keys, jump list, Home, Back to slide.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const P = (f) => pathToFileURL(path.resolve('dist/test', f)).href;
const count = (page) => page.locator('.pde-slide-count');
const pageCrumbs = (page) => page.locator('.pde-toolbar .pde-crumbs');

test('A20: no sequence, no slide controls', async ({ page }) => {
  await page.goto(P('viewer-fixture.presentation.html'));
  await expect(page.locator('.pde-slidebar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Home' })).toHaveCount(0);
  // A20: slide keys keep their browser defaults when there is no running order.
  await page.evaluate(() => { window.__prevented = []; window.addEventListener('keydown', (e) => window.__prevented.push([e.key, e.defaultPrevented])); });
  await page.locator('.pde-root-view rect.pde-hotspot').first().focus();
  for (const k of ['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp']) await page.keyboard.press(k);
  const seen = await page.evaluate(() => window.__prevented.filter(([k]) => /^(Arrow(Left|Right)|Page(Up|Down))$/.test(k)));
  expect(seen.length).toBe(4);
  expect(seen.every(([, prevented]) => prevented === false)).toBe(true);
});

test('A16: buttons and keys step through; ends stop and say so', async ({ page }) => {
  await page.goto(P('slides.presentation.html'));
  await expect(count(page)).toHaveText('');            // overview is not a slide
  await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(count(page)).toHaveText('1 of 3');
  await expect(pageCrumbs(page)).toContainText('Slide 1 of 3');
  await expect(pageCrumbs(page)).toContainText('Loop A');
  await page.keyboard.press('PageDown'); await page.keyboard.press('ArrowRight');
  await expect(count(page)).toHaveText('3 of 3');
  await expect(page.locator('.pde-last-slide')).toHaveText('Last slide');
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  await page.keyboard.press('ArrowRight'); await expect(count(page)).toHaveText('3 of 3');
  await page.keyboard.press('PageUp'); await expect(count(page)).toHaveText('2 of 3');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  await expect(count(page)).toHaveText('1 of 3');
  await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();
});

test('A17: Next from three levels deep resumes the sequence; focus and announcement', async ({ page }) => {
  await page.goto(P('slides.presentation.html'));
  await page.getByRole('button', { name: 'Next' }).click();             // 1 of 3: Loop A
  await page.locator('.pde-root-view rect.pde-hotspot[aria-label="To B"]').click();          // level 1: B
  await page.frameLocator('iframe').getByRole('button', { name: 'To A', exact: true }).click(); // level 2: A
  await page.frameLocator('iframe').getByRole('button', { name: 'To B', exact: true }).click(); // level 3: B
  await expect(page.locator('.pde-modal .pde-crumbs li')).toHaveCount(4);                  // page + 3 visits
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.pde-modal-layer')).toBeHidden();
  await expect(count(page)).toHaveText('2 of 3');
  await expect(page.locator('.pde-viewer > [role=status]')).toHaveText('Slide 2 of 3: Identity HLD');
  await expect(page.locator('h1.pde-project-title')).toBeFocused();
});

test('Review focus 2: drilled into a diagram that is itself a slide, Previous counts from the last slide shown', async ({ page }) => {
  await page.goto(P('slides.presentation.html'));
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();             // 2 of 3: Identity HLD
  await page.locator('.pde-root-view rect.pde-hotspot[aria-label="Shared services"]').click(); // drills into d-shared = slide 3
  await page.keyboard.press('ArrowLeft');
  await expect(count(page)).toHaveText('1 of 3');   // before slide 2 (last shown); "relative to d-shared" would give 2 of 3
});

test('Review focus 1: Next keys do nothing while a menu or text field has focus', async ({ page }) => {
  await page.goto(P('slides.presentation.html'));
  await page.getByRole('button', { name: 'Slides' }).click();
  await page.keyboard.press('ArrowRight');
  await expect(count(page)).toHaveText('');
  await page.keyboard.press('Escape');
});

test('A18: jump list names every slide, marks the current, keyboard operable', async ({ page }) => {
  await page.goto(P('slides-with-overview.presentation.html'));
  await expect(count(page)).toHaveText('1 of 3');
  await page.getByRole('button', { name: 'Slides' }).click();
  const items = page.getByRole('menuitem');
  await expect(items).toHaveText([/Platform overview/, /Identity HLD/, /Shared services/]);
  await expect(items.nth(0)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(count(page)).toHaveText('3 of 3');
});

test('Home shows the overview; "Back to slide" closes a drill-down to the current slide', async ({ page }) => {
  await page.goto(P('slides.presentation.html'));
  await page.getByRole('button', { name: 'Next' }).click();             // 1 of 3: Loop A
  await page.locator('.pde-root-view rect.pde-hotspot[aria-label="To B"]').click();
  await page.getByRole('button', { name: 'Back to slide' }).click();
  await expect(count(page)).toHaveText('1 of 3');
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(count(page)).toHaveText('');
  await expect(pageCrumbs(page)).toContainText('Platform overview');
});

test('R4: at an end, Next/Previous inside a drill-down do nothing — the drill-down stays open', async ({ page }) => {
  await page.goto(P('slides.presentation.html'));
  await page.getByRole('button', { name: 'Next' }).click();             // 1 of 3: Loop A (first slide)
  await page.locator('.pde-root-view rect.pde-hotspot[aria-label="To B"]').click();
  await expect(page.locator('.pde-modal-layer')).toBeVisible();
  await page.frameLocator('iframe').getByRole('button', { name: 'To A', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');                               // no slide before the first
  await page.keyboard.press('PageUp');
  await page.waitForTimeout(300);
  await expect(page.locator('.pde-modal-layer')).toBeVisible();
  await expect(count(page)).toHaveText('1 of 3');
  await page.keyboard.press('ArrowRight');                              // a real step still works
  await expect(page.locator('.pde-modal-layer')).toBeHidden();
  await expect(count(page)).toHaveText('2 of 3');
});

test.describe('S5: touch swipe', () => {
  test.use({ hasTouch: true, isMobile: false });

  async function swipe(page, dx, ms = 200) {
    const box = await page.locator('.pde-root-view').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const ev = (type, px) => page.locator('.pde-root-view').dispatchEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: px, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    await ev('pointerdown', x); await page.waitForTimeout(ms / 2);
    await ev('pointermove', x + dx / 2); await ev('pointermove', x + dx); await ev('pointerup', x + dx);
  }

  test('A19: swipe left at fit zoom = Next; zoomed in, the same gesture pans', async ({ page }) => {
    await page.goto(P('slides.presentation.html'));
    await swipe(page, -120);
    await expect(count(page)).toHaveText('1 of 3');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await swipe(page, -120);
    await expect(count(page)).toHaveText('1 of 3');
    await swipe(page, 40); await expect(count(page)).toHaveText('1 of 3');     // below threshold
  });
});
