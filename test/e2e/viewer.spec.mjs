// S08: the presentation shell, against a presentation produced by the real
// export path (dist/test/viewer-fixture.presentation.html), opened via file://.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const FIXTURE = path.resolve('dist/test/viewer-fixture.presentation.html');

async function open(page, file = FIXTURE) {
  const external = [];
  page.on('request', (r) => { if (!/^(file|data|blob|about):/.test(r.url())) external.push(r.url()); });
  await page.goto(pathToFileURL(file).href);
  await expect(root(page, 'Identity service')).toBeVisible();
  return external;
}
const root = (page, name) => page.locator(`.pde-root-view rect.pde-hotspot[aria-label="${name}"]`);
const frame = (page) => page.frameLocator('iframe.pde-frame');
const inFrame = (page, name) => frame(page).getByRole('button', { name, exact: true });
const modalTitle = (page) => page.locator('.pde-modal-title');
const crumbs = (page) => page.locator('.pde-modal .pde-crumbs li');
// The label of the hotspot focused inside the frame, only if the frame's window
// really holds keyboard focus (an element can be active in an unfocused window).
async function frameFocus(page) {
  const f = page.frames().find((x) => x !== page.mainFrame());
  if (!f) return null;
  return f.evaluate(() => (document.hasFocus() && document.activeElement ? document.activeElement.getAttribute('aria-label') : null)).catch(() => null);
}
async function tabIntoFrame(page, max = 25) {
  for (let i = 0; i < max; i++) {
    if (await frameFocus(page)) return;
    await page.keyboard.press('Tab');
  }
}
async function crumbTexts(page) { return (await crumbs(page).allTextContents()).map((s) => s.trim()); }
async function frameBox(page, name) {
  return frame(page).locator(`rect.pde-hotspot[aria-label="${name}"]`).evaluate((el) => {
    const m = el.getScreenCTM();
    return { x: Math.round(m.e + m.a * +el.getAttribute('x')), y: Math.round(m.f + m.d * +el.getAttribute('y')), s: +m.a.toFixed(4) };
  });
}
// Wait two animation frames so layout-driven updates (ResizeObserver) have landed.
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function rootBox(page, name) {
  await settle(page);
  return root(page, name).evaluate((el) => {
    const m = el.getScreenCTM();
    return { x: Math.round(m.e + m.a * +el.getAttribute('x')), y: Math.round(m.f + m.d * +el.getAttribute('y')), s: +m.a.toFixed(4) };
  });
}

test('A01: the presentation works from another folder with zero network requests', async ({ page }) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pde-a01-'));
  const copy = path.join(dir, 'moved.presentation.html');
  copyFileSync(FIXTURE, copy);
  const external = await open(page, copy);
  await expect(page.locator('.pde-annotation')).toHaveText('Overview note');
  await root(page, 'Identity service').click();
  await expect(modalTitle(page)).toHaveText('Identity HLD');
  await inFrame(page, 'Account association').click();
  await expect(modalTitle(page)).toHaveText('Account association LLD');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.pde-modal-layer')).toBeHidden();
  expect(external).toEqual([]);
});

test('A03: Back restores each level\'s viewport, selection and details; Close restores the overview', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await open(page);
  // Overview: zoom in once and open a details panel; this is the state to come back to.
  await page.locator('.pde-toolbar').getByRole('button', { name: 'Zoom in' }).click();
  await root(page, 'Audit log').click();
  await expect(page.locator('.pde-stage .pde-side-title')).toHaveText('Audit log: Read description');
  const overviewBox = await rootBox(page, 'Identity service');

  await root(page, 'Identity service').click();
  await expect(modalTitle(page)).toHaveText('Identity HLD');
  const modalZoomIn = page.locator('.pde-modal').getByRole('button', { name: 'Zoom in' });
  await modalZoomIn.click(); await modalZoomIn.click();
  await expect.poll(async () => (await frameBox(page, 'Account association')).s).toBeGreaterThan(0.9);
  const hldBox = await frameBox(page, 'Account association');

  await inFrame(page, 'Account association').click();
  await expect(modalTitle(page)).toHaveText('Account association LLD');
  await inFrame(page, 'Mapping table').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Read description' }).click();
  await expect(page.locator('.pde-modal .pde-side-title')).toHaveText('Mapping table: Read description');
  await expect(page.locator('.pde-modal .pde-details-text')).toHaveText('Table detail text.');
  await modalZoomIn.click();
  await page.waitForTimeout(150);
  const lldBox = await frameBox(page, 'Mapping table');

  await inFrame(page, 'Mapping table').click();
  await expect(modalTitle(page)).toHaveText('Mapping table detail');
  await expect(page.locator('.pde-modal .pde-side')).toBeHidden();

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(modalTitle(page)).toHaveText('Account association LLD');
  await expect(page.locator('.pde-modal .pde-side-title')).toHaveText('Mapping table: Read description');
  await expect.poll(() => frameBox(page, 'Mapping table')).toEqual(lldBox);

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(modalTitle(page)).toHaveText('Identity HLD');
  await expect.poll(() => frameBox(page, 'Account association')).toEqual(hldBox);
  // the hotspot used to go deeper is shown selected; keyboard focus stays on Back
  await expect(frame(page).locator('rect.pde-hotspot[aria-label="Account association"]')).toHaveClass(/is-selected/);
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeFocused();

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.pde-modal-layer')).toBeHidden();
  expect(await rootBox(page, 'Identity service')).toEqual(overviewBox);
  await expect(page.locator('.pde-stage .pde-side-title')).toHaveText('Audit log: Read description');
  await expect(root(page, 'Identity service')).toBeFocused();
});

test('A04: a shared diagram reached two ways shows the route actually taken', async ({ page }) => {
  await open(page);
  await root(page, 'Billing').click();
  await page.getByRole('menuitem', { name: 'Open shared services' }).click();
  await expect(modalTitle(page)).toHaveText('Shared services');
  expect(await crumbTexts(page)).toEqual(['Platform overview', 'Shared services']);
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await root(page, 'Identity service').click();
  await inFrame(page, 'Shared services').click();
  await expect(modalTitle(page)).toHaveText('Shared services');
  expect(await crumbTexts(page)).toEqual(['Platform overview', 'Identity HLD', 'Shared services']);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(modalTitle(page)).toHaveText('Identity HLD');
  // breadcrumb to the overview closes
  await page.locator('.pde-modal .pde-crumbs').getByRole('button', { name: 'Platform overview' }).click();
  await expect(page.locator('.pde-modal-layer')).toBeHidden();
});

test('A06: right-click, the menu button and Shift+F10 offer the same actions; the native menu stays elsewhere', async ({ page }) => {
  await open(page);
  const expected = ['Open shared services', 'Open LLD', 'Read description'];
  const items = async () => (await page.getByRole('menuitem').allTextContents()).map((s) => s.trim());

  await root(page, 'Billing').click({ button: 'right' });
  expect(await items()).toEqual(expected);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();

  await root(page, 'Billing').hover();
  await page.getByRole('button', { name: 'Actions for Billing' }).first().click();
  expect(await items()).toEqual(expected);
  await page.keyboard.press('Escape');

  await root(page, 'Billing').focus();
  await page.keyboard.press('Shift+F10');
  expect(await items()).toEqual(expected);
  await expect(page.getByRole('menuitem', { name: 'Open shared services' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Open LLD' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(root(page, 'Billing')).toBeFocused();

  const prevented = await page.evaluate(() => {
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 3, clientY: 3 });
    document.querySelector('.pde-project-title').dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented).toBe(false);
});

test('A06: a hotspot with only a description opens the details panel on click', async ({ page }) => {
  await open(page);
  await root(page, 'Audit log').click();
  await expect(page.locator('.pde-stage .pde-details-text')).toHaveText('Every change is recorded.');
});

test('A07: keyboard only — explore, read, drill down, close; focus is trapped and returned', async ({ page }) => {
  await open(page);
  await root(page, 'Identity service').focus();
  await expect(page.locator('.pde-root-view .pde-tooltip')).toHaveText('Authentication and accounts');
  // details via the keyboard
  await root(page, 'Audit log').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Close panel' }).first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pde-stage .pde-side')).toBeHidden();
  await expect(root(page, 'Audit log')).toBeFocused();
  // drill down
  await root(page, 'Identity service').focus();
  await page.keyboard.press('Enter');
  await expect(modalTitle(page)).toHaveText('Identity HLD');
  // opening focuses the dialog heading (announced); Tab then reaches the diagram
  await expect(modalTitle(page)).toBeFocused();
  await tabIntoFrame(page);
  await expect.poll(() => frameFocus(page)).toBe('Account association');
  // Enter inside the frame drills down; the frame keeps focus on the new scene
  await page.keyboard.press('Enter');
  await expect(modalTitle(page)).toHaveText('Account association LLD');
  await expect.poll(() => frameFocus(page)).toBe('Mapping table');
  // Backspace inside the frame goes back; focus returns to the hotspot used
  await page.keyboard.press('Backspace');
  await expect(modalTitle(page)).toHaveText('Identity HLD');
  await expect.poll(() => frameFocus(page)).toBe('Account association');
  // background is inert while the modal is open
  expect(await page.locator('.pde-toolbar').evaluate((el) => el.inert)).toBe(true);
  // Tab around the whole modal: focus never leaves it
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const a = document.activeElement;
      return !!a && (a.closest('.pde-modal') !== null || a.tagName === 'IFRAME');
    });
    expect(inside).toBe(true);
  }
  // Escape from inside the frame: Tab back into it (onto whichever hotspot comes
  // next), Escape hides the tooltip, Escape closes
  await tabIntoFrame(page);
  await expect.poll(() => frameFocus(page)).not.toBeNull();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pde-modal-layer')).toBeHidden();
  await expect(root(page, 'Identity service')).toBeFocused();
});

test('A12: a cross-link cycle stays responsive, the history cap offers a clear choice, Overview exits', async ({ page }) => {
  test.setTimeout(240000);
  await open(page);
  await root(page, 'Loop').click();
  await expect(modalTitle(page)).toHaveText('Loop A');
  for (let visit = 2; visit <= 64; visit++) {
    const target = visit % 2 === 0 ? 'To B' : 'To A';
    await inFrame(page, target).click();
    await expect(modalTitle(page)).toHaveText(visit % 2 === 0 ? 'Loop B' : 'Loop A');
  }
  expect(await crumbs(page).count()).toBe(65); // overview + 64 visits
  // Visit 64 is Loop B; a 65th visit is refused with a choice, and nothing is dropped.
  await inFrame(page, 'To A').click();
  await expect(page.getByRole('alertdialog', { name: 'History limit reached' })).toBeVisible();
  await expect(modalTitle(page)).toHaveText('Loop B');
  expect(await crumbs(page).count()).toBe(65);
  await page.getByRole('button', { name: 'Reset to overview' }).click();
  await expect(page.locator('.pde-modal-layer')).toBeHidden();
  await root(page, 'Loop').click();
  expect(await crumbTexts(page)).toEqual(['Platform overview', 'Loop A']);
});

test('A13: with hints hidden there are no outlines or handles; tooltips, menus and keyboard still work', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Hotspot hints' }).click();
  await expect(page.getByRole('button', { name: 'Hotspot hints' })).toHaveAttribute('aria-pressed', 'false');
  const stroke = await root(page, 'Billing').evaluate((el) => getComputedStyle(el).stroke);
  expect(['none', 'transparent', 'rgba(0, 0, 0, 0)']).toContain(stroke);
  expect(await page.locator('.pde-handle').count()).toBe(0);
  await root(page, 'Billing').focus();
  await expect(page.locator('.pde-root-view .pde-tooltip')).toHaveText('Invoices and payments');
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await root(page, 'Identity service').click();
  // The focused hotspot keeps its focus ring (accessibility); every other one has no outline.
  const frameStroke = await frame(page).locator('rect.pde-hotspot:not(:focus)').first().evaluate((el) => getComputedStyle(el).stroke);
  expect(['none', 'transparent', 'rgba(0, 0, 0, 0)']).toContain(frameStroke);
  expect(await frame(page).locator('.pde-handle').count()).toBe(0);
});

test('A08: activation racing Back and a resize cannot corrupt navigation; Close still works', async ({ page }) => {
  await open(page);
  await root(page, 'Identity service').click();
  await expect(modalTitle(page)).toHaveText('Identity HLD');
  await inFrame(page, 'Account association').click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(modalTitle(page)).toHaveText('Identity HLD');
  expect(await crumbTexts(page)).toEqual(['Platform overview', 'Identity HLD']);
  await expect(inFrame(page, 'Account association')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.pde-modal-layer')).toBeHidden();
});

test('A10 (presentation): hostile annotation text stays text; nothing executes', async ({ page }) => {
  await open(page);
  await root(page, 'Identity service').click();
  await expect(frame(page).locator('.pde-annotation')).toHaveText('<img src=x onerror="window.top.pwned=1">');
  expect(await frame(page).locator('.pde-annotation img').count()).toBe(0);
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
});

test('components list reaches every hotspot by keyboard, including tiny ones', async ({ page }) => {
  await open(page);
  await page.locator('.pde-toolbar').getByRole('button', { name: 'Components' }).click();
  const list = page.locator('.pde-stage .pde-component');
  await expect(list).toHaveText(['Identity service', 'Billing', 'Audit log', 'Loop']);
  await expect(list.first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(modalTitle(page)).toHaveText('Identity HLD');
});

test('About this diagram shows the description with line breaks preserved', async ({ page }) => {
  await open(page);
  await page.locator('.pde-toolbar').getByRole('button', { name: 'About this diagram' }).click();
  await expect(page.locator('.pde-stage .pde-details-text')).toHaveText('Main systems.\nSecond line.');
});
