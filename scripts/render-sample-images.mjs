// Render the sample diagrams from samples/customer-platform/layout.mjs to PNG
// (design D23) and write the matching project.json. Runs inside the Playwright
// container: scripts/render-sample.sh. The PNGs and project.json are committed;
// the build only packages them.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DIAGRAMS, svgFor, projectJson } from '../samples/customer-platform/layout.mjs';

const dir = 'samples/customer-platform';
mkdirSync(`${dir}/assets`, { recursive: true });
mkdirSync(`${dir}/src`, { recursive: true });
const browser = await chromium.launch();
for (const d of DIAGRAMS) {
  const svg = svgFor(d);
  writeFileSync(`${dir}/src/${d.file}.svg`, svg);
  const page = await browser.newPage({ viewport: { width: d.width, height: d.height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
  await page.screenshot({ path: `${dir}/assets/a-${d.file}-${d.file}.png`, clip: { x: 0, y: 0, width: d.width, height: d.height } });
  await page.close();
  console.log(`rendered ${d.file} ${d.width}x${d.height}`);
}
await browser.close();
writeFileSync(`${dir}/project.json`, `${JSON.stringify(projectJson(), null, 2)}\n`);
console.log('wrote project.json');
