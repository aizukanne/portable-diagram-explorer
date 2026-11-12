// S6 (v1.1): SVG images are sniffed, measured, shown only as inert pictures and carried through the frame.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDITOR = path.resolve('dist/editor.html');
const T = (f) => path.resolve('dist/test', f);

async function open(page) {
  const external = [];
  page.on('request', (r) => { if (!/^(file|data|blob|about):/.test(r.url())) external.push(r.url()); });
  await page.goto(pathToFileURL(EDITOR).href);
  await expect(page.getByRole('button', { name: 'Export presentation' })).toBeVisible();
  return external;
}
const addImages = (page, files) => page.locator('input[data-role="add-images"]').setInputFiles(files);
async function saveDownload(page, buttonName) {
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: buttonName, exact: true }).click()]);
  const dir = mkdtempSync(path.join(tmpdir(), 'pde-dl-'));
  const p = path.join(dir, d.suggestedFilename());
  await d.saveAs(p);
  return { path: p, name: d.suggestedFilename(), bytes: new Uint8Array(readFileSync(p)) };
}
const dialog = (page) => page.locator('.pde-dialog');
const closeDialog = (page) => dialog(page).getByRole('button', { name: 'Close' }).click();

// Draw a hotspot on the current diagram and make it open the diagram called `title`.
async function drawHotspotTo(page, title) {
  await page.getByRole('button', { name: 'Add hotspot' }).click();
  const img = await page.locator('.pde-canvas .pde-image').boundingBox();
  await page.mouse.move(img.x + img.width * 0.1, img.y + img.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(img.x + img.width * 0.4, img.y + img.height * 0.5, { steps: 6 });
  await page.mouse.up();
  await page.locator('[data-field="label"]').fill('Risky');
  await page.getByRole('button', { name: 'Open diagram' }).click();
  await page.locator('.pde-action select').selectOption({ label: title });
}

// Copied from a05-renderer.spec.mjs: each hotspot's on-screen geometry against the image's.
async function misalignment(page) {
  return page.evaluate(() => {
    const img = document.querySelector('.pde-scene img').getBoundingClientRect();
    return [...document.querySelectorAll('.pde-scene rect.pde-hotspot')].map((el) => {
      const m = el.getScreenCTM();
      const x = +el.getAttribute('x'); const y = +el.getAttribute('y');
      const w = +el.getAttribute('width'); const h = +el.getAttribute('height');
      const left = m.a * x + m.c * y + m.e; const top = m.b * x + m.d * y + m.f;
      const n = JSON.parse(el.dataset.rect);
      return Math.max(
        Math.abs(left - (img.left + n.x * img.width)), Math.abs(top - (img.top + n.y * img.height)),
        Math.abs(m.a * w - n.width * img.width), Math.abs(m.d * h - n.height * img.height));
    });
  });
}

test('A22: SVG imports, is listed as SVG, size from width/height or viewBox; no size is refused', async ({ page }) => {
  const external = await open(page);
  await addImages(page, [T('images/diagram.svg')]); // width="1200" height="800"
  await expect(page.locator('.pde-inspector')).toContainText('Image: 1200 × 800 px, SVG+XML');
  await addImages(page, [T('images/nosize.svg')]);
  await expect(page.locator('.pde-issues')).toContainText('E_SVG_NO_SIZE');
  await expect(page.locator('.pde-issues')).toContainText('width="1200" height="800"');
  expect(external).toEqual([]);
});

test('A22b: a viewBox-only SVG is sized from its viewBox, not from the browser\'s guess', async ({ page }) => {
  const external = await open(page);
  const file = { name: 'vb.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 1600"><rect width="2000" height="1600"/></svg>') };
  await addImages(page, [file]);
  await expect(page.locator('.pde-inspector')).toContainText('Image: 2000 × 1600 px, SVG+XML');
  const box = await page.locator('.pde-canvas .pde-scene').boundingBox();
  expect(box.width / box.height).toBeCloseTo(1.25, 2);
  const img = await page.locator('.pde-canvas .pde-image').boundingBox();
  expect(img.width / img.height).toBeCloseTo(1.25, 2);
  expect(external).toEqual([]);
});

test('A23: risky SVG warns, nothing runs or loads in editor, preview or export', async ({ page, browser }) => {
  const external = await open(page);
  await addImages(page, [T('images/risky.svg')]);
  await expect(page.locator('.pde-issues')).toContainText('W_SVG_INERT_PARTS');
  await expect(page.locator('.pde-issues')).toContainText('script ×1');
  await closeDialog(page);
  // Make it reachable as a drill-down: overview hotspot -> the SVG diagram.
  await addImages(page, [T('images/overview.png')]);
  await page.getByRole('button', { name: 'Set as overview' }).click();
  await drawHotspotTo(page, 'Risky');
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.locator('.pde-preview .pde-root-view rect.pde-hotspot').first().click();
  await expect(page.locator('.pde-preview').frameLocator('iframe').locator('.pde-image')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Exit preview' }).click();
  const exported = await saveDownload(page, 'Export presentation');
  const recipient = await browser.newPage();
  const ext2 = [];
  recipient.on('request', (r) => { if (!/^(file|data|blob|about):/.test(r.url())) ext2.push(r.url()); });
  await recipient.goto(pathToFileURL(exported.path).href);
  await recipient.locator('.pde-root-view rect.pde-hotspot').first().click();
  await expect(recipient.frameLocator('iframe').locator('.pde-image')).toBeVisible();
  for (const pg of [page, recipient]) expect(await pg.evaluate(() => window.top.pwned)).toBeUndefined();
  expect(external).toEqual([]);
  expect(ext2).toEqual([]);
});

test('A24: hotspots line up on an SVG at 25%, 100% and 1600%', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve('dist/test/renderer-harness.html')).href + '?svg');
  await expect(page.locator('html[data-ready="1"]')).toHaveCount(1);
  for (const zoom of [0.25, 1, 16]) {
    await page.evaluate((z) => window.__r.setView({ cx: 0.5, cy: 0.5, zoom: z }), zoom);
    const ds = await misalignment(page);
    expect(ds.length).toBe(1);
    for (const d of ds) expect(d).toBeLessThan(1);
  }
});
