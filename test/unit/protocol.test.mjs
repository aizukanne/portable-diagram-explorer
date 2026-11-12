import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateChildMessage, validateParentMessage, makeMessage, randomToken } from '../../src/core/protocol.js';

const tok = randomToken();
const ctx = { channel: 'c'.repeat(32), lastSeq: 4, sceneToken: tok };
const ok = makeMessage(ctx.channel, 5, 'ACTIVATE_HOTSPOT', { sceneToken: tok, hotspotId: 'h-a', mode: 'default', anchor: { x: 1, y: 2 } });

test('a well-formed activation is accepted', () => assert.deepEqual(validateChildMessage(ok, ctx), { ok: true }));

for (const [why, bad] of [
  ['wrong channel', { channel: 'x' }], ['replayed seq', { seq: 4 }], ['non-integer seq', { seq: 5.5 }],
  ['stale token', { sceneToken: randomToken() }], ['extra field (URL smuggling)', { url: 'javascript:alert(1)' }],
  ['unknown mode', { mode: 'navigate' }], ['protocol version', { pde: 2 }], ['bad id', { hotspotId: '../x' }],
  ['unknown type', { type: 'NAVIGATE' }], ['inherited type name', { type: 'toString' }], ['anchor not finite', { anchor: { x: Infinity, y: 0 } }],
]) test(`child message rejected: ${why}`, () => assert.equal(validateChildMessage({ ...ok, ...bad }, ctx).ok, false));

test('missing field and non-plain objects are rejected', () => {
  const { anchor: _a, ...rest } = ok;
  assert.equal(validateChildMessage(rest, ctx).ok, false);
  assert.equal(validateChildMessage(null, ctx).ok, false);
  assert.equal(validateChildMessage('READY', ctx).ok, false);
});

test('KEY needs no scene token so Escape works mid-transition; unknown keys are rejected', () => {
  assert.equal(validateChildMessage(makeMessage(ctx.channel, 9, 'KEY', { key: 'Escape' }), ctx).ok, true);
  assert.equal(validateChildMessage(makeMessage(ctx.channel, 9, 'KEY', { key: 'Delete' }), ctx).ok, false);
});

const scene = { title: 'T', width: 10, height: 10, hotspots: [{ id: 'h-a', label: 'A', tooltip: '', rect: { x: 0, y: 0, width: 0.5, height: 0.5 }, zIndex: 1, hasMenu: false }], annotations: [] };
const render = makeMessage(ctx.channel, 5, 'RENDER_SCENE', { sceneToken: tok, scene, image: { dataUrl: 'data:image/png;base64,AAAA' }, viewport: null, selectedHotspotId: null, settings: { tooltipDelayMs: 350, showHotspotHints: true } });

test('frame accepts a well-formed render and rejects a non-data image URL or extra scene data', () => {
  assert.equal(validateParentMessage(render, ctx).ok, true);
  assert.equal(validateParentMessage({ ...render, image: { dataUrl: 'https://example.com/x.png' } }, ctx).ok, false);
  assert.equal(validateParentMessage({ ...render, image: { dataUrl: 'data:image/gif;base64,AAAA' } }, ctx).ok, false);
  assert.equal(validateParentMessage({ ...render, scene: { ...scene, actions: [] } }, ctx).ok, false);
});

test('KEY accepts Next and Previous, still rejects unknown keys', () => {
  const C = ctx.channel;
  const ok = (key) => validateChildMessage({ pde: 1, channel: C, seq: 9, type: 'KEY', key }, { channel: C, lastSeq: 0, sceneToken: null }).ok;
  assert.equal(ok('Next'), true); assert.equal(ok('Previous'), true); assert.equal(ok('ArrowRight'), false);
});

test('RENDER_SCENE accepts SVG data URLs and still rejects other types', () => {
  const okRender = (dataUrl) => validateParentMessage({ ...render, image: { dataUrl } }, ctx).ok;
  assert.equal(okRender('data:image/svg+xml;base64,PHN2Zz4='), true);
  assert.equal(okRender('data:text/html;base64,PGI+'), false);
  assert.equal(okRender('data:image/svg;base64,PHN2Zz4='), false);
});
