import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NavStack } from '../../src/core/navigation.js';

const ov = { viewport: { cx: 0.1, cy: 0.2, zoom: 3 }, selectedHotspotId: 'h-a', details: null };
const st = (z) => ({ viewport: { cx: 0.5, cy: 0.5, zoom: z }, selectedHotspotId: null, details: null });

test('A03 shape: deeper visits save state; Back restores each in turn; Back at first child closes with the overview', () => {
  const n = new NavStack();
  n.open('HLD', ov);
  n.push('LLD', st(2));
  n.push('DETAIL', st(3));
  let r = n.back();
  assert.equal(r.closed, false); assert.equal(r.entry.diagramId, 'LLD'); assert.equal(r.entry.viewport.zoom, 3);
  r = n.back();
  assert.equal(r.entry.diagramId, 'HLD'); assert.equal(r.entry.viewport.zoom, 2);
  r = n.back();
  assert.deepEqual(r, { closed: true, entry: ov });
  assert.equal(n.isOpen, false);
});

test('A04/A12: cycles are allowed with distinct visit IDs; the cap refuses rather than drops', () => {
  const n = new NavStack(3);
  n.open('A', ov); n.push('B', st(1)); n.push('A', st(1));
  const crumbs = n.breadcrumbs();
  assert.deepEqual(crumbs.map((b) => b.diagramId), ['A', 'B', 'A']);
  assert.notEqual(crumbs[0].visitId, crumbs[2].visitId);
  assert.deepEqual(n.push('B', st(1)), { ok: false, reason: 'cap' });
  assert.equal(n.breadcrumbs().length, 3, 'nothing dropped');
});

test('breadcrumb jump truncates to that visit; close returns the overview state', () => {
  const n = new NavStack();
  n.open('A', ov); n.push('B', st(1)); n.push('C', st(2));
  const first = n.breadcrumbs()[0].visitId;
  assert.equal(n.jump(first).diagramId, 'A');
  assert.equal(n.breadcrumbs().length, 1);
  assert.equal(n.jump('nope'), null);
  assert.deepEqual(n.close(), ov);
});

test('state handed out is a copy; callers cannot corrupt history', () => {
  const n = new NavStack();
  n.open('A', ov);
  n.current().diagramId = 'X';
  assert.equal(n.current().diagramId, 'A');
});
