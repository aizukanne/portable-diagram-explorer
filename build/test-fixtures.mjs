// Test fixtures for the browser suite (written to dist/test/ by `build --test`).
// The viewer fixture is produced through the real export path.
import { writeFileSync, mkdirSync } from 'node:fs';
import { png } from '../test/helpers/png.mjs';
import { DIAGRAM_SVG, RISKY_SVG, NOSIZE_SVG } from '../test/helpers/svg.mjs';
import { buildPresentationHtml, buildProjectZip } from '../src/core/package.js';
import { writeZip, readZip } from '../src/core/zip.js';

const box = (x, y, w, h, rgb) => ({ x, y, w, h, rgb });
const hs = (id, label, tooltip, rect, actions, defaultActionId = null, zIndex = 1) => ({ id, label, tooltip, rect, zIndex, defaultActionId, actions });
const open = (id, label, target) => ({ id, label, type: 'diagram', targetDiagramId: target });
const read = (id, label, text) => ({ id, label, type: 'details', text });

export function viewerFixture() {
  const R = { x: 0.1, y: 0.15, width: 0.25, height: 0.2 };
  const R2 = { x: 0.55, y: 0.15, width: 0.25, height: 0.2 };
  const R3 = { x: 0.1, y: 0.6, width: 0.25, height: 0.2 };
  const R4 = { x: 0.55, y: 0.6, width: 0.25, height: 0.2 };
  const project = {
    schemaVersion: 1, projectId: 'p-fixture', title: 'Fixture Platform', rootDiagramId: 'd-overview',
    assets: [
      { id: 'a-overview', path: 'assets/overview.png', mimeType: 'image/png', width: 1600, height: 900 },
      { id: 'a-identity', path: 'assets/identity.png', mimeType: 'image/png', width: 1200, height: 800 },
      { id: 'a-mapping', path: 'assets/mapping.png', mimeType: 'image/png', width: 1000, height: 1000 },
      { id: 'a-detail', path: 'assets/detail.png', mimeType: 'image/png', width: 900, height: 600 },
      { id: 'a-shared', path: 'assets/shared.png', mimeType: 'image/png', width: 800, height: 500 },
    ],
    diagrams: [
      { id: 'd-overview', title: 'Platform overview', assetId: 'a-overview', description: 'Main systems.\nSecond line.', annotations: [{ id: 'n-o', text: 'Overview note', x: 0.05, y: 0.88, width: 0.4 }], hotspots: [
        hs('h-identity', 'Identity service', 'Authentication and accounts', R, [open('o-id', 'Open HLD', 'd-identity'), read('r-id', 'Read description', 'Authenticates users.\nResolves accounts.')], 'o-id'),
        hs('h-billing', 'Billing', 'Invoices and payments', R2, [open('o-bill-shared', 'Open shared services', 'd-shared'), open('o-bill-lld', 'Open LLD', 'd-mapping'), read('r-bill', 'Read description', 'Billing text.')]),
        hs('h-notes', 'Audit log', 'Read-only description', R3, [read('r-audit', 'Read description', 'Every change is recorded.')]),
        hs('h-loop', 'Loop', 'Cycle test', R4, [open('o-loop', 'Open loop A', 'd-loop-a')], 'o-loop'),
      ] },
      { id: 'd-identity', title: 'Identity HLD', assetId: 'a-identity', description: 'Identity high-level design.', annotations: [{ id: 'n-x', text: '<img src=x onerror="window.top.pwned=1">', x: 0.05, y: 0.85, width: 0.6 }], hotspots: [
        hs('h-assoc', 'Account association', 'Open the LLD', R, [open('o-assoc', 'Open LLD', 'd-mapping')], 'o-assoc'),
        hs('h-shared-from-id', 'Shared services', 'Common platform services', R2, [open('o-sh', 'Open shared services', 'd-shared')], 'o-sh'),
      ] },
      { id: 'd-mapping', title: 'Account association LLD', assetId: 'a-mapping', annotations: [], hotspots: [
        hs('h-table', 'Mapping table', 'Detail of the table', R, [open('o-detail', 'Open detail', 'd-detail'), read('r-table', 'Read description', 'Table detail text.')], 'o-detail'),
      ] },
      { id: 'd-detail', title: 'Mapping table detail', assetId: 'a-detail', annotations: [], hotspots: [
        hs('h-col', 'Key column', 'A column', R, [read('r-col', 'Read description', 'The key column.')]),
      ] },
      { id: 'd-shared', title: 'Shared services', assetId: 'a-shared', annotations: [], hotspots: [] },
      { id: 'd-loop-a', title: 'Loop A', assetId: 'a-shared', annotations: [], hotspots: [hs('h-to-b', 'To B', 'Go to B', { x: 0.3, y: 0.3, width: 0.4, height: 0.4 }, [open('o-b', 'Open B', 'd-loop-b')], 'o-b')] },
      { id: 'd-loop-b', title: 'Loop B', assetId: 'a-detail', annotations: [], hotspots: [hs('h-to-a', 'To A', 'Go to A', { x: 0.3, y: 0.3, width: 0.4, height: 0.4 }, [open('o-a', 'Open A', 'd-loop-a')], 'o-a')] },
    ],
    settings: { tooltipDelayMs: 200, showHotspotHints: true },
  };
  const color = (rgb) => [box(R.x, R.y, R.width, R.height, rgb), box(R2.x, R2.y, R2.width, R2.height, rgb), box(R3.x, R3.y, R3.width, R3.height, rgb), box(R4.x, R4.y, R4.width, R4.height, rgb)];
  const assets = new Map([
    ['a-overview', png(1600, 900, [236, 242, 250], color([120, 160, 220]))],
    ['a-identity', png(1200, 800, [245, 240, 230], color([220, 160, 90]))],
    ['a-mapping', png(1000, 1000, [235, 248, 238], color([90, 180, 120]))],
    ['a-detail', png(900, 600, [248, 236, 246], color([190, 110, 180]))],
    ['a-shared', png(800, 500, [240, 240, 240], [box(0.3, 0.3, 0.4, 0.4, [150, 150, 150])])],
  ]);
  return { project, assets };
}

export async function writeTestFixtures(outDir, presentationTemplate, version, editorHtml) {
  const { project, assets } = viewerFixture();
  const t = `${outDir}/test`;
  // Running-order fixtures (schema v2): one without the overview in the sequence, one with it.
  const slidesProject = (slides) => ({ ...structuredClone(project), schemaVersion: 2, sequence: { slides } });
  writeFileSync(`${t}/slides.presentation.html`, buildPresentationHtml(presentationTemplate, slidesProject(['d-loop-a', 'd-identity', 'd-shared']), assets, version));
  writeFileSync(`${t}/slides-with-overview.presentation.html`, buildPresentationHtml(presentationTemplate, slidesProject(['d-overview', 'd-identity', 'd-shared']), assets, version));
  writeFileSync(`${t}/viewer-fixture.presentation.html`, buildPresentationHtml(presentationTemplate, project, assets, version));
  // Editor fixtures (A02, A09, A11, authoring): a saved package and hostile variants.
  const good = await buildProjectZip(project, assets, editorHtml, version);
  writeFileSync(`${t}/fixture.diagram.zip`, good.bytes);
  const files = await readZip(good.bytes);
  const rezip = async (name, mutate) => {
    const m = new Map(files);
    await mutate(m);
    writeFileSync(`${t}/${name}`, await writeZip([...m].map(([n, b]) => ({ name: n, bytes: b }))));
  };
  const pj = () => JSON.parse(new TextDecoder().decode(files.get('project.json')));
  const put = (m, obj) => m.set('project.json', new TextEncoder().encode(JSON.stringify(obj, null, 2)));
  await rezip('missing-asset.diagram.zip', (m) => { m.delete('assets/a-mapping-mapping.png'); });
  await rezip('dangling.diagram.zip', (m) => { const o = pj(); o.title = 'Dangling Platform'; o.diagrams[1].hotspots[0].actions[0].targetDiagramId = 'd-gone'; put(m, o); });
  await rezip('empty-sequence.diagram.zip', (m) => { const o = pj(); o.schemaVersion = 2; o.sequence = { slides: [] }; put(m, o); });
  await rezip('future.diagram.zip', (m) => { const o = pj(); o.schemaVersion = 9; put(m, o); });
  await rezip('unexpected-entry.diagram.zip', (m) => { m.set('run.sh', new TextEncoder().encode('echo hi')); });
  const junk = new Uint8Array([0, 5, 22, 7]);
  await rezip('finder-rezip.diagram.zip', (m) => {
    const wrapped = [...m].map(([n, b]) => [`Fixture Platform/${n}`, b]);
    m.clear();
    for (const [n, b] of wrapped) m.set(n, b);
    m.set('__MACOSX/Fixture Platform/._project.json', junk);
    m.set('Fixture Platform/.DS_Store', junk);
  });
  await rezip('windows-rezip.diagram.zip', (m) => { m.set('Thumbs.db', junk); m.set('assets/desktop.ini', junk); });
  writeFileSync(`${t}/corrupt.diagram.zip`, new Uint8Array(Buffer.from('PK\u0003\u0004 this archive was cut short')));
  mkdirSync(`${t}/images`, { recursive: true });
  writeFileSync(`${t}/images/overview.png`, png(1200, 700, [230, 240, 252], [box(0.1, 0.2, 0.3, 0.3, [80, 120, 200]), box(0.6, 0.2, 0.3, 0.3, [200, 120, 80])]));
  writeFileSync(`${t}/images/service-hld.png`, png(1000, 600, [250, 240, 230], [box(0.2, 0.2, 0.5, 0.4, [200, 150, 60])]));
  writeFileSync(`${t}/images/service-lld.png`, png(800, 800, [235, 250, 238], [box(0.25, 0.25, 0.5, 0.5, [60, 160, 90])]));
  writeFileSync(`${t}/images/square.png`, png(900, 900, [250, 250, 250], [box(0.1, 0.1, 0.3, 0.3, [10, 10, 10])]));
  writeFileSync(`${t}/images/not-an-image.png`, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
  writeFileSync(`${t}/images/diagram.svg`, new TextEncoder().encode(DIAGRAM_SVG));
  writeFileSync(`${t}/images/risky.svg`, new TextEncoder().encode(RISKY_SVG));
  writeFileSync(`${t}/images/nosize.svg`, new TextEncoder().encode(NOSIZE_SVG));
  writeFileSync(`${t}/images/animated.gif`, new Uint8Array(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64')));
}
