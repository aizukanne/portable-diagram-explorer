import { test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve('spike/svg-zoom');
const page_url = pathToFileURL(path.join(dir, 'page.html')).href;
const svgUrl = (n) => pathToFileURL(path.join(dir, n)).href;
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const settle = (page) => page.evaluate(() => new Promise((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 300)));

test('SP-1 svg in img under the renderer transform', async ({ page, browserName }) => {
  execFileSync('node', [path.join(dir, 'gen.mjs')], { stdio: 'ignore' });
  const result = { browser: browserName, naturalSize: {}, sharpness: {}, pan: {} };
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(page_url);

  // (c) naturalWidth for width/height vs viewBox-only SVGs (and the edge drawing, 400x300).
  for (const n of ['grid-5k.svg', 'grid-vb.svg', 'edge.svg']) {
    result.naturalSize[n] = await page.evaluate((u) => window.loadImg(u), svgUrl(n));
  }

  // (a) Sharpness at rest. The drawing's left black edge is at image x=100,y=100..200.
  // Place that point at viewport (200,300): translate = (200 - 100*s, 300 - 150*s), crop 120x60 around it.
  const shot = async (s) => {
    await page.evaluate(([s]) => window.setT(200 - 100 * s, 300 - 150 * s, s), [s]);
    await settle(page);
    const buf = await page.screenshot({ clip: { x: 140, y: 270, width: 120, height: 60 } });
    return page.evaluate((u) => window.edge(u), 'data:image/png;base64,' + buf.toString('base64'));
  };
  // Raster of the same drawing at 1x: screenshot of the rendered SVG, shown the same way.
  await page.evaluate((u) => window.loadImg(u), svgUrl('edge.svg'));
  await page.evaluate(() => window.setT(0, 0, 1));
  await settle(page);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 400, height: 300 } });
  const pngUrl = 'data:image/png;base64,' + png.toString('base64');
  mkdirSync(path.join(dir, 'out'), { recursive: true });
  for (const [kind, src] of [['svg', svgUrl('edge.svg')], ['raster1x', pngUrl]]) {
    await page.evaluate((u) => window.loadImg(u), src);
    for (const s of [0.25, 1, 4, 16]) result.sharpness[`${kind}@${s * 100}%`] = await shot(s);
  }

  // (b) Pan cost: 60 frames of translate changes at scale 1 and 4.
  for (const n of ['grid-500.svg', 'grid-1k.svg', 'grid-2k.svg', 'grid-5k.svg', 'grid-20k.svg', 'grid-100k.svg']) {
    const t0 = Date.now();
    await page.evaluate((u) => window.loadImg(u), svgUrl(n));
    const loadMs = Date.now() - t0;
    for (const s of (n === 'grid-5k.svg' || n === 'grid-100k.svg') ? [1, 4] : [1]) {
      await page.evaluate(([s]) => window.setT(0, 0, s), [s]);
      await settle(page);
      await page.evaluate((s) => window.pan(s), s); // warm-up pass
      await settle(page);
      const d = await page.evaluate((s) => window.pan(s), s);
      result.pan[`${n}@${s * 100}%`] = { loadMs, frames: d.length, medianMs: +q(d, 0.5).toFixed(1), p95Ms: +q(d, 0.95).toFixed(1), maxMs: +Math.max(...d).toFixed(1) };
    }
  }
  console.log('RESULT ' + JSON.stringify(result, null, 1));
  writeFileSync(path.join(dir, 'out', `results-${browserName}.json`), JSON.stringify(result, null, 1));
});
