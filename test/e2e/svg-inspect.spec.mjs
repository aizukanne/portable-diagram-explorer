// inspectSvg's pinned rules (spec §5.8 item 10, brief S6): unit table, in a browser because it needs DOMParser.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (attrs, body = '') => `<svg ${NS} ${attrs}>${body}</svg>`;

test.beforeEach(async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve('dist/test/inspect-harness.html')).href);
  await expect(page.locator('html[data-ready="1"]')).toHaveCount(1);
});
const inspect = (page, text) => page.evaluate((t) => window.__inspect(t), text);
const errors = (r) => r.issues.filter((i) => i.severity === 'error').map((i) => i.code);

const SIZES = [
  ['1in', svg('width="1in" height="1in"'), 96, 96],
  ['10mm', svg('width="10mm" height="10mm"'), 38, 38],
  ['1cm', svg('width="1cm" height="1cm"'), 38, 38],
  ['12pt', svg('width="12pt" height="12pt"'), 16, 16],
  ['1pc', svg('width="1pc" height="1pc"'), 16, 16],
  ['unitless and px', svg('width="300" height="200px"'), 300, 200],
  ['fractions round to nearest, minimum 1', svg('width="0.1" height="2.5"'), 1, 3],
  ['50% with a viewBox uses the viewBox', svg('width="50%" height="50%" viewBox="0 0 300 200"'), 300, 200],
  ['em with a viewBox uses the viewBox', svg('width="2em" height="2em" viewBox="0 0 640 480"'), 640, 480],
  ['viewBox only', svg('viewBox="0 0 2000 1600"'), 2000, 1600],
  ['mixed: absolute side kept, other derived from viewBox aspect', svg('width="100%" height="400" viewBox="0 0 800 200"'), 1600, 400],
  ['exactly 100 megapixels is allowed', svg('width="10000" height="10000"'), 10000, 10000],
];
for (const [name, text, w, h] of SIZES) {
  test(`size: ${name}`, async ({ page }) => {
    const r = await inspect(page, text);
    expect(errors(r)).toEqual([]);
    expect([r.width, r.height]).toEqual([w, h]);
  });
}

const REFUSED = [
  ['2em with no viewBox', svg('width="2em" height="2em"'), 'E_SVG_NO_SIZE'],
  ['no size at all', svg(''), 'E_SVG_NO_SIZE'],
  ['zero-size viewBox', svg('viewBox="0 0 0 0"'), 'E_SVG_NO_SIZE'],
  ['malformed XML', svg('width="1" height="1"', '<g>'), 'E_SVG_PARSE'],
  ['root without the SVG namespace', '<svg width="1" height="1"/>', 'E_SVG_PARSE'],
  ['root in another namespace', '<svg xmlns="urn:x" width="1" height="1"/>', 'E_SVG_PARSE'],
  ['over 100 megapixels', svg('width="20000" height="6000"'), 'E_IMAGE_TOO_LARGE'],
];
for (const [name, text, code] of REFUSED) {
  test(`refused: ${name} -> ${code}`, async ({ page }) => {
    const r = await inspect(page, text);
    expect(errors(r)).toEqual([code]);
    expect(r.width).toBeNull();
    const i = r.issues[0];
    for (const f of ['received', 'expected', 'why', 'fix']) expect(i[f].length).toBeGreaterThan(10);
  });
}

test('E_SVG_NO_SIZE names the attributes present and a runnable fix', async ({ page }) => {
  const i = (await inspect(page, svg('width="2em" height="2em"'))).issues[0];
  expect(JSON.parse(i.received)).toBe('width="2em" height="2em"'); // received is JSON-quoted by convention
  expect(i.fix).toContain('width="1200" height="800"');
});

test('E_SVG_PARSE quotes the specific problem, not the engine\'s generic heading, within 200 characters', async ({ page }) => {
  const i = (await inspect(page, svg('width="1" height="1"', '<g>'))).issues[0];
  expect(i.received.length).toBeLessThanOrEqual(120); // makeIssue previews at 120
  expect(i.received).toMatch(/line \d+|error|mismatch|tag/i);
  expect(i.received).not.toMatch(/^"?This page contains the following errors:?"?$/);
});

test('E_SVG_TOO_LARGE above 20 MiB', async ({ page }) => {
  const r = await page.evaluate(() => window.__inspectBig('bytes'));
  expect(errors(r)).toEqual(['E_SVG_TOO_LARGE']);
});

test('W_SVG_COMPLEX above 200,000 elements and not at 200,000', async ({ page }) => {
  const over = await page.evaluate(() => window.__inspectBig('elements-over'));
  expect(over.issues.map((i) => i.code)).toEqual(['W_SVG_COMPLEX']);
  expect(over.issues[0].severity).toBe('warning');
  expect(over.width).toBe(10);
  const at = await page.evaluate(() => window.__inspectBig('elements-at'));
  expect(at.issues).toEqual([]);
});

test('W_SVG_INERT_PARTS counts each kind; data: references are not external', async ({ page }) => {
  const body = '<script>1</script><style>@import url(https://example.invalid/a.css);</style><foreignObject/><image href="https://example.invalid/x.png"/><image href="data:image/png;base64,AAAA"/>';
  const r = await inspect(page, svg('width="10" height="10" onload="1"', body));
  expect(errors(r)).toEqual([]);
  expect(r.issues).toHaveLength(1);
  expect(r.issues[0].code).toBe('W_SVG_INERT_PARTS');
  expect(JSON.parse(r.issues[0].received)).toBe('script ×1, on* attributes ×1, foreignObject ×1, external href ×1, external CSS ×1');
  expect((await inspect(page, svg('width="10" height="10"', '<rect/>'))).issues).toEqual([]);
});
