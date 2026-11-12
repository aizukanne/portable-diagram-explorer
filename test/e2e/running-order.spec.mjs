// S3: the editor's running order (A15, A21).
import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readZip } from '../../src/core/zip.js';

const EDITOR = path.resolve('dist/editor.html');
const T = (f) => path.resolve('dist/test', f);

async function open(page) {
  await page.goto(pathToFileURL(EDITOR).href);
  await expect(page.getByRole('button', { name: 'Export presentation' })).toBeVisible();
}
const openFiles = (page, files) => page.locator('input[data-role="open"]').setInputFiles(files);
async function saveDownload(page, buttonName) {
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: buttonName, exact: true }).click()]);
  const dir = mkdtempSync(path.join(tmpdir(), 'pde-dl-'));
  const p = path.join(dir, d.suggestedFilename());
  await d.saveAs(p);
  return { path: p, name: d.suggestedFilename(), bytes: new Uint8Array(readFileSync(p)) };
}
const diagramBtn = (page, title) => page.locator('.pde-diagram-btn', { hasText: title });

test('A15: build, reorder (drag and keyboard), undo, save, reopen: order kept', async ({ page }) => {
  await open(page); await openFiles(page, T('fixture.diagram.zip'));
  for (const t of ['Identity HLD', 'Shared services', 'Loop A']) {
    await diagramBtn(page, t).click();
    await page.getByRole('button', { name: 'Add to running order' }).click();
  }
  const rows = page.locator('.pde-seq-item');
  await expect(rows).toHaveText([/Identity HLD/, /Shared services/, /Loop A/]);
  await rows.nth(2).getByRole('button', { name: 'Move up' }).click();
  await expect(rows).toHaveText([/Identity HLD/, /Loop A/, /Shared services/]);
  await rows.nth(0).dragTo(rows.nth(2));
  await expect(rows).toHaveText([/Loop A/, /Shared services/, /Identity HLD/]);
  await page.keyboard.press('Control+z');
  await expect(rows).toHaveText([/Identity HLD/, /Loop A/, /Shared services/]);
  await expect(diagramBtn(page, 'Loop A')).toContainText('Slide 2');
  const saved = await saveDownload(page, 'Save project');
  const pj = JSON.parse(new TextDecoder().decode((await readZip(saved.bytes)).get('project.json')));
  assert.deepEqual(pj.sequence.slides, ['d-identity', 'd-loop-a', 'd-shared']);
  assert.equal(pj.schemaVersion, 2);
  await page.reload();
  await openFiles(page, saved.path);
  await expect(page.locator('.pde-seq-item')).toHaveText([/Identity HLD/, /Loop A/, /Shared services/]);
});

test('first save of a v1 file says it is now in the v1.1 format', async ({ page }) => {
  await open(page); await openFiles(page, T('fixture.diagram.zip')); // a v1 package
  await expect(page.locator('.pde-title-input')).toHaveValue('Fixture Platform');
  await saveDownload(page, 'Save project');
  await expect(page.locator('.pde-status')).toContainText('Saved in the v1.1 format; v1 editors cannot open it.');
});

test('A21: deleting a slide diagram says so; undo restores its place', async ({ page }) => {
  await open(page); await openFiles(page, T('fixture.diagram.zip'));
  for (const t of ['Shared services', 'Loop B']) { await diagramBtn(page, t).click(); await page.getByRole('button', { name: 'Add to running order' }).click(); }
  await diagramBtn(page, 'Shared services').click();
  await page.getByRole('button', { name: 'Delete diagram…' }).click();
  await expect(page.getByRole('dialog')).toContainText('It is slide 1 of 2 in the running order and will be removed from it.');
  await page.getByRole('button', { name: 'Delete diagram', exact: true }).click();
  await expect(page.locator('.pde-seq-item')).toHaveText([/Loop B/]);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.pde-seq-item')).toHaveText([/Shared services/, /Loop B/]);
});
