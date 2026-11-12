// Build invariants (design D2, D3, D6, MR-2). Builds into a temp dir so the test
// never depends on a stale dist/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildAll, SELF_MARK } from '../../build/build.mjs';
import { bundle } from '../../build/bundle.mjs';
import { jsonForHtml } from '../../src/core/embed.js';

const out = mkdtempSync(path.join(tmpdir(), 'pde-build-'));
const r = await buildAll({ outDir: out });
const h = (s) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;

// The frame template marks both inline tags for an optional host nonce (S7); the hash
// is of the tag's text, so the policy is checked against the template as shipped with
// the marks filled by nothing.
const frameAsShipped = r.frameDoc.replaceAll('__NONCE_ATTR__', '');

for (const [name, html] of [['editor', r.editor], ['presentation', r.presentationTemplate], ['frame', frameAsShipped]]) {
  test(`${name}: every inline script and style is admitted by hash; nothing else is`, () => {
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    assert.match(csp, /default-src 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:|\*/);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length >= 1);
    for (const [, body] of scripts) assert.ok(csp.includes(h(body)), 'script hash missing');
    for (const [, body] of html.matchAll(/<style>([\s\S]*?)<\/style>/g)) assert.ok(csp.includes(h(body)), 'style hash missing');
  });

  test(`${name}: no network URL and no inline event handler attributes`, () => {
    assert.doesNotMatch(html, /\b(src|href|action)\s*=\s*["']?(https?:)?\/\//i);
    assert.doesNotMatch(html, /<[a-z][^>]*\son[a-z]+\s*=/i);
  });
}

test('frame template marks both inline tags for an optional nonce, and nothing else', () => {
  assert.equal(r.frameDoc.split('__NONCE_ATTR__').length, 3);
  assert.match(r.frameDoc, /<style__NONCE_ATTR__>/);
  assert.match(r.frameDoc, /<script__NONCE_ATTR__>/);
  assert.equal(readFileSync(path.join(out, 'frame.html'), 'utf8'), frameAsShipped, 'the inspection copy has the marks replaced by nothing');
});

test('the editor reproduces its own bytes exactly (D6)', () => {
  const m = r.editor.match(/<script type="application\/json" id="pde-self">([\s\S]*?)<\/script>/);
  const tpl = JSON.parse(m[1]);
  assert.equal(tpl.split(SELF_MARK).length, 2);
  // A function replacement: a string one would interpret "$'" and "$&" inside the bundle.
  const rebuilt = tpl.replace(SELF_MARK, () => `<script type="application/json" id="pde-self">${jsonForHtml(tpl)}</script>`);
  assert.equal(rebuilt, r.editor);
});

test('script elements open and close in pairs (no premature </script>)', () => {
  for (const html of [r.editor, r.presentationTemplate, frameAsShipped]) {
    assert.equal((html.match(/<script[\s>]/g) || []).length, (html.match(/<\/script>/g) || []).length);
  }
});

test('the bundler refuses constructs that would change meaning when flattened', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pde-bundle-'));
  const w = (n, s) => writeFileSync(path.join(dir, n), s);
  w('a.js', "import { x } from './b.js';\nexport const y = x;\n");
  w('b.js', 'export const y = 1;\nexport const x = 2;\n');
  assert.throws(() => bundle(path.join(dir, 'a.js')), /declared in both/);
  w('c.js', "import { x as z } from './b.js';\n");
  assert.throws(() => bundle(path.join(dir, 'c.js')), /renamed imports/);
  w('d.js', "import * as b from './b.js';\n");
  assert.throws(() => bundle(path.join(dir, 'd.js')), /only "import \{/);
  w('e.js', 'export default 1;\n');
  assert.throws(() => bundle(path.join(dir, 'e.js')), /default exports/);
  w('f.js', "const s = '</script>';\n");
  assert.throws(() => bundle(path.join(dir, 'f.js')), /contains "<\/script"/);
  w('g.js', "import { nope } from './b.js';\n");
  assert.throws(() => bundle(path.join(dir, 'g.js')), /not exported/);
  rmSync(dir, { recursive: true, force: true });
});

test.after(() => rmSync(out, { recursive: true, force: true }));
mkdirSync(out, { recursive: true });
