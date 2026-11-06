// S07: the sandboxed frame and its bridge (A08, A10 at the bridge level; the
// presentation-level versions run in viewer.spec.mjs).
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const HARNESS = pathToFileURL(path.resolve('dist/test/bridge-harness.html')).href;

async function open(page) {
  const external = [];
  page.on('request', (r) => { if (!/^(file|data|blob|about):/.test(r.url())) external.push(r.url()); });
  await page.goto(HARNESS);
  await expect(page.locator('html[data-ready="1"]')).toHaveCount(1);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  return { external, frame };
}

test('the frame is sandboxed with scripts only and has an accessible title', async ({ page }) => {
  await open(page);
  const attrs = await page.locator('iframe').evaluate((f) => ({ sandbox: f.getAttribute('sandbox'), title: f.title }));
  expect(attrs).toEqual({ sandbox: 'allow-scripts', title: 'Diagram: harness' });
});

test('A10: annotation HTML renders as inert text inside the frame', async ({ page }) => {
  const { external } = await open(page);
  const f = page.frameLocator('iframe');
  await expect(f.locator('.pde-annotation')).toHaveText('<img src=x onerror="window.top.pwned=1">');
  expect(await f.locator('.pde-annotation img').count()).toBe(0);
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  expect(external).toEqual([]);
});

test('A10: forged messages from the page, wrong channel, replayed seq and foreign hotspots are rejected', async ({ page }) => {
  const { frame } = await open(page);
  const before = await page.evaluate(() => window.__pdeStats.rejected);
  // 1. from the parent window itself (not the frame)
  await page.evaluate(() => window.postMessage({ pde: 1, type: 'ACTIVATE_HOTSPOT', channel: 'guess', seq: 1e9 }, '*'));
  // 2..4 from inside the real frame: wrong channel, replayed sequence, hotspot not in the scene
  await frame.evaluate(() => {
    const ch = document.documentElement.getAttribute('data-channel');
    parent.postMessage({ pde: 1, channel: 'f'.repeat(32), seq: 1e6, type: 'KEY', key: 'Escape' }, '*');
    parent.postMessage({ pde: 1, channel: ch, seq: 1, type: 'KEY', key: 'Escape' }, '*');
    parent.postMessage({ pde: 1, channel: ch, seq: 1e6, type: 'NAVIGATE', url: 'https://example.com' }, '*');
  });
  await expect.poll(() => page.evaluate(() => window.__pdeStats.rejected)).toBe(before + 4);
  expect(await page.evaluate(() => window.__events.filter((e) => e.kind !== 'view'))).toEqual([]);
});

test('A08: a reply carrying the previous scene token cannot act on the new scene', async ({ page }) => {
  const { frame } = await open(page);
  const oldToken = await page.evaluate(() => window.__bridge.sceneToken);
  await page.evaluate(() => window.__render('B'));
  await expect(page.frameLocator('iframe').getByRole('button', { name: 'B one', exact: true })).toHaveCount(1);
  const rejected = await page.evaluate(() => window.__pdeStats.rejected);
  await frame.evaluate((tok) => {
    const ch = document.documentElement.getAttribute('data-channel');
    parent.postMessage({ pde: 1, channel: ch, seq: 5e6, type: 'ACTIVATE_HOTSPOT', sceneToken: tok, hotspotId: 'h-a1', mode: 'default', anchor: { x: 1, y: 1 } }, '*');
  }, oldToken);
  await expect.poll(() => page.evaluate(() => window.__pdeStats.rejected)).toBe(rejected + 1);
  expect(await page.evaluate(() => window.__events.filter((e) => e.kind === 'activate'))).toEqual([]);
});

test('A08: rapid re-render supersedes the earlier one; the last scene wins', async ({ page }) => {
  await open(page);
  const results = await page.evaluate(() => Promise.all([window.__render('B'), window.__render('A'), window.__render('B')]));
  expect(results[0]).toEqual({ superseded: true });
  expect(results[1]).toEqual({ superseded: true });
  await expect(page.frameLocator('iframe').getByRole('button', { name: 'B one', exact: true })).toHaveCount(1);
  await expect(page.frameLocator('iframe').getByRole('button', { name: 'A one', exact: true })).toHaveCount(0);
});

test('clicking a hotspot in the frame reaches the parent with parent-relative anchor', async ({ page }) => {
  await open(page);
  await page.frameLocator('iframe').getByRole('button', { name: 'A one', exact: true }).click();
  const ev = await page.evaluate(() => window.__events.filter((e) => e.kind === 'activate'));
  expect(ev.length).toBe(1);
  expect(ev[0].id).toBe('h-a1');
  expect(ev[0].mode).toBe('default');
  const box = await page.locator('iframe').boundingBox();
  expect(ev[0].anchor.x).toBeGreaterThan(box.x);
});

test('Escape and Backspace inside the frame are forwarded to the parent', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__bridge.focus('first'));
  const btn = page.frameLocator('iframe').getByRole('button', { name: 'A one', exact: true });
  await expect(btn).toBeFocused();
  await page.keyboard.press('Escape'); // hides the tooltip first
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
  await expect.poll(() => page.evaluate(() => window.__events.filter((e) => e.kind === 'key').map((e) => e.key))).toEqual(['Escape', 'Back']);
});

test('the frame cannot reach the network or the parent document', async ({ page }) => {
  const { frame } = await open(page);
  const r = await frame.evaluate(async () => {
    let parentDoc = 'blocked';
    try { parentDoc = String(parent.document.title); } catch { /* expected */ }
    const img = new Image();
    const net = await new Promise((res) => { img.onload = () => res('loaded'); img.onerror = () => res('blocked'); img.src = 'https://example.com/x.png'; });
    return { parentDoc, net, origin: String(self.origin) };
  });
  expect(r).toEqual({ parentDoc: 'blocked', net: 'blocked', origin: 'null' });
});
