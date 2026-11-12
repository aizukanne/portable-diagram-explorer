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

test('SP-1 sharpness and naturalWidth', async ({ page, browserName }) => {
  execFileSync('node', [path.join(dir, 'gen.mjs')], { stdio: 'ignore' });
  const result = { browser: browserName, naturalSize: {}, sharpness: {} };
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(page_url);

  // (c) naturalWidth for width/height vs viewBox-only SVGs (and the edge drawing, 400x300).
  for (const n of ['grid-5k.svg', 'grid-vb.svg', 'edge.svg']) {
    result.naturalSize[n] = await page.evaluate((u) => window.loadImg(u), svgUrl(n));
  }

  // (a) Sharpness at rest. A point (ex,ey) on a hard vertical edge is placed at viewport (200+off, 300):
  // translate = (200+off - ex*s, 300 - ey*s); crop 120x60 around (200,300); analyse the middle row.
  const shot = async (s, ex, ey, off) => {
    await page.evaluate(([s, ex, ey, off]) => window.setT(200 + off - ex * s, 300 - ey * s, s), [s, ex, ey, off]);
    await settle(page);
    const buf = await page.screenshot({ clip: { x: 140, y: 270, width: 120, height: 60 } });
    return page.evaluate((u) => window.edge(u), 'data:image/png;base64,' + buf.toString('base64'));
  };
  const png1x = async (svgName, clip, tx, ty) => { // 1x raster of the same drawing, region only
    await page.evaluate((u) => window.loadImg(u), svgUrl(svgName));
    await page.evaluate(([x, y]) => window.setT(x, y, 1), [tx, ty]);
    await settle(page);
    return 'data:image/png;base64,' + (await page.screenshot({ clip })).toString('base64');
  };
  const edgePng = await png1x('edge.svg', { x: 0, y: 0, width: 400, height: 300 }, 0, 0);
  // big drawing: the 400x300 region at image (800,850) holds the edge point (1000,1000) at local (200,150)
  const bigPng = await png1x('edge-big.svg', { x: 0, y: 0, width: 400, height: 300 }, -800, -850);
  const cells = [ // [label, svg, png, ex, ey (svg and png), scale, subpixel offset]
    ['edge 400x300 @25%', 'edge.svg', edgePng, 100, 150, 0.25, 0],
    ['edge 400x300 @100%', 'edge.svg', edgePng, 100, 150, 1, 0],
    ['edge 400x300 @400%', 'edge.svg', edgePng, 100, 150, 4, 0],
    ['edge 400x300 @1600%', 'edge.svg', edgePng, 100, 150, 16, 0],
    ['edge 400x300 @370% +0.37px', 'edge.svg', edgePng, 100, 150, 3.7, 0.37],
    ['big 2000x1600 @100%', 'edge-big.svg', bigPng, 1000, 1000, 1, 0],
    ['big 2000x1600 @400%', 'edge-big.svg', bigPng, 1000, 1000, 4, 0],
    ['big 2000x1600 @1600%', 'edge-big.svg', bigPng, 1000, 1000, 16, 0],
    ['big 2000x1600 @370% +0.37px', 'edge-big.svg', bigPng, 1000, 1000, 3.7, 0.37],
  ];
  for (const [label, svg, png, ex, ey, s, off] of cells) {
    await page.evaluate((u) => window.loadImg(u), svgUrl(svg));
    const r = await shot(s, ex, ey, off);
    await page.evaluate((u) => window.loadImg(u), png);
    const p = await shot(s, svg === 'edge.svg' ? ex : 200, svg === 'edge.svg' ? ey : 150, off);
    result.sharpness[label] = { svg: r, png1x: p };
  }
  console.log('RESULT ' + JSON.stringify(result, null, 1));
  mkdirSync(path.join(dir, 'out'), { recursive: true });
  writeFileSync(path.join(dir, 'out', `sharp-${browserName}.json`), JSON.stringify(result, null, 1));
});

test('SP-1 pan cost', async ({ page, browserName }) => {
  execFileSync('node', [path.join(dir, 'gen.mjs')], { stdio: 'ignore' });
  mkdirSync(path.join(dir, 'out'), { recursive: true });
  const result = { browser: browserName, pan: {} };
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(page_url);
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
