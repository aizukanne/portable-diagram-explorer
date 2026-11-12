// The host nonce reaches markup only through NONCE_RE (S7, issue #16). These tests fail
// if that validation is removed or loosened (see the fix report for the falsification).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NONCE_RE, hostNonce } from '../../src/ui/build-info.js';
import { frameSrcdoc } from '../../src/ui/bridge.js';
import { hostNoticeText, isHostedWindow } from '../../src/ui/viewer.js';

const TEMPLATE = '<html data-channel="__CHANNEL__"><head><style__NONCE_ATTR__>a{}</style></head><body><script__NONCE_ATTR__>x()</script></body></html>';
const HOSTILE = {
  'quote and handler': 'a" onload="x',
  'space': 'abc def',
  'closing script tag': '</script>',
  'angle bracket': 'a<b',
  'single quote': "a'b",
  'dollar-ampersand': '$&',
  'dollar-quote': "$'",
  'too long (201)': 'a'.repeat(201),
  'empty': '',
  'newline suffix': 'abc\n',
  'backtick': 'a`b',
};

for (const [name, v] of Object.entries(HOSTILE)) {
  test(`NONCE_RE refuses: ${name}`, () => assert.equal(NONCE_RE.test(v), false));
  test(`hostNonce() treats as empty: ${name}`, () => {
    globalThis.__BUILD__ = { hostNonce: v };
    try { assert.equal(hostNonce(), ''); } finally { delete globalThis.__BUILD__; }
  });
  test(`the frame document gets no nonce attribute and no spliced text: ${name}`, () => {
    const out = frameSrcdoc(TEMPLATE, v, 'CHAN');
    assert.equal(out, TEMPLATE.replaceAll('__NONCE_ATTR__', '').replace('__CHANNEL__', 'CHAN'));
    assert.ok(!out.includes('nonce'));
  });
}

test('a 200-character nonce is accepted, and a valid base64 nonce is stamped exactly twice', () => {
  assert.equal(NONCE_RE.test('a'.repeat(200)), true);
  const n = 'dGVzdC1ub25jZS+/=_-9';
  globalThis.__BUILD__ = { hostNonce: n };
  try { assert.equal(hostNonce(), n); } finally { delete globalThis.__BUILD__; }
  const out = frameSrcdoc(TEMPLATE, n, 'CHAN');
  assert.equal(out.split(` nonce="${n}"`).length, 3);
  assert.equal(out.split('nonce').length, 3);
  assert.match(out, /<style nonce="[^"]+">/);
  assert.match(out, /<script nonce="[^"]+">/);
  assert.ok(!out.includes('__NONCE_ATTR__'));
});

test('hostNonce() is empty when the build gives none', () => {
  assert.equal(hostNonce(), '');
});

test('a template without exactly two nonce marks is refused', () => {
  assert.throws(() => frameSrcdoc('<script__NONCE_ATTR__></script>', '', 'C'), /exactly two nonce marks/);
});

test('the notice decision: the editor preview (embedded) hides the hosting sentence, but never hides reduced isolation', () => {
  for (const hosted of [true, false]) {
    assert.equal(hostNoticeText({ embedded: true, hosted, fallback: false }), '');
    const t = hostNoticeText({ embedded: true, hosted, fallback: true });
    assert.match(t, /reduced isolation/);
    assert.doesNotMatch(t, /download the file|another site/);
  }
});

test('the notice decision: hosted, fallback, both, neither', () => {
  assert.match(hostNoticeText({ embedded: false, hosted: true, fallback: false }), /For the full experience, download the file/);
  assert.doesNotMatch(hostNoticeText({ embedded: false, hosted: true, fallback: false }), /reduced isolation/);
  assert.match(hostNoticeText({ embedded: false, hosted: true, fallback: true }), /download the file.*reduced isolation/);
  const alone = hostNoticeText({ embedded: false, hosted: false, fallback: true });
  assert.match(alone, /reduced isolation/);
  assert.doesNotMatch(alone, /another site/);
  assert.equal(hostNoticeText({ embedded: false, hosted: false, fallback: false }), '');
});

test('hosted detection: top differs from self, and a throwing top counts as hosted', () => {
  const self = {};
  assert.equal(isHostedWindow({ self, top: self }), false);
  assert.equal(isHostedWindow({ self, top: {} }), true);
  assert.equal(isHostedWindow({ self, get top() { throw new Error('cross-origin'); } }), true);
});
