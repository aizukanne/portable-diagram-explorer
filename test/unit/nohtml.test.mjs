// Design D19: no HTML-string sinks or dynamic code anywhere in the shipped source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

function walk(dir) {
  return readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}

test('no innerHTML/outerHTML/insertAdjacentHTML/document.write/eval/new Function in src/', () => {
  const files = walk('src').filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 10, `scanned ${files.length} files`);
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /\.innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(|setTimeout\(\s*['"`]/, f);
  }
});
