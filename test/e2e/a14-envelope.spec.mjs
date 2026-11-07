// A14: open a maximum-envelope presentation and RECORD load, navigation, pan/zoom
// and memory. A measurement, not a pass/fail gate (spec §12, §13): the numbers go
// into docs/acceptance-report.md and advertised limits follow them.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { buildPresentationHtml } from '../../src/core/package.js';

const OUT = path.resolve('test-results/a14');
const FILE = path.join(OUT, 'envelope.presentation.html');

// A PNG of random pixels: incompressible, so 50 of them really are ~50 MiB.
function noisePng(w, h) {
  const T = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([Buffer.from(t), d]))); return Buffer.concat([l, Buffer.from(t), d, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; randomBytes(w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]));
}

function makeEnvelope() {
  if (existsSync(FILE)) return;
  mkdirSync(OUT, { recursive: true });
  // Spec §12 envelope: 50 diagrams, 1000 hotspots, <= 50 MiB of compressed images.
  // Random pixels do not compress, so 690 x 500 RGB is ~0.99 MiB per image.
  const N = 50; const PER = 20; const W = 690; const H = 500;
  const assets = new Map();
  const project = { schemaVersion: 1, projectId: 'p-envelope', title: 'Envelope', rootDiagramId: 'd-0', assets: [], diagrams: [], settings: { tooltipDelayMs: 350, showHotspotHints: true } };
  for (let i = 0; i < N; i++) {
    const w = W; const h = H;
    assets.set(`a-${i}`, noisePng(w, h));
    project.assets.push({ id: `a-${i}`, path: `assets/a-${i}.png`, mimeType: 'image/png', width: w, height: h });
    const hotspots = [];
    for (let k = 0; k < PER; k++) {
      const col = k % 5; const row = Math.floor(k / 5);
      hotspots.push({ id: `h-${i}-${k}`, label: `C${i}.${k}`, tooltip: `component ${k}`, rect: { x: 0.02 + col * 0.19, y: 0.04 + row * 0.24, width: 0.15, height: 0.18 }, zIndex: k + 1,
        defaultActionId: `x-${i}-${k}`, actions: [{ id: `x-${i}-${k}`, label: 'Open', type: 'diagram', targetDiagramId: `d-${(i + k + 1) % N}` }] });
    }
    project.diagrams.push({ id: `d-${i}`, title: `Diagram ${i}`, assetId: `a-${i}`, hotspots, annotations: [] });
  }
  const tpl = readFileSync('dist/presentation-template.html', 'utf8');
  writeFileSync(FILE, buildPresentationHtml(tpl, project, assets, 'a14'));
  writeFileSync(path.join(OUT, 'image-bytes.json'), JSON.stringify({ bytes: [...assets.values()].reduce((n, b) => n + b.length, 0) }));
}

test('A14: maximum-envelope presentation — recorded measurements', async ({ page, browserName }) => {
  test.setTimeout(600000);
  makeEnvelope();
  const sizeMiB = statSync(FILE).size / 1024 / 1024;
  const imageMiB = JSON.parse(readFileSync(path.join(OUT, 'image-bytes.json'), 'utf8')).bytes / 1024 / 1024;
  const t0 = Date.now();
  await page.goto(pathToFileURL(FILE).href, { timeout: 300000 });
  await expect(page.locator('.pde-root-view rect.pde-hotspot').first()).toBeVisible({ timeout: 300000 });
  await page.waitForFunction(() => { const i = document.querySelector('.pde-root-view img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 300000 });
  const initialLoadMs = Date.now() - t0;
  const nav = await page.evaluate(async () => {
    const v = window.__pdeViewer;
    const times = [];
    const ids = v.project.diagrams.map((d) => d.id);
    v.nav.open(ids[1], v.rootState());
    v.openModal();
    await v.renderCurrent({});
    for (let k = 0; k < 40; k++) {
      const target = ids[(k % 4) + 1]; // revisits: warm navigation among recent scenes
      const t = performance.now();
      v.nav.push(target, v.modalState());
      await v.renderCurrent({});
      times.push(performance.now() - t);
      if (v.nav.breadcrumbs().length > 30) { v.closeModal(); v.nav.open(ids[1], v.rootState()); v.openModal(); await v.renderCurrent({}); }
    }
    const cold = [];
    for (let k = 10; k < 20; k++) {
      const t = performance.now();
      v.nav.push(ids[k], v.modalState());
      await v.renderCurrent({});
      cold.push(performance.now() - t);
    }
    v.closeModal();
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    return { warmMedianMs: med(times), warmMaxMs: Math.max(...times), coldMedianMs: med(cold), coldMaxMs: Math.max(...cold) };
  });
  const frames = await page.evaluate(async () => {
    const r = window.__pdeViewer.rootRenderer;
    const deltas = [];
    let last = performance.now();
    for (let k = 0; k < 120; k++) {
      r.zoomBy(k % 40 < 20 ? 1.05 : 1 / 1.05, 300 + k, 300);
      await new Promise((res) => requestAnimationFrame(res));
      const now = performance.now(); deltas.push(now - last); last = now;
    }
    deltas.sort((a, b) => a - b);
    return { frameMedianMs: deltas[Math.floor(deltas.length / 2)], frameP95Ms: deltas[Math.floor(deltas.length * 0.95)] };
  });
  const mem = await page.evaluate(() => (performance.memory ? { usedJSHeapMiB: performance.memory.usedJSHeapSize / 1048576, totalJSHeapMiB: performance.memory.totalJSHeapSize / 1048576 } : null));
  const result = { browser: browserName, version: page.context().browser().version(), imageMiB: +imageMiB.toFixed(1), fileMiB: +sizeMiB.toFixed(1), initialLoadMs, ...nav, ...frames, memory: mem };
  for (const k of Object.keys(result)) if (typeof result[k] === 'number') result[k] = Math.round(result[k] * 10) / 10;
  console.log('A14', JSON.stringify(result));
  writeFileSync(path.join(OUT, `a14-${browserName}.json`), `${JSON.stringify(result, null, 2)}\n`);
});
