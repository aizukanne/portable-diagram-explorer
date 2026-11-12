// A29 (compatibility): a v1.1 file opened in the REAL v1 editor (build of commit 007c71c, version 0.1.0)
// must get v1's own "made by a newer version" error, keep the open project, and lose nothing.
// To repeat (from the repo root; the worktree must be OUTSIDE the repo, never under /tmp):
//   git worktree add /home/sadmin/pde-v010-a29 007c71c
//   (cd /home/sadmin/pde-v010-a29 && node build/build.mjs)
//   cp /home/sadmin/pde-v010-a29/dist/editor.html spike/a29/v010-editor.html
//   npm run build   # the current editor and its test fixtures in dist/
//   PW_CONFIG=spike/a29/playwright.config.mjs scripts/e2e.sh
//   git worktree remove /home/sadmin/pde-v010-a29 && git worktree prune
// Throwaway check; the v1 editor is copied to spike/a29/v010-editor.html (gitignored).
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readZip } from '../../src/core/zip.js';

const NEW_EDITOR = path.resolve('dist/editor.html');
const V1_EDITOR = path.resolve('spike/a29/v010-editor.html');
const T = (f) => path.resolve('dist/test', f);
const openFiles = (page, files) => page.locator('input[data-role="open"]').setInputFiles(files);
async function saveDownload(page, buttonName) {
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: buttonName, exact: true }).click()]);
  const dir = mkdtempSync(path.join(tmpdir(), 'pde-a29-'));
  const p = path.join(dir, d.suggestedFilename());
  await d.saveAs(p);
  return { path: p, name: d.suggestedFilename(), bytes: new Uint8Array(readFileSync(p)) };
}

test('A29: v1.1 package and v1.1 presentation in the v1 editor -> E_FUTURE_SCHEMA, project kept, nothing lost', async ({ page }) => {
  // 1. Make a v1.1 package and presentation with the CURRENT editor (with a running order, so it is truly v2).
  await page.goto(pathToFileURL(NEW_EDITOR).href);
  await openFiles(page, T('fixture.diagram.zip'));
  await page.locator('.pde-diagram-btn', { hasText: 'Identity HLD' }).click();
  await page.getByRole('button', { name: 'Add to running order' }).click();
  const pkg = await saveDownload(page, 'Save project');
  const pres = await saveDownload(page, 'Export presentation');
  const pj = JSON.parse(new TextDecoder().decode((await readZip(pkg.bytes)).get('project.json')));
  expect(pj.schemaVersion).toBe(2);
  expect(pj.sequence.slides).toEqual(['d-identity']);

  // 2. The v1 editor (sanity: it IS v1, and it opens the v1 fixture).
  await page.goto(pathToFileURL(V1_EDITOR).href);
  await expect(page.getByRole('button', { name: 'Export presentation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to running order' })).toHaveCount(0);
  await openFiles(page, T('fixture.diagram.zip'));
  await expect(page.locator('.pde-title-input')).toHaveValue('Fixture Platform');
  const countBefore = await page.locator('.pde-diagram-btn').count();

  // 3. Feed it each v1.1 file.
  const seen = {};
  for (const [label, file] of [['package', pkg.path], ['presentation', pres.path]]) {
    await openFiles(page, file);
    const dlg = page.getByRole('dialog', { name: 'This could not be opened' });
    await expect(dlg).toBeVisible();
    seen[label] = {
      codes: await dlg.locator('.pde-issue-code').allTextContents(),
      text: (await dlg.innerText()).replace(/\s+/g, ' ').slice(0, 600),
    };
    await expect(dlg.locator('.pde-issue-code').first()).toHaveText('E_FUTURE_SCHEMA');
    await dlg.getByRole('button', { name: 'Close' }).click();
    // Project not opened, nothing lost: the earlier project is still there, unchanged.
    await expect(page.locator('.pde-title-input')).toHaveValue('Fixture Platform');
    await expect(page.locator('.pde-diagram-btn')).toHaveCount(countBefore);
    await expect(page.locator('.pde-dirty')).toHaveText('Saved');
  }
  // 4. And the v1.1 files on disk are untouched (the editor only reads them).
  expect(new Uint8Array(readFileSync(pkg.path)).length).toBe(pkg.bytes.length);
  mkdirSync(path.resolve('spike/a29/out'), { recursive: true });
  writeFileSync(path.resolve('spike/a29/out/result-' + test.info().project.name + '.json'), JSON.stringify(seen, null, 2));
  console.log('A29 RESULT ' + test.info().project.name + ' ' + JSON.stringify(seen));
});
