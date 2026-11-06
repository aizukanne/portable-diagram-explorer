import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonForHtml, extractJsonBlock } from '../../src/core/embed.js';

test('jsonForHtml escapes every sequence that can end or confuse a host script', () => {
  const v = { t: '</script><!-- & \u2028\u2029 >' };
  const s = jsonForHtml(v);
  assert.ok(!/[<>&\u2028\u2029]/.test(s));
  assert.deepEqual(JSON.parse(s), v);
});

test('extractJsonBlock returns the body of exactly one block, never executing anything', () => {
  const html = '<p>x</p><script type="application/json" id="d">{"a":"\\u003c/script>"}</script><script>bad()</script>';
  assert.deepEqual(JSON.parse(extractJsonBlock(html, 'd')), { a: '</script>' });
  assert.equal(extractJsonBlock(html, 'missing'), null);
  assert.equal(extractJsonBlock(html + html, 'd'), null, 'two blocks with one id is ambiguous');
});
