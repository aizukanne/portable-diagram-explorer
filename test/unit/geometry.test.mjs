import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewTransform, screenToImage, imageToScreen, zoomAt, panBy, clampRect, normRectFromPoints, fitScale, ZOOM_MAX, ZOOM_MIN } from '../../src/core/geometry.js';

const close = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test('letterboxed fit centres the image; inverse maps back', () => {
  const t = viewTransform(2000, 1000, 1000, 1000, { cx: 0.5, cy: 0.5, zoom: 1 });
  assert.equal(t.s, 0.5); assert.equal(t.tx, 0); assert.equal(t.ty, 250);
  assert.deepEqual(screenToImage(t, 500, 500), { x: 1000, y: 500 });
  assert.deepEqual(imageToScreen(t, 2000, 1000), { x: 1000, y: 750 });
  // pillarboxed the other way
  const u = viewTransform(1000, 2000, 1000, 1000, { cx: 0.5, cy: 0.5, zoom: 1 });
  assert.equal(u.tx, 250); assert.equal(u.ty, 0);
});

test('zoomAt keeps the pointed image point fixed and clamps zoom', () => {
  const s0 = { cx: 0.5, cy: 0.5, zoom: 1 };
  for (const [sx, sy, f] of [[100, 400, 2], [900, 300, 3], [500, 500, 0.5]]) {
    const s1 = zoomAt(s0, 2000, 1000, 1000, 1000, f, sx, sy);
    const before = screenToImage(viewTransform(2000, 1000, 1000, 1000, s0), sx, sy);
    const after = screenToImage(viewTransform(2000, 1000, 1000, 1000, s1), sx, sy);
    close(before.x, after.x, 1e-6); close(before.y, after.y, 1e-6);
  }
  assert.equal(zoomAt(s0, 10, 10, 10, 10, 1e9, 5, 5).zoom, ZOOM_MAX);
  assert.equal(zoomAt(s0, 10, 10, 10, 10, 1e-9, 5, 5).zoom, ZOOM_MIN);
});

test('panBy moves the centre by screen pixels and keeps it on the image', () => {
  const s = panBy({ cx: 0.5, cy: 0.5, zoom: 1 }, 2000, 1000, 1000, 1000, 100, 0);
  close(s.cx, 0.5 - 100 / (2000 * 0.5));
  assert.equal(panBy({ cx: 0.5, cy: 0.5, zoom: 1 }, 2000, 1000, 1000, 1000, 1e6, 1e6).cx, 0);
});

test('resizing keeps the same image point centred (viewport is resolution independent)', () => {
  const view = { cx: 0.3, cy: 0.7, zoom: 2.5 };
  for (const [w, h] of [[800, 600], [1600, 400], [300, 900]]) {
    const t = viewTransform(1920, 1080, w, h, view);
    const c = screenToImage(t, w / 2, h / 2);
    close(c.x / 1920, 0.3, 1e-9); close(c.y / 1080, 0.7, 1e-9);
    close(t.s, fitScale(1920, 1080, w, h) * 2.5);
  }
});

test('rectangles are clamped into the image with a minimum size', () => {
  assert.deepEqual(clampRect({ x: 0.95, y: -0.2, width: 0.2, height: 0.1 }), { x: 0.8, y: 0, width: 0.2, height: 0.1 });
  assert.equal(clampRect({ x: 0, y: 0, width: 0, height: 0 }).width, 0.002);
  assert.deepEqual(normRectFromPoints({ x: 0.6, y: 0.9 }, { x: 0.2, y: 1.4 }), { x: 0.2, y: 0.9, width: 0.39999999999999997, height: 0.09999999999999998 });
});
