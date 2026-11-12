// The shipped sample (spec §15): a three-level drill-down that works offline,
// and an editable package whose own editor opens it.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readZip } from '../../src/core/zip.js';

test('sample presentation: overview → HLD → LLD → back, offline', async ({ page }) => {
  const external = [];
  page.on('request', (r) => { if (!/^(file|data|blob|about):/.test(r.url())) external.push(r.url()); });
  await page.goto(pathToFileURL(path.resolve('dist/sample/customer-platform.presentation.html')).href);
  await expect(page.locator('.pde-project-title')).toHaveText('Customer Platform');
  await page.locator('.pde-root-view rect.pde-hotspot[aria-label="Identity service"]').click();
  await expect(page.locator('.pde-modal-title')).toHaveText('Identity service HLD');
  await page.frameLocator('iframe').getByRole('button', { name: 'Account association', exact: true }).click();
  await expect(page.locator('.pde-modal-title')).toHaveText('Account association LLD');
  expect((await page.locator('.pde-modal .pde-crumbs li').allTextContents()).map((s) => s.trim()))
    .toEqual(['Slide 1 of 3 › Customer Platform overview', 'Identity service HLD', 'Account association LLD']); // the sample has a three-slide running order (v1.1)
  await page.frameLocator('iframe').getByRole('button', { name: 'account_links', exact: true }).click();
  await expect(page.locator('.pde-modal .pde-details-text')).toContainText('role        viewer | operator | owner');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.pde-modal-title')).toHaveText('Identity service HLD');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.pde-root-view rect.pde-hotspot[aria-label="Billing service"]').click();
  await expect(page.getByRole('menuitem')).toHaveText(['Read description', 'Open data platform']);
  // The sample's running order: overview, Identity service HLD, Account association LLD.
  await page.keyboard.press('Escape'); // closes the open menu
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('.pde-viewer > [role=status]')).toHaveText('Slide 2 of 3: Identity service HLD');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('.pde-viewer > [role=status]')).toHaveText('Slide 3 of 3: Account association LLD');
  expect(external).toEqual([]);
});

test('sample package: its own editor.html opens it for editing', async ({ page }) => {
  const zipBytes = new Uint8Array(readFileSync('dist/sample/customer-platform.diagram.zip'));
  const files = await readZip(zipBytes);
  const dir = mkdtempSync(path.join(tmpdir(), 'pde-sample-'));
  writeFileSync(path.join(dir, 'editor.html'), files.get('editor.html'));
  await page.goto(pathToFileURL(path.join(dir, 'editor.html')).href);
  await page.locator('input[data-role="open"]').setInputFiles(path.resolve('dist/sample/customer-platform.diagram.zip'));
  await expect(page.locator('.pde-title-input')).toHaveValue('Customer Platform');
  await expect(page.locator('.pde-diagram-btn')).toHaveCount(4);
  await expect(page.locator('.pde-issues-btn')).toHaveText('No problems');
  expect(new TextDecoder().decode(files.get('README.txt'))).toContain('Open editor.html');
});
