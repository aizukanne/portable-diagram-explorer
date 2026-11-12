// S10: the editor, opened via file:// (A02, A09, A11, and the full authoring flow).
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { readFileSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readZip } from '../../src/core/zip.js';

const EDITOR = path.resolve('dist/editor.html');
const T = (f) => path.resolve('dist/test', f);
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function open(page) {
  const external = [];
  page.on('request', (r) => { if (!/^(file|data|blob|about):/.test(r.url())) external.push(r.url()); });
  await page.goto(pathToFileURL(EDITOR).href);
  await expect(page.getByRole('button', { name: 'Export presentation' })).toBeVisible();
  return external;
}
const openFiles = (page, files) => page.locator('input[data-role="open"]').setInputFiles(files);
const addImages = (page, files) => page.locator('input[data-role="add-images"]').setInputFiles(files);
async function saveDownload(page, buttonName) {
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: buttonName, exact: true }).click()]);
  const dir = mkdtempSync(path.join(tmpdir(), 'pde-dl-'));
  const p = path.join(dir, d.suggestedFilename());
  await d.saveAs(p);
  return { path: p, name: d.suggestedFilename(), bytes: new Uint8Array(readFileSync(p)) };
}
const diagramBtn = (page, title) => page.locator('.pde-diagram-btn', { hasText: title });

test('A02: open a package, edit one hotspot, save, reopen: everything else is identical, bytes preserved', async ({ page }) => {
  const external = await open(page);
  await openFiles(page, T('fixture.diagram.zip'));
  await expect(page.locator('.pde-title-input')).toHaveValue('Fixture Platform');
  await expect(page.locator('.pde-dirty')).toHaveText('Saved');
  await diagramBtn(page, 'Identity HLD').click();
  await page.locator('.pde-inspector').getByRole('button', { name: 'Account association' }).click();
  const left = page.locator('[data-field="geo-x"]');
  await expect(left).toHaveValue('10');
  await left.fill('12.5');
  await expect(page.locator('.pde-dirty')).toHaveText('Unsaved changes');
  const saved = await saveDownload(page, 'Save project');
  expect(saved.name).toBe('fixture-platform.diagram.zip');
  await expect(page.locator('.pde-dirty')).toHaveText('Saved');

  const before = await readZip(new Uint8Array(readFileSync(T('fixture.diagram.zip'))));
  const after = await readZip(saved.bytes);
  const pa = JSON.parse(new TextDecoder().decode(before.get('project.json')));
  const pb = JSON.parse(new TextDecoder().decode(after.get('project.json')));
  expect(pb.diagrams[1].hotspots[0].rect.x).toBe(0.125);
  pb.diagrams[1].hotspots[0].rect.x = pa.diagrams[1].hotspots[0].rect.x;
  // The fixture is a v1 file; saving writes the current format (migration changes only the version).
  expect(pa.schemaVersion).toBe(1);
  expect(pb.schemaVersion).toBe(2);
  pb.schemaVersion = pa.schemaVersion;
  expect(pb).toEqual(pa);
  for (const [name, bytes] of before) if (name.startsWith('assets/')) expect(sha(after.get(name))).toBe(sha(bytes));
  // The package carries this editor, byte for byte (design D6).
  expect(sha(after.get('editor.html'))).toBe(sha(readFileSync(EDITOR)));

  // Reopen the saved file in a fresh editor and see the change.
  await page.reload();
  await openFiles(page, saved.path);
  await diagramBtn(page, 'Identity HLD').click();
  await page.locator('.pde-inspector').getByRole('button', { name: 'Account association' }).click();
  await expect(page.locator('[data-field="geo-x"]')).toHaveValue('12.5');
  expect(external).toEqual([]);
});

test('A02: the editor inside a saved package opens it again (continue editing on another computer)', async ({ page }) => {
  const zip = await readZip(new Uint8Array(readFileSync(T('fixture.diagram.zip'))));
  const dir = mkdtempSync(path.join(tmpdir(), 'pde-other-'));
  const ed = path.join(dir, 'editor.html');
  (await import('node:fs')).writeFileSync(ed, zip.get('editor.html'));
  await page.goto(pathToFileURL(ed).href);
  await openFiles(page, T('fixture.diagram.zip'));
  await expect(page.locator('.pde-title-input')).toHaveValue('Fixture Platform');
});

for (const [file, code, keepTitle] of [
  ['missing-asset.diagram.zip', 'E_PKG_MISSING_ASSET', true],
  ['future.diagram.zip', 'E_FUTURE_SCHEMA', true],
  ['corrupt.diagram.zip', 'E_PKG_TRUNCATED', true],
  ['unexpected-entry.diagram.zip', 'E_PKG_UNEXPECTED_ENTRY', true],
]) {
  test(`A09: ${file} shows ${code} and leaves the open project untouched`, async ({ page }) => {
    await open(page);
    await openFiles(page, T('fixture.diagram.zip'));
    await expect(page.locator('.pde-title-input')).toHaveValue('Fixture Platform');
    await openFiles(page, T(file));
    const dlg = page.getByRole('dialog', { name: 'This could not be opened' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.pde-issue-code').first()).toHaveText(code);
    await expect(dlg.getByText('Fix', { exact: true }).first()).toBeVisible();
    await dlg.getByRole('button', { name: 'Close' }).click();
    if (keepTitle) await expect(page.locator('.pde-title-input')).toHaveValue('Fixture Platform');
    await expect(page.locator('.pde-diagram-btn')).toHaveCount(7);
  });
}

test('A09: a dangling target opens with the error listed, and blocks export until fixed', async ({ page }) => {
  await open(page);
  await openFiles(page, T('dangling.diagram.zip'));
  const dlg = page.getByRole('dialog');
  await expect(dlg.locator('.pde-issue-code').first()).toHaveText('E_TARGET_REF');
  await dlg.getByRole('button', { name: 'Go to' }).first().click();
  await expect(page.locator('.pde-inspector h2').first()).toHaveText('Hotspot');
  await expect(page.locator('.pde-inspector select').first()).toHaveValue('');
  await page.getByRole('button', { name: 'Export presentation' }).click();
  await expect(page.getByRole('dialog', { name: 'Fix these problems before exporting' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.pde-inspector select').first().selectOption({ label: 'Account association LLD' });
  await expect(page.locator('.pde-issues-btn')).toHaveText(/^(No problems|0 errors)/);
  const out = await saveDownload(page, 'Export presentation');
  expect(out.name).toBe('dangling-platform.presentation.html');
});

test('A09: an unsupported file is refused by name', async ({ page }) => {
  await open(page);
  // A text file that is an SVG but states no size is refused for that reason (v1.1: SVG is supported).
  await addImages(page, T('images/not-an-image.png'));
  const dlg = page.getByRole('dialog', { name: 'Some files were not imported' });
  await expect(dlg.locator('.pde-issue-code')).toHaveText('E_SVG_NO_SIZE');
  await dlg.getByRole('button', { name: 'Close' }).click();
  // A genuinely unsupported format is still refused as such.
  await addImages(page, T('images/animated.gif'));
  await expect(dlg.locator('.pde-issue-code')).toHaveText('E_IMAGE_TYPE');
});

test('A11: replacing an image with new proportions blocks export until alignment is reviewed', async ({ page }) => {
  await open(page);
  await openFiles(page, T('fixture.diagram.zip'));
  await diagramBtn(page, 'Identity HLD').click();
  await page.locator('input[data-role="replace-image"]').setInputFiles(T('images/square.png'));
  await expect(page.locator('.pde-banner')).toBeVisible();
  await expect(page.locator('.pde-status')).toContainText('proportions changed');
  await page.getByRole('button', { name: 'Export presentation' }).click();
  const dlg = page.getByRole('dialog', { name: 'Fix these problems before exporting' });
  await expect(dlg.locator('.pde-issue-code')).toHaveText(['E_ALIGN_REVIEW']);
  await dlg.getByRole('button', { name: 'Close' }).click();
  // hotspots are kept, not silently moved
  await expect(page.locator('.pde-canvas rect.pde-hotspot')).toHaveCount(2);
  await page.getByRole('button', { name: 'Mark alignment reviewed' }).click();
  await expect(page.locator('.pde-banner')).toBeHidden();
  const out = await saveDownload(page, 'Export presentation');
  expect(out.name).toBe('fixture-platform.presentation.html');
  // undo brings the review requirement back
  await page.keyboard.press('Control+z');
  await expect(page.locator('.pde-banner')).toBeVisible();
});

test('authoring flow: images in, hotspots drawn, actions set, preview, export; the export works offline', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  const external = await open(page);
  await addImages(page, [T('images/overview.png'), T('images/service-hld.png'), T('images/service-lld.png')]);
  await expect(page.locator('.pde-diagram-btn')).toHaveCount(3);
  await expect(page.locator('.pde-root-badge')).toHaveCount(1);
  await page.locator('.pde-title-input').fill('Authored Platform');

  // Draw a hotspot over the left box of the overview.
  await diagramBtn(page, 'Overview').click();
  await page.getByRole('button', { name: 'Add hotspot' }).click();
  const img = await page.locator('.pde-canvas .pde-image').boundingBox();
  await page.mouse.move(img.x + img.width * 0.1, img.y + img.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(img.x + img.width * 0.4, img.y + img.height * 0.5, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.pde-inspector h2').first()).toHaveText('Hotspot');
  await expect(page.locator('[data-field="label"]')).toBeFocused();
  await page.locator('[data-field="label"]').fill('Service');
  await page.locator('[data-field="tooltip"]').fill('The service');
  await page.getByRole('button', { name: 'Open diagram' }).click();
  await page.locator('.pde-action select').selectOption({ label: 'Service hld' });
  await page.getByRole('button', { name: 'Description' }).click();
  await page.locator('.pde-action textarea').fill('Line one\nLine two');
  const x = Number(await page.locator('[data-field="geo-x"]').inputValue());
  expect(Math.abs(x - 10)).toBeLessThan(0.6);

  // Duplicate, move with the keyboard, delete, undo, redo.
  await page.keyboard.press('Escape');
  await page.locator('.pde-canvas rect.pde-hotspot').click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('.pde-canvas rect.pde-hotspot')).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(page.locator('.pde-canvas rect.pde-hotspot')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.pde-canvas rect.pde-hotspot')).toHaveCount(2);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.pde-canvas rect.pde-hotspot')).toHaveCount(1);

  // A note on the child diagram, and a hotspot onward to the LLD.
  await diagramBtn(page, 'Service hld').click();
  await page.getByRole('button', { name: 'Add note' }).click();
  const img2 = await page.locator('.pde-canvas .pde-image').boundingBox();
  await page.mouse.click(img2.x + img2.width * 0.05, img2.y + img2.height * 0.8);
  await page.locator('[data-field="note-text"]').fill('<b>plain</b> note');
  await page.getByRole('button', { name: 'Add hotspot' }).click();
  await page.mouse.move(img2.x + img2.width * 0.2, img2.y + img2.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(img2.x + img2.width * 0.7, img2.y + img2.height * 0.6, { steps: 6 });
  await page.mouse.up();
  await page.locator('[data-field="label"]').fill('Store');
  await page.getByRole('button', { name: 'Open diagram' }).click();
  await page.locator('.pde-action select').selectOption({ label: 'Service lld' });

  // Preview: drill down exactly as a recipient would.
  await page.getByRole('button', { name: 'Preview' }).click();
  const pv = page.locator('.pde-preview');
  await pv.locator('.pde-root-view rect.pde-hotspot[aria-label="Service"]').click();
  await expect(pv.locator('.pde-modal-title')).toHaveText('Service hld');
  await expect(pv.frameLocator('iframe').locator('.pde-annotation')).toHaveText('<b>plain</b> note');
  await pv.frameLocator('iframe').getByRole('button', { name: 'Store', exact: true }).click();
  await expect(pv.locator('.pde-modal-title')).toHaveText('Service lld');
  await pv.getByRole('button', { name: 'Close', exact: true }).click();
  await pv.getByRole('button', { name: 'Exit preview' }).click();
  await expect(pv).toHaveCount(0);

  // Export, then open the exported file as a recipient would.
  const out = await saveDownload(page, 'Export presentation');
  expect(out.name).toBe('authored-platform.presentation.html');
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  const ext2 = [];
  p2.on('request', (r) => { if (!/^(file|data|blob|about):/.test(r.url())) ext2.push(r.url()); });
  await p2.goto(pathToFileURL(out.path).href);
  await expect(p2.locator('.pde-project-title')).toHaveText('Authored Platform');
  await p2.locator('.pde-root-view rect.pde-hotspot[aria-label="Service"]').click({ button: 'right' });
  await expect(p2.getByRole('menuitem')).toHaveText(['Open diagram', 'Read description']);
  await p2.getByRole('menuitem', { name: 'Read description' }).click();
  await expect(p2.locator('.pde-details-text')).toHaveText('Line one\nLine two');
  await ctx.close();

  // The editor can re-import the presentation it exported.
  await page.reload();
  await openFiles(page, out.path);
  await expect(page.locator('.pde-title-input')).toHaveValue('Authored Platform');
  await expect(page.locator('.pde-diagram-btn')).toHaveCount(3);
  expect(external).toEqual([]);
  expect(ext2).toEqual([]);
});

test('unsaved changes are flagged and a new project asks before discarding them', async ({ page }) => {
  await open(page);
  await addImages(page, T('images/overview.png'));
  await expect(page.locator('.pde-dirty')).toHaveText('Unsaved changes');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Unsaved changes' });
  await expect(dlg).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pde-diagram-btn')).toHaveCount(1);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.locator('.pde-diagram-btn')).toHaveCount(0);
});

test('deleting a linked diagram asks where the links should go, and undo restores it', async ({ page }) => {
  await open(page);
  await openFiles(page, T('fixture.diagram.zip'));
  await diagramBtn(page, 'Account association LLD').click();
  await page.getByRole('button', { name: 'Delete diagram…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Delete diagram' });
  await expect(dlg.locator('li')).toHaveCount(2);
  await dlg.getByRole('combobox', { name: 'New target' }).selectOption({ label: 'Mapping table detail' });
  await dlg.getByRole('button', { name: 'Delete diagram' }).click();
  await expect(page.locator('.pde-diagram-btn')).toHaveCount(6);
  await expect(page.locator('.pde-issues-btn')).toHaveText(/^(No problems|0 errors)/);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.pde-diagram-btn')).toHaveCount(7);
});
