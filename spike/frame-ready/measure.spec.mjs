// SP-2: time from iframe creation to the frame's first READY, per engine and condition.
// Conditions: idle; under CPU load (4 busy workers); the A14 envelope (PDE_A14=1).
// Method: the viewer's own lazy path. window.__pdeViewer.bridge is destroyed and nulled, a
// capturing 'message' listener is installed on window, then openModal() runs (it constructs a
// new FrameBridge, i.e. creates the sandboxed srcdoc iframe). t0 is taken immediately before
// openModal(); t1 is the dispatch time of the first message of type READY from the new frame.
// Two sample sets: WARM = 50 destroy/recreate cycles in one loaded page; COLD = first
// drill-down on a freshly loaded page (the real lazy path), FRESH loads per condition.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const FIXTURE = path.resolve('dist/test/viewer-fixture.presentation.html');
const A14 = path.resolve('test-results/a14/envelope.presentation.html');
const OUT = path.resolve('spike/frame-ready/out');
const WARM = 50;

function pct(a, p) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; }
const stats = (a) => ({ n: a.length, p50: pct(a, 50), p95: pct(a, 95), p99: pct(a, 99), max: Math.max(...a), min: Math.min(...a) });
const r1 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));

// One drill-down cycle inside the page; resolves with ms from before openModal() to READY.
const cycle = () => new Promise((resolve, reject) => {
  const v = window.__pdeViewer;
  if (v.bridge) { v.bridge.destroy(); v.bridge = null; }
  let t1 = null;
  const on = (e) => { if (e.data && e.data.type === 'READY' && e.source && e.source !== window) { t1 = performance.now(); window.removeEventListener('message', on, true); } };
  window.addEventListener('message', on, true);
  const t0 = performance.now();
  v.openModal();
  const dl = t0 + 30000;
  const poll = () => {
    if (t1 !== null) { const ms = t1 - t0; v.closeModal(); resolve({ ms, ready: v.bridge.ready }); return; }
    if (performance.now() > dl) { reject(new Error('READY not seen in 30 s')); return; }
    setTimeout(poll, 0);
  };
  poll();
});

const busyLoop = () => { const t = performance.now(); let n = 0; while (performance.now() - t < 400) for (let i = 0; i < 1e4; i++) n += i & 1; return n; };

async function startLoad(context, count) {
  const loader = await context.newPage();
  await loader.goto('about:blank');
  await loader.evaluate((count) => {
    const src = 'let x=0,n=0,t=Date.now();for(;;){x=(x*1664525+1013904223)|0;if(++n%1e6===0&&Date.now()-t>300){postMessage(n);t=Date.now();n=0;}}';
    window.__w = []; window.__rates = [];
    for (let i = 0; i < count; i++) { const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))); w.onmessage = (e) => { window.__rates[i] = e.data; }; window.__w.push(w); }
  }, count);
  return loader;
}

const conditions = [
  { name: 'idle', file: FIXTURE, load: false, fresh: 20, onlyA14: false },
  { name: 'load', file: FIXTURE, load: true, workers: 4, fresh: 20, onlyA14: false },
  // 16 workers on an 8-thread host: oversubscribed, so the main thread really competes for a core.
  { name: 'saturated', file: FIXTURE, load: true, workers: 16, fresh: 20, onlyA14: false },
  { name: 'a14', file: A14, load: false, fresh: 5, onlyA14: true },
];

for (const c of conditions) {
  test(`SP-2 ${c.name}`, async ({ browser, browserName }) => {
    test.skip(c.onlyA14 !== !!process.env.PDE_A14, c.onlyA14 ? 'needs PDE_A14=1' : 'run without PDE_A14');
    if (c.onlyA14) {
      // The A14 spec's generator is reused by running it first (builds test-results/a14/envelope...).
      expect(existsSync(A14), 'run test/e2e/a14-envelope.spec.mjs with PDE_A14=1 first so the envelope exists').toBe(true);
    }
    const context = await browser.newContext();
    let loader = null;
    const probe = await context.newPage();
    const thr = {};
    if (c.load) {
      thr.before = await probe.evaluate(`(${busyLoop})()`);
      loader = await startLoad(context, c.workers);
      await new Promise((r) => setTimeout(r, 500));
      thr.during = await probe.evaluate(`(${busyLoop})()`);
      thr.workers = c.workers;
      thr.workersReporting = await loader.evaluate(() => window.__rates.filter(Boolean).length);
    }
    await probe.close();
    const open = async () => {
      const page = await context.newPage();
      await page.goto(pathToFileURL(c.file).href, { timeout: 300000 });
      await page.waitForFunction(() => window.__pdeViewer && document.querySelector('.pde-root-view img') && document.querySelector('.pde-root-view img').complete, null, { timeout: 300000 });
      return page;
    };
    const cold = [];
    for (let i = 0; i < c.fresh; i++) {
      const page = await open();
      const r = await page.evaluate(`(${cycle})()`);
      expect(r.ready).toBe(true);
      cold.push(r.ms);
      await page.close();
    }
    const page = await open();
    const warm = [];
    for (let i = 0; i < WARM; i++) { const r = await page.evaluate(`(${cycle})()`); warm.push(r.ms); }
    if (c.load) { thr.after = await page.evaluate(`(${busyLoop})()`); thr.dropPct = Math.round((1 - thr.during / thr.before) * 1000) / 10; }
    await page.close();
    if (loader) await loader.close();
    const result = { browser: browserName, version: browser.version(), condition: c.name, nproc: 'see report', warm: r1(stats(warm)), cold: r1(stats(cold)), throughput: thr, warmSamples: warm, coldSamples: cold };
    console.log('SP2', JSON.stringify({ ...result, warmSamples: undefined, coldSamples: undefined }));
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, `${c.name}-${browserName}.json`), `${JSON.stringify(result, null, 2)}\n`);
    await context.close();
  });
}
