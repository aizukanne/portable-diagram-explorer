import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EditorStore, HISTORY_LIMIT } from '../../src/ui/editor/store.js';
import {
  removeDiagram, replaceAsset, duplicateHotspot, addHotspot, setRect, moveZ, addAction, removeAction,
  setDefaultAction, addDiagramFromAsset, emptyProject, referencesTo, markAlignmentReviewed, addAnnotation, updateAnnotation,
} from '../../src/ui/editor/ops.js';
import { validateProject } from '../../src/core/validate.js';

const sample = () => JSON.parse(readFileSync('test/fixtures/sample-project.json', 'utf8'));
const findAction = (p, id) => p.diagrams.flatMap((d) => d.hotspots.flatMap((h) => h.actions)).find((a) => a.id === id);

test('deleting a referenced diagram requires a decision', () => {
  const p = sample();
  assert.throws(() => removeDiagram(p, 'd-identity'), /choose retarget or removeActions/);
  assert.deepEqual(referencesTo(p, 'd-identity').map((r) => r.actionId), ['open-identity']);
});

test('delete with retarget is one undoable step that restores everything', () => {
  const s = new EditorStore(sample());
  s.apply((p) => removeDiagram(p, 'd-identity', { mode: 'retarget', to: 'd-mapping' }), { label: 'Delete diagram' });
  assert.equal(findAction(s.project, 'open-identity').targetDiagramId, 'd-mapping');
  assert.ok(!s.project.assets.some((a) => a.id === 'a-identity'), 'orphaned image dropped');
  assert.deepEqual(validateProject(s.project).errors, []);
  assert.equal(s.undoLabel, 'Delete diagram');
  s.undo();
  assert.deepEqual(s.project, sample());
  s.redo();
  assert.equal(findAction(s.project, 'open-identity').targetDiagramId, 'd-mapping');
});

test('delete with removeActions drops the links and clears defaults that pointed at them', () => {
  const p = sample();
  removeDiagram(p, 'd-identity', { mode: 'removeActions' });
  const h = p.diagrams[0].hotspots[0];
  assert.deepEqual(h.actions.map((a) => a.id), ['identity-details']);
  assert.equal(h.defaultActionId, null);
  assert.deepEqual(validateProject(p).errors, []);
});

test('deleting the overview moves the root explicitly or to the first remaining diagram', () => {
  const p = sample();
  removeDiagram(p, 'd-overview', {}, 'd-mapping');
  assert.equal(p.rootDiagramId, 'd-mapping');
});

test('coalesced edits produce one history entry; dirty tracks the saved version through undo', () => {
  const s = new EditorStore(sample());
  s.markSaved();
  for (let i = 0; i < 10; i++) s.apply((p) => setRect(p, 'd-overview', 'h-identity', { x: 0.2 + i * 0.001, y: 0.25, width: 0.18, height: 0.12 }), { label: 'Nudge', coalesce: 'nudge:h-identity' });
  assert.equal(s.past.length, 1);
  assert.equal(s.dirty, true);
  s.undo();
  assert.equal(s.dirty, false, 'back at the saved state');
  s.redo();
  assert.equal(s.dirty, true);
});

test('history is bounded', () => {
  const s = new EditorStore(sample());
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) s.apply((p) => { p.title = `T${i}`; }, { label: `t${i}` });
  assert.equal(s.past.length, HISTORY_LIMIT);
  let n = 0; while (s.undo()) n++;
  assert.equal(n, HISTORY_LIMIT);
});

test('a new aspect ratio flags the diagram for alignment review; the same ratio at another size does not', () => {
  const p = sample();
  const r1 = replaceAsset(p, 'd-identity', { id: 'a-new', mimeType: 'image/png', width: 3840, height: 2160 });
  assert.equal(r1.aspectChanged, false);
  assert.equal(r1.sizeChanged, true);
  assert.equal(p.diagrams[1].alignmentReviewRequired, undefined);
  const r2 = replaceAsset(p, 'd-identity', { id: 'a-new2', mimeType: 'image/png', width: 1000, height: 1000 });
  assert.equal(r2.aspectChanged, true);
  assert.equal(p.diagrams[1].alignmentReviewRequired, true);
  assert.ok(validateProject(p).errors.some((e) => e.code === 'E_ALIGN_REVIEW'));
  markAlignmentReviewed(p, 'd-identity');
  assert.deepEqual(validateProject(p).errors, []);
  assert.ok(!p.assets.some((a) => a.id === 'a-identity' || a.id === 'a-new'), 'replaced images are dropped');
});

test('duplicated hotspots get fresh ids for themselves and their actions, stay in bounds and on top', () => {
  const p = sample();
  p.diagrams[0].hotspots[0].rect = { x: 0.9, y: 0.9, width: 0.1, height: 0.1 };
  const id = duplicateHotspot(p, 'd-overview', 'h-identity');
  const [a, b] = p.diagrams[0].hotspots;
  assert.equal(b.id, id);
  assert.notEqual(b.actions[0].id, a.actions[0].id);
  assert.equal(b.defaultActionId, b.actions[0].id);
  assert.ok(b.rect.x + b.rect.width <= 1 && b.rect.y + b.rect.height <= 1);
  assert.ok(b.zIndex > a.zIndex);
  assert.deepEqual(validateProject(p).errors.filter((e) => e.code === 'E_DUP_ID'), []);
});

test('stacking order moves are explicit and renumbered', () => {
  const p = sample();
  const id2 = addHotspot(p, 'd-overview', { x: 0, y: 0, width: 0.1, height: 0.1 });
  moveZ(p, 'd-overview', id2, 'bottom');
  const hs = p.diagrams[0].hotspots;
  assert.ok(hs.find((h) => h.id === id2).zIndex < hs.find((h) => h.id === 'h-identity').zIndex);
});

test('first action becomes the default; removing the default clears it; defaults must belong to the hotspot', () => {
  const p = sample();
  const hId = addHotspot(p, 'd-mapping', { x: 0.1, y: 0.1, width: 0.2, height: 0.2 });
  const aId = addAction(p, 'd-mapping', hId, { type: 'diagram', targetDiagramId: 'd-overview' });
  const h = p.diagrams[2].hotspots[0];
  assert.equal(h.defaultActionId, aId);
  addAction(p, 'd-mapping', hId, { type: 'details', text: 'x' });
  assert.equal(h.defaultActionId, aId, 'later actions do not steal the default');
  removeAction(p, 'd-mapping', hId, aId);
  assert.equal(h.defaultActionId, null);
  assert.throws(() => setDefaultAction(p, 'd-mapping', hId, 'open-identity'), /not on hotspot/);
  assert.throws(() => addAction(p, 'd-mapping', hId, { type: 'diagram', targetDiagramId: 'd-none' }), /not found/);
});

test('a project built from scratch validates once its pieces are in place', () => {
  const p = emptyProject('New');
  const d1 = addDiagramFromAsset(p, { id: 'a-one', mimeType: 'image/png', width: 100, height: 50 }, 'One');
  const d2 = addDiagramFromAsset(p, { id: 'a-two', mimeType: 'image/jpeg', width: 80, height: 80 }, 'Two');
  assert.equal(p.rootDiagramId, d1);
  const h = addHotspot(p, d1, { x: 0.1, y: 0.1, width: 0.3, height: 0.3 });
  addAction(p, d1, h, { type: 'diagram', targetDiagramId: d2 });
  const n = addAnnotation(p, d2, { x: 0.95, y: 0.5 });
  updateAnnotation(p, d2, n, { text: 'Hello\nworld', width: 0.5 });
  assert.deepEqual(validateProject(p).errors, []);
});
