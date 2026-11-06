// S06: renderer alignment (A05), pointer-anchored zoom, tooltips, keyboard and menus.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const HARNESS = pathToFileURL(path.resolve('dist/test/renderer-harness.html')).href;

async function open(page) {
  const external = [];
  page.on('request', (r) => { if (!/^(file|data|blob|about):/.test(r.url())) external.push(r.url()); });
  await page.goto(HARNESS);
  await expect(page.locator('html[data-ready="1"]')).toHaveCount(1);
  return external;
}

// Measures the region's geometry (its x/y/width/height through the screen transform),
// not the stroked box: engines differ on whether getBoundingClientRect includes stroke.
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

for (const size of [{ width: 1280, height: 800 }, { width: 700, height: 1100 }, { width: 1600, height: 500 }]) {
  test(`A05 hotspots stay aligned at ${size.width}x${size.height} across zoom and pan`, async ({ page }) => {
    await page.setViewportSize(size);
    const external = await open(page);
    for (const view of [{ cx: 0.5, cy: 0.5, zoom: 1 }, { cx: 0.2, cy: 0.3, zoom: 2.5 }, { cx: 0.8, cy: 0.7, zoom: 7 }, { cx: 0.5, cy: 0.5, zoom: 0.25 }]) {
      await page.evaluate((v) => window.__r.setView(v), view);
      for (const d of await misalignment(page)) expect(d).toBeLessThan(1);
    }
    // letterboxing: at fit, the image is centred in the viewport
    await page.evaluate(() => window.__r.fit());
    const img = await page.locator('.pde-scene img').boundingBox();
    expect(Math.abs(img.x + img.width / 2 - size.width / 2)).toBeLessThan(1);
    expect(Math.abs(img.y + img.height / 2 - size.height / 2)).toBeLessThan(1);
    await page.setViewportSize({ width: size.height, height: size.width });
    await expect.poll(async () => Math.max(...await misalignment(page))).toBeLessThan(1);
    expect(external).toEqual([]);
  });
}

test('wheel zoom is anchored at the pointer', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await open(page);
  const before = await page.locator('rect[data-id="h-a"]').boundingBox();
  const px = before.x + 10;
  const py = before.y + 10;
  await page.mouse.move(px, py);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => page.evaluate(() => window.__r.getView().zoom)).toBeGreaterThan(1.5);
  const after = await page.locator('rect[data-id="h-a"]').boundingBox();
  // The image point under the pointer stays under the pointer.
  const fx = (px - before.x) / before.width;
  const fx2 = (px - after.x) / after.width;
  expect(Math.abs(fx - fx2)).toBeLessThan(0.02);
});

test('drag pans and does not activate; a click activates the topmost hotspot', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await open(page);
  const c = await page.locator('rect[data-id="h-c"]').boundingBox();
  await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
  let ev = await page.evaluate(() => window.__events.filter((e) => e.kind === 'activate'));
  expect(ev.map((e) => [e.id, e.mode])).toEqual([['h-c', 'default']]);
  await page.mouse.move(c.x + 2, c.y + 2);
  await page.mouse.down();
  await page.mouse.move(c.x + 80, c.y + 60, { steps: 5 });
  await page.mouse.up();
  ev = await page.evaluate(() => window.__events.filter((e) => e.kind === 'activate'));
  expect(ev.length).toBe(1);
  expect(await page.evaluate(() => window.__r.getView().cx)).not.toBe(0.5);
});

test('tooltip appears after the configured delay on hover, at once on focus, and hides on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await open(page);
  // Record, in the page, when the pointer entered and when the tooltip became visible.
  await page.evaluate(() => {
    const tip = document.querySelector('.pde-tooltip');
    const el = document.querySelector('rect[data-id="h-a"]');
    window.__tip = {};
    // Capture phase: runs before any listener on the element itself.
    window.addEventListener('pointerenter', (e) => { if (e.target === el && !window.__tip.enter) window.__tip.enter = performance.now(); }, true);
    new MutationObserver(() => { if (!tip.hidden && !window.__tip.shown) window.__tip.shown = performance.now(); })
      .observe(tip, { attributes: true, attributeFilter: ['hidden'] });
  });
  const a = await page.locator('rect[data-id="h-a"]').boundingBox();
  await page.mouse.move(a.x + 20, a.y + 20);
  await expect(page.locator('.pde-tooltip')).toHaveText('Alpha tooltip');
  const t = await page.evaluate(() => window.__tip);
  expect(t.shown - t.enter).toBeGreaterThanOrEqual(300);
  await page.mouse.move(5, 5);
  await expect(page.locator('.pde-tooltip')).toBeHidden();
  await page.keyboard.press('Tab');
  await expect(page.locator('rect[data-id="h-a"]')).toBeFocused();
  await expect(page.locator('.pde-tooltip')).toBeVisible({ timeout: 200 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.pde-tooltip')).toBeHidden();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__events.filter((e) => e.kind === 'key').map((e) => e.key))).toEqual(['Escape']);
});

test('keyboard: Enter is the default action; Shift+F10 and ContextMenu request the menu', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('ContextMenu');
  const ev = await page.evaluate(() => window.__events.filter((e) => e.kind === 'activate').map((e) => [e.id, e.mode]));
  expect(ev).toEqual([['h-a', 'default'], ['h-a', 'menu'], ['h-a', 'menu']]);
});

test('right-click on a hotspot opens our menu; elsewhere the native menu is untouched', async ({ page }) => {
  await open(page);
  const a = await page.locator('rect[data-id="h-a"]').boundingBox();
  const prevented = await page.evaluate(({ x, y }) => {
    const out = [];
    for (const [px, py] of [[x, y], [5, 5]]) {
      const el = document.elementFromPoint(px, py);
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: px, clientY: py });
      el.dispatchEvent(ev);
      out.push(ev.defaultPrevented);
    }
    return out;
  }, { x: a.x + 5, y: a.y + 5 });
  expect(prevented).toEqual([true, false]);
  expect(await page.evaluate(() => window.__events.filter((e) => e.kind === 'activate').map((e) => e.mode))).toEqual(['menu']);
});

test('the visible menu button offers the menu without right-click', async ({ page }) => {
  await open(page);
  await page.locator('rect[data-id="h-a"]').hover();
  await page.getByRole('button', { name: 'Actions for Alpha' }).click();
  expect(await page.evaluate(() => window.__events.filter((e) => e.kind === 'activate').map((e) => [e.id, e.mode]))).toEqual([['h-a', 'menu']]);
});

test('annotation text is inert and keeps line breaks; hotspots expose accessible names', async ({ page }) => {
  await open(page);
  await expect(page.locator('.pde-annotation')).toHaveText('<b>not bold</b>\nsecond line');
  expect(await page.locator('.pde-annotation b').count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Beta' })).toHaveCount(1);
});
