// Package the committed sample (samples/customer-platform) into dist/sample/:
// the editable .diagram.zip (with this build's editor) and the portable
// .presentation.html. Uses the same code paths the editor uses.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildProjectZip, buildPresentationHtml } from '../src/core/package.js';
import { validateProject } from '../src/core/validate.js';

export async function buildSample({ editor, presentationTemplate, version }, outDir = 'dist') {
  const dir = 'samples/customer-platform';
  const project = JSON.parse(readFileSync(`${dir}/project.json`, 'utf8'));
  const v = validateProject(project);
  if (v.errors.length) throw new Error(`sample project is invalid: ${v.errors.map((e) => `${e.code} at ${e.path}`).join('; ')}`);
  const assets = new Map(project.assets.map((a) => [a.id, new Uint8Array(readFileSync(`${dir}/${a.path}`))]));
  mkdirSync(`${outDir}/sample`, { recursive: true });
  const zip = await buildProjectZip(project, assets, editor, version);
  const html = buildPresentationHtml(presentationTemplate, project, assets, version);
  const zipName = 'customer-platform.diagram.zip';
  const htmlName = 'customer-platform.presentation.html';
  writeFileSync(`${outDir}/sample/${zipName}`, zip.bytes);
  writeFileSync(`${outDir}/sample/${htmlName}`, html);
  return { zipName, htmlName, zipBytes: zip.bytes.length, htmlBytes: Buffer.byteLength(html) };
}
