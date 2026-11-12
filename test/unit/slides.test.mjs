import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlideCursor } from '../../src/core/slides.js';

test('overview outside the order: index null, Next goes to slide 1, Previous disabled', () => {
  const c = new SlideCursor(['a', 'b', 'c'], 'root');
  assert.equal(c.index, null); assert.equal(c.label(), '');
  assert.equal(c.hasPrevious, false); assert.equal(c.previous(), null);
  assert.equal(c.next(), 'a'); assert.equal(c.label(), '1 of 3');
});

test('overview inside the order starts at its position', () => {
  const c = new SlideCursor(['x', 'root', 'y'], 'root');
  assert.equal(c.index, 1); assert.equal(c.label(), '2 of 3');
});

test('stops at the ends: Next on the last slide does not move', () => {
  const c = new SlideCursor(['a', 'b'], 'a');
  assert.equal(c.next(), 'b'); assert.equal(c.isLast, true);
  assert.equal(c.next(), null); assert.equal(c.index, 1);
  assert.equal(c.previous(), 'a'); assert.equal(c.previous(), null); assert.equal(c.index, 0);
});

test('jump validates its index; home returns to the overview position or null', () => {
  const c = new SlideCursor(['a', 'b', 'c'], 'b');
  assert.equal(c.jump(2), 'c'); assert.equal(c.jump(7), null); assert.equal(c.index, 2);
  c.home(); assert.equal(c.index, 1);
  const d = new SlideCursor(['a'], 'root'); d.next(); d.home(); assert.equal(d.index, null);
});

test('jump rejects non-integers and negatives; empty order has no navigation', () => {
  const c = new SlideCursor(['a', 'b'], 'a');
  assert.equal(c.jump(-1), null); assert.equal(c.jump(0.5), null); assert.equal(c.jump(NaN), null);
  assert.equal(c.index, 0);
  const e = new SlideCursor([], 'root');
  assert.equal(e.count, 0); assert.equal(e.hasNext, false); assert.equal(e.next(), null);
  assert.equal(e.isLast, false); assert.equal(e.current, null);
});

test('the cursor holds a frozen copy of the slides', () => {
  const src = ['a', 'b'];
  const c = new SlideCursor(src, 'a');
  src.push('z');
  assert.equal(c.count, 2);
});
