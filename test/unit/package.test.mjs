import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { png } from '../helpers/png.mjs';
import { buildProjectZip, readProjectZip, readLooseFiles, buildPresentationHtml, readPresentationHtml, assignAssetPaths } from '../../src/core/package.js';
import { writeZip, readZip } from '../../src/core/zip.js';
import { measureEnvelope } from '../../src/core/envelope.js';
import { sniffImage, sniffFileKind, slug } from '../../src/core/sniff.js';
import { buildAll } from '../../build/build.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const enc = (s) => new TextEncoder().encode(s);
const sample = () => JSON.parse(readFileSync('test/fixtures/sample-project.json', 'utf8'));

const fixture = () => {
  const project = sample();
  const assets = new Map(project.assets.map((a, i) => [a.id, png(4 + i, 3 + i, [i * 60, 100, 150])]));
  return { project, assets };
};

const out = mkdtempSync(path.join(tmpdir(), 'pde-pkg-'));
const TEMPLATE = (await buildAll({ outDir: out })).presentationTemplate;
test.after(() => rmSync(out, { recursive: true, force: true }));

test('sniffing decides the type from bytes; slugs are safe', () => {
  assert.equal(sniffImage(png(1, 1)).mimeType, 'image/png');
  assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])).mimeType, 'image/jpeg');
  assert.equal(sniffImage(enc('RIFF\0\0\0\0WEBPVP8 ')).mimeType, 'image/webp');
  assert.equal(sniffImage(enc('<svg xmlns="x"></svg>')), null);
  assert.equal(sniffFileKind(enc('﻿  {"a":1}')), 'json');
  assert.equal(sniffFileKind(enc('<!doctype html>')), 'html');
  assert.equal(slug('Überblick: Platform (v2).PNG'), 'uberblick-platform-v2');
  assert.equal(slug('../../etc/passwd'), 'etc-passwd');
  assert.equal(slug('***'), 'untitled');
});

test('project zip round trip preserves everything and asset bytes exactly; paths are deterministic', async () => {
  const { project: v1project, assets } = fixture();
  const project = { ...v1project, schemaVersion: 2 };
  const { bytes } = await buildProjectZip(project, assets, '<!doctype html><title>e</title>', '0.1.0');
  const back = await readProjectZip(bytes);
  assert.deepEqual(back.issues.filter((i) => i.severity === 'error'), []);
  for (const [id, b] of assets) assert.deepEqual(back.assets.get(id), b);
  assert.equal(back.project.assets[0].path, 'assets/a-overview-overview.png');
  const strip = (p) => ({ ...p, assets: p.assets.map(({ path: _p, ...rest }) => rest) });
  assert.deepEqual(strip(back.project), strip(project));
  // Saving the re-opened project gives the same archive again (no drift across saves).
  const again = await buildProjectZip(back.project, back.assets, '<!doctype html><title>e</title>', '0.1.0');
  assert.deepEqual(again.bytes, bytes);
  const files = await readZip(bytes);
  assert.deepEqual([...files.keys()].sort(), ['README.txt', 'assets/a-identity-identity.png', 'assets/a-mapping-mapping.png', 'assets/a-overview-overview.png', 'editor.html', 'project.json']);
});

test('asset ids differing only in case still get distinct paths', () => {
  const paths = assignAssetPaths({ assets: [{ id: 'A-x', mimeType: 'image/png', path: 'assets/p.png' }, { id: 'a-x', mimeType: 'image/png', path: 'assets/p.png' }] }).map((a) => a.path);
  assert.equal(new Set(paths).size, 2);
});

test('an unexpected zip entry is rejected by name; nothing is opened', async () => {
  const zip = await writeZip([{ name: 'project.json', bytes: enc(JSON.stringify(sample())) }, { name: 'run.sh', bytes: enc('rm -rf /') }]);
  const r = await readProjectZip(zip);
  assert.equal(r.project, null);
  assert.equal(r.issues[0].code, 'E_PKG_UNEXPECTED_ENTRY');
  assert.equal(r.issues[0].received, '"run.sh"');
});

test('a corrupt archive becomes an issue, not an exception', async () => {
  const r = await readProjectZip(enc('PK\u0003\u0004 truncated garbage'));
  assert.equal(r.project, null);
  assert.equal(r.issues[0].code, 'E_PKG_TRUNCATED');
});

test('a missing image file and a mismatched image type are explicit errors', async () => {
  const { project, assets } = fixture();
  const { bytes } = await buildProjectZip(project, assets, 'x');
  const files = await readZip(bytes);
  files.delete('assets/a-mapping-mapping.png');
  const r1 = await readProjectZip(await writeZip([...files].map(([name, b]) => ({ name, bytes: b }))));
  assert.equal(r1.project, null);
  assert.equal(r1.issues[0].code, 'E_PKG_MISSING_ASSET');
  files.set('assets/a-mapping-mapping.png', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]));
  const r2 = await readProjectZip(await writeZip([...files].map(([name, b]) => ({ name, bytes: b }))));
  assert.equal(r2.issues[0].code, 'E_ASSET_TYPE');
});

test('semantic errors open the project with the errors listed (content is never dropped)', async () => {
  const { project, assets } = fixture();
  project.diagrams[0].hotspots[0].actions[0].targetDiagramId = 'd-gone';
  const { bytes } = await buildProjectZip(project, assets, 'x');
  const r = await readProjectZip(bytes);
  assert.ok(r.project);
  assert.ok(r.issues.some((i) => i.code === 'E_TARGET_REF'));
});

test('future schema is refused before anything else', async () => {
  const { project, assets } = fixture();
  project.schemaVersion = 7;
  const { bytes } = await buildProjectZip(project, assets, 'x');
  const r = await readProjectZip(bytes);
  assert.equal(r.project, null);
  assert.equal(r.issues[0].code, 'E_FUTURE_SCHEMA');
});

test('supplied editor.html is never part of the result', async () => {
  const { project, assets } = fixture();
  const { bytes } = await buildProjectZip(project, assets, '<script>evil()</script>');
  const r = await readProjectZip(bytes);
  assert.ok(!JSON.stringify(Object.keys(r)).includes('editor'));
});

test('presentation embeds data inertly, round-trips, and carries only referenced images', () => {
  const { project, assets } = fixture();
  project.title = 'A & B </title><script>x()</script>';
  project.diagrams[0].description = '</script><img src=x onerror=alert(1)> ';
  project.assets.push({ id: 'a-unused', path: 'assets/unused.png', mimeType: 'image/png', width: 1, height: 1 });
  assets.set('a-unused', png(1, 1));
  const html = buildPresentationHtml(TEMPLATE, project, assets, '0.1.0');
  assert.equal(html.match(/<\/script>/g).length, TEMPLATE.match(/<\/script>/g).length);
  assert.equal(html.match(/<script/g).length, TEMPLATE.match(/<script/g).length);
  assert.match(html, /<title>A &amp; B &lt;\/title&gt;&lt;script&gt;x\(\)&lt;\/script&gt;<\/title>/);
  const r = readPresentationHtml(html);
  assert.equal(r.project.diagrams[0].description, project.diagrams[0].description);
  assert.ok(!r.project.assets.some((a) => a.id === 'a-unused'));
  for (const a of r.project.assets) assert.deepEqual(r.assets.get(a.id), assets.get(a.id));
});

test('export refuses a project with errors', () => {
  const { project, assets } = fixture();
  project.diagrams[1].alignmentReviewRequired = true;
  assert.throws(() => buildPresentationHtml(TEMPLATE, project, assets, '0.1.0'), /E_ALIGN_REVIEW/);
});

test('a page that is not our presentation is refused with an explanation', () => {
  const r = readPresentationHtml('<!doctype html><p>hello</p>');
  assert.equal(r.project, null);
  assert.equal(r.issues[0].code, 'E_PRES_NO_DATA');
});

test('loose files: match by path, then by unique name; duplicates are never guessed', () => {
  const { project, assets } = fixture();
  const pj = { name: 'project.json', relativePath: 'proj/project.json', bytes: enc(JSON.stringify(project)) };
  const imgs = project.assets.map((a) => ({ name: a.path.split('/').pop(), relativePath: `proj/${a.path}`, bytes: assets.get(a.id) }));
  assert.equal(readLooseFiles([pj, ...imgs]).issues.filter((i) => i.severity === 'error').length, 0);
  const flat = imgs.map((f) => ({ ...f, relativePath: '' }));
  assert.ok(readLooseFiles([pj, ...flat]).project);
  const dup = [pj, ...flat, { ...flat[0], relativePath: '' }];
  const r = readLooseFiles(dup);
  assert.equal(r.project, null);
  assert.equal(r.issues[0].code, 'E_AMBIGUOUS_ASSET');
});

test('envelope warns above the spec §12 numbers and not below', () => {
  const { project, assets } = fixture();
  assert.deepEqual(measureEnvelope(project, assets).warnings, []);
  const big = structuredClone(project);
  for (let i = 0; i < 51; i++) big.diagrams.push({ ...structuredClone(project.diagrams[2]), id: `d-x${i}` });
  big.diagrams[0].hotspots = Array.from({ length: 101 }, (_, i) => ({ ...structuredClone(project.diagrams[0].hotspots[0]), id: `h${i}` }));
  const codes = measureEnvelope(big, assets).warnings.map((w) => w.code);
  assert.ok(codes.includes('W_ENVELOPE_DIAGRAMS') && codes.includes('W_ENVELOPE_SCENE'));
});

test('presentation format 2 round-trips the running order; format 1 still reads', () => {
  const { project, assets } = fixture();
  const p = { ...project, schemaVersion: 2, sequence: { slides: [project.diagrams[1].id] } };
  const back = readPresentationHtml(buildPresentationHtml(TEMPLATE, p, assets, '0.2.0'));
  assert.deepEqual(back.project.sequence, { slides: [project.diagrams[1].id] });
  assert.equal(back.migratedFrom, null);
  const v1 = buildPresentationHtml(TEMPLATE, project, assets, '0.1.0').replace('"formatVersion":2', '"formatVersion":1');
  assert.ok(v1.includes('"formatVersion":1'));
  const r1 = readPresentationHtml(v1);
  assert.equal(r1.issues.filter((i) => i.severity === 'error').length, 0);
  assert.equal(r1.migratedFrom, 1);
});

test('README in a saved package states schemaVersion 2; SVG assets get .svg paths', async () => {
  const { project, assets } = fixture();
  const p = { ...project, schemaVersion: 2 };
  assert.match(assignAssetPaths({ ...p, assets: [{ ...p.assets[0], mimeType: 'image/svg+xml' }] })[0].path, /\.svg$/);
  const { bytes } = await buildProjectZip(p, assets, '<html></html>', '0.2.0');
  assert.match(new TextDecoder().decode((await readZip(bytes)).get('README.txt')), /schemaVersion 2/);
});

test('readProjectZip and readLooseFiles report migratedFrom 1 for a v1 file, null for v2', async () => {
  const { project, assets } = fixture();
  const v1zip = await buildProjectZip(project, assets, '<html></html>', '0.1.0');
  assert.equal((await readProjectZip(v1zip.bytes)).migratedFrom, 1);
  const p2 = { ...project, schemaVersion: 2 };
  const v2zip = await buildProjectZip(p2, assets, '<html></html>', '0.2.0');
  assert.equal((await readProjectZip(v2zip.bytes)).migratedFrom, null);
  const files = (pr, zip) => [{ name: 'project.json', bytes: enc(JSON.stringify(pr)) },
    ...zip.project.assets.map((a) => ({ name: a.path.replace(/^.*\//, ''), relativePath: a.path, bytes: assets.get(a.id) }))];
  assert.equal(readLooseFiles(files(zip1(v1zip), v1zip)).migratedFrom, 1);
  assert.equal(readLooseFiles(files(zip1(v2zip), v2zip)).migratedFrom, null);
  function zip1(z) { return z.project; }
});

test('SVG sniffing: preamble tolerated, HTML containing <svg> is not SVG (Review focus 3)', () => {
  const svg = enc('\uFEFF<?xml version="1.0"?>\n<!-- c -->\n<!DOCTYPE svg>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  assert.equal(sniffImage(svg).mimeType, 'image/svg+xml');
  assert.equal(sniffImage(svg).ext, 'svg');
  assert.equal(sniffFileKind(svg), 'image');
  const html = enc('<!doctype html><html><body><svg xmlns="http://www.w3.org/2000/svg"></svg></body></html>');
  assert.equal(sniffImage(html), null);
  assert.equal(sniffFileKind(html), 'html');
  assert.equal(sniffImage(enc('<svg width="1" height="1"/>')), null); // no SVG namespace
  assert.equal(sniffImage(enc("<svg xmlns='http://www.w3.org/2000/svg'/>")).mimeType, 'image/svg+xml'); // single quotes
  assert.equal(sniffImage(enc('<svgfoo xmlns="http://www.w3.org/2000/svg"/>')), null); // root name must end at the tag name
});

test('a presentation with an SVG whose root tag follows a long preamble opens in the viewer (header-only check)', async () => {
  const { readPresentationData } = await import('../../src/core/package.js');
  const { project, assets } = fixture();
  const svg = enc(`<?xml version="1.0"?>\n<!-- ${'x'.repeat(3000)} -->\n<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1" height="1"/></svg>`);
  assets.set('a-overview', svg);
  project.assets.find((a) => a.id === 'a-overview').mimeType = 'image/svg+xml';
  project.assets.find((a) => a.id === 'a-overview').path = 'assets/overview.svg';
  const html = buildPresentationHtml(TEMPLATE, project, assets, '0.1.0');
  const block = html.match(/<script type="application\/json" id="pde-data">([\s\S]*?)<\/script>/)[1];
  const r = readPresentationData(block, { decodeAssets: false });
  assert.ok(r.project);
  assert.deepEqual(r.issues.filter((i) => i.severity === 'error'), []);
});
