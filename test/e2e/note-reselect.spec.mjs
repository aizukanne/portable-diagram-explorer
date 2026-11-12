// Regression: a note added earlier must stay selectable, editable and deletable
// after it has been deselected (owner report 2026-11-12).
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const EDITOR = path.resolve('dist/editor.html');
const T = (f) => path.resolve('dist/test', f);
const diagramBtn = (page, title) => page.locator('.pde-diagram-btn', { hasText: title });

test('a note can be reselected, edited and deleted after deselecting it', async ({ page }) => {
  await page.goto(pathToFileURL(EDITOR).href);
  await page.locator('input[data-role="open"]').setInputFiles(T('fixture.diagram.zip'));
  await diagramBtn(page, 'Shared services').click();
  await page.getByRole('button', { name: 'Add note' }).click();
  const img = await page.locator('.pde-canvas .pde-image').boundingBox();
  await page.mouse.click(img.x + img.width * 0.05, img.y + img.height * 0.8);
  await page.locator('[data-field="note-text"]').fill('first text');

  // Leave the diagram and come back: nothing is selected now.
  await diagramBtn(page, 'Identity HLD').click();
  await diagramBtn(page, 'Shared services').click();
  await expect(page.locator('[data-field="note-text"]')).toHaveCount(0);

  // Click the note itself.
  await page.locator('.pde-canvas .pde-annotation').click();
  const text = page.locator('[data-field="note-text"]');
  await expect(text).toHaveValue('first text');
  await text.fill('edited text');
  await expect(page.locator('.pde-canvas .pde-annotation')).toHaveText('edited text');

  await page.locator('.pde-inspector').getByRole('button', { name: 'Delete note' }).click();
  await expect(page.locator('.pde-canvas .pde-annotation')).toHaveCount(0);
});

test('a note under a hotspot: the hotspot takes the click, the note is reachable from the inspector list', async ({ page }) => {
  await page.goto(pathToFileURL(EDITOR).href);
  await page.locator('input[data-role="open"]').setInputFiles(T('fixture.diagram.zip'));
  await diagramBtn(page, 'Identity HLD').click();
  const hs = page.locator('.pde-canvas rect.pde-hotspot').first();
  const hsLabel = await hs.getAttribute('aria-label');
  const box = await hs.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.getByRole('button', { name: 'Add note' }).click();
  await page.mouse.click(cx, cy);
  await page.locator('[data-field="note-text"]').fill('hidden under\nsecond line');

  await diagramBtn(page, 'Shared services').click();
  await diagramBtn(page, 'Identity HLD').click();
  // Overlap order: the hotspot wins the click.
  await page.mouse.click(cx, cy);
  await expect(page.locator('[data-field="label"]')).toHaveValue(hsLabel);
  await expect(page.locator('[data-field="note-text"]')).toHaveCount(0);

  // The inspector lists the note by its first line; keyboard reaches it too.
  await page.keyboard.press('Escape');
  await diagramBtn(page, 'Shared services').click();
  await diagramBtn(page, 'Identity HLD').click();
  const link = page.locator('.pde-inspector').getByRole('button', { name: 'hidden under', exact: true });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-field="note-text"]')).toHaveValue('hidden under\nsecond line');
  await page.locator('.pde-inspector').getByRole('button', { name: 'Delete note' }).click();
  // The fixture already carries one (inert, HTML-looking) note on this diagram; only ours goes.
  await expect(page.locator('.pde-canvas .pde-annotation', { hasText: 'hidden under' })).toHaveCount(0);
  await expect(page.locator('.pde-canvas .pde-annotation')).toHaveCount(1);
  await expect(page.locator('.pde-inspector h3', { hasText: 'Notes on this diagram (1)' })).toBeVisible();
});
