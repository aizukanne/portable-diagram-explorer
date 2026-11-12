import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateProject, parseProjectJson, migrate } from '../../src/core/validate.js';
import { PROJECT_SCHEMA } from '../../src/core/project-schema.js';
import { validateSchema, assertSchemaKeywords } from '../../src/core/schema.js';
import { newId, ID_PATTERN } from '../../src/core/ids.js';

const sample = () => JSON.parse(readFileSync('test/fixtures/sample-project.json', 'utf8'));
const codes = (r) => r.errors.map((i) => i.code).concat(r.warnings.map((i) => i.code));

test('the spec §9 example is valid with no errors and no warnings', () => {
  const r = validateProject(sample());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('the shipped schema/project.schema.json is generated from the canonical module', () => {
  assert.deepEqual(JSON.parse(readFileSync('schema/project.schema.json', 'utf8')), PROJECT_SCHEMA);
});

test('dangling target names the path, the value, the accepted IDs, why and the fix', () => {
  const p = sample(); p.diagrams[0].hotspots[0].actions[0].targetDiagramId = 'd-nope';
  const [e] = validateProject(p).errors;
  assert.equal(e.code, 'E_TARGET_REF');
  assert.equal(e.severity, 'error');
  assert.equal(e.path, 'diagrams[0].hotspots[0].actions[0].targetDiagramId');
  assert.equal(e.received, '"d-nope"');
  assert.ok(e.expected.includes('d-identity'));
  assert.ok(e.why.length > 20 && e.fix.length > 10);
});

const cases = [
  ['rect beyond image', (p) => { p.diagrams[0].hotspots[0].rect.x = 0.9; }, 'E_RECT_BOUNDS'],
  ['non-finite number', (p) => { p.diagrams[0].hotspots[0].rect.width = Infinity; }, 'E_SCHEMA_TYPE'],
  ['NaN', (p) => { p.diagrams[0].hotspots[0].rect.y = NaN; }, 'E_SCHEMA_TYPE'],
  ['zero width', (p) => { p.diagrams[0].hotspots[0].rect.width = 0; }, 'E_SCHEMA_RANGE'],
  ['negative x', (p) => { p.diagrams[0].hotspots[0].rect.x = -0.1; }, 'E_SCHEMA_RANGE'],
  ['bad default', (p) => { p.diagrams[0].hotspots[0].defaultActionId = 'x'; }, 'E_DEFAULT_REF'],
  ['duplicate id', (p) => { p.diagrams[1].id = 'd-overview'; }, 'E_DUP_ID'],
  ['duplicate across kinds', (p) => { p.assets[0].id = 'h-identity'; p.diagrams[0].assetId = 'h-identity'; }, 'E_DUP_ID'],
  ['missing asset', (p) => { p.diagrams[2].assetId = 'a-none'; }, 'E_ASSET_REF'],
  ['missing root', (p) => { p.rootDiagramId = 'd-none'; }, 'E_ROOT_MISSING'],
  ['unknown action type', (p) => { p.diagrams[0].hotspots[0].actions[0].type = 'script'; }, 'E_SCHEMA_ENUM'],
  ['unknown property', (p) => { p.diagrams[0].onclick = 'x'; }, 'E_SCHEMA_UNKNOWN'],
  ['future schema', (p) => { p.schemaVersion = 3; }, 'E_FUTURE_SCHEMA'],
  ['bad schema version', (p) => { p.schemaVersion = '1'; }, 'E_SCHEMA_VERSION'],
  ['alignment pending', (p) => { p.diagrams[1].alignmentReviewRequired = true; }, 'E_ALIGN_REVIEW'],
  ['no actions', (p) => { p.diagrams[1].hotspots[0].actions = []; p.diagrams[1].hotspots[0].defaultActionId = null; }, 'E_NO_ACTIONS'],
  ['empty label', (p) => { p.diagrams[0].hotspots[0].label = ''; }, 'E_SCHEMA_LENGTH'],
  ['missing required', (p) => { delete p.diagrams[0].hotspots[0].rect; }, 'E_SCHEMA_REQUIRED'],
  ['absolute asset path', (p) => { p.assets[0].path = '/home/me/overview.png'; }, 'E_SCHEMA_PATTERN'],
  ['traversal asset path', (p) => { p.assets[0].path = 'assets/../x.png'; }, 'E_SCHEMA_PATTERN'],
  ['gif mime', (p) => { p.assets[0].mimeType = 'image/gif'; }, 'E_SCHEMA_ENUM'],
  ['javascript target id', (p) => { p.diagrams[0].hotspots[0].actions[0].targetDiagramId = 'javascript:alert(1)'; }, 'E_SCHEMA_PATTERN'],
  ['oversized image', (p) => { p.assets[0].width = 20000; p.assets[0].height = 20000; }, 'E_IMAGE_TOO_LARGE'],
  ['annotation beyond image', (p) => { p.diagrams[1].annotations[0].x = 0.8; }, 'E_RECT_BOUNDS'],
];
for (const [name, mutate, code] of cases) {
  test(`rejects: ${name} → ${code}`, () => {
    const p = sample(); mutate(p);
    const r = validateProject(p);
    assert.ok(r.errors.some((i) => i.code === code), `got ${codes(r).join(', ')}`);
    for (const i of r.errors) for (const k of ['code', 'path', 'received', 'expected', 'why', 'fix']) assert.ok(i[k] !== undefined && i[k] !== '', `${i.code} lacks ${k}`);
  });
}

test('unreachable, obscured, empty tooltip, large and unused are warnings, not errors', () => {
  const p = sample();
  const top = structuredClone(p.diagrams[0].hotspots[0]);
  Object.assign(top, { id: 'h-top', zIndex: 5, actions: [{ id: 'x1', label: 'Read', type: 'details', text: 't' }], defaultActionId: null, tooltip: ' ' });
  top.rect = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
  p.diagrams[0].hotspots.push(top);
  p.diagrams[0].hotspots[0].actions = [{ id: 'only', label: 'Read', type: 'details', text: 't' }];
  p.diagrams[0].hotspots[0].defaultActionId = null;
  p.assets.push({ id: 'a-spare', path: 'assets/spare.png', mimeType: 'image/png', width: 5000, height: 100 });
  const r = validateProject(p);
  assert.deepEqual(r.errors, []);
  for (const c of ['W_OBSCURED', 'W_UNREACHABLE', 'W_EMPTY_TOOLTIP', 'W_LARGE_IMAGE', 'W_UNUSED_ASSET']) assert.ok(codes(r).includes(c), c);
});

test('equal zIndex: the later hotspot is on top', () => {
  const p = sample();
  const twin = structuredClone(p.diagrams[0].hotspots[0]);
  twin.id = 'h-twin'; twin.actions = [{ id: 'tw', label: 'Read', type: 'details', text: 't' }]; twin.defaultActionId = null;
  p.diagrams[0].hotspots.push(twin);
  const w = validateProject(p).warnings.filter((i) => i.code === 'W_OBSCURED');
  assert.equal(w.length, 1);
  assert.equal(w[0].path, 'diagrams[0].hotspots[0]');
});

test('JSON syntax errors carry the parser message', () => {
  const r = parseProjectJson('{"schemaVersion":1,');
  assert.equal(r.project, null);
  assert.equal(r.issues[0].code, 'E_JSON_SYNTAX');
});

test('the validator refuses schemas that use unsupported keywords', () => {
  assert.throws(() => assertSchemaKeywords({ type: 'object', patternProperties: {} }), /patternProperties/);
  assert.throws(() => validateSchema({ type: 'string', format: 'uri' }, 'x'), /format/);
});

test('newId is opaque, prefixed and schema-valid', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => newId('h')));
  assert.equal(ids.size, 1000);
  for (const id of ids) assert.match(id, ID_PATTERN);
});

const v2 = (extra) => {
  const base = sample();
  return {
    ...base, schemaVersion: 2,
    diagrams: [...base.diagrams, { id: 'd-orphan', title: 'Orphan', assetId: base.assets[0].id, annotations: [], hotspots: [] }],
    ...extra,
  };
};

test('v1 files migrate to v2 unchanged apart from the version', () => {
  const v1 = sample();
  const r = migrate(v1);
  assert.equal(r.project.schemaVersion, 2);
  assert.equal(r.migratedFrom, 1);
  assert.deepEqual({ ...r.project, schemaVersion: 1 }, v1);
  assert.equal(validateProject(v1).errors.length, 0);
});

test('a v2 file reports no migration', () => {
  assert.equal(migrate(v2({})).migratedFrom, null);
});

test('a version 3 file is refused as future, naming 2 as the highest readable', () => {
  const [i] = migrate({ ...sample(), schemaVersion: 3 }).issues;
  assert.equal(i.code, 'E_FUTURE_SCHEMA');
  assert.match(i.expected, /2 or lower/);
});

test('sequence: duplicates and unknown IDs are errors naming the path and value', () => {
  const p = v2({ sequence: { slides: ['d-overview', 'd-nope', 'd-overview'] } });
  const codes = validateProject(p).errors.map((e) => `${e.code} ${e.path} ${e.received}`);
  assert.ok(codes.includes('E_SEQ_UNKNOWN_DIAGRAM sequence.slides[1] "d-nope"'));
  assert.ok(codes.includes('E_SEQ_DUPLICATE sequence.slides[2] "d-overview"'));
});

test('a diagram in the running order is not reported unreachable', () => {
  const p = v2({});
  assert.ok(validateProject(p).warnings.some((w) => w.code === 'W_UNREACHABLE'));
  p.sequence = { slides: ['d-orphan'] };
  assert.ok(!validateProject(p).warnings.some((w) => w.code === 'W_UNREACHABLE'));
});

test('image/svg+xml is an accepted asset type', () => {
  const p = v2({}); p.assets[0].mimeType = 'image/svg+xml';
  assert.equal(validateProject(p).errors.length, 0);
});

test('parseProjectJson carries migratedFrom through', () => {
  assert.equal(parseProjectJson(JSON.stringify(sample())).migratedFrom, 1);
  assert.equal(parseProjectJson(JSON.stringify(v2({}))).migratedFrom, null);
});
