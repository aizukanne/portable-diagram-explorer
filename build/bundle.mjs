// Zero-dependency ES-module bundler for the single-file outputs (design D2).
//
// Deliberately narrow. Supported: `import { a, b } from './x.js';` and
// `export function|async function|class|const|let` at column 0. Anything else
// that could change meaning when modules are flattened into one scope is a
// build error that names the file, so the bundle can never silently differ
// from the module graph the unit tests exercise.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"];?[ \t]*$/;
const DECL_RE = /^(?:export\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/;

export class BundleError extends Error {}

export function bundle(entry, { preamble = '' } = {}) {
  const order = [];
  const seen = new Set();
  const exportsOf = new Map();
  const declaredIn = new Map();

  const visit = (file, chain) => {
    const abs = path.resolve(file);
    if (chain.includes(abs)) throw new BundleError(`import cycle: ${[...chain, abs].map(rel).join(' -> ')}`);
    if (seen.has(abs)) return;
    const src = readFileSync(abs, 'utf8');
    const lines = src.split('\n');
    const body = [];
    const exported = new Set();
    const imports = [];
    lines.forEach((line, i) => {
      const where = `${rel(abs)}:${i + 1}`;
      if (/^\s*import[\s{*]/.test(line)) {
        const m = line.match(IMPORT_RE);
        if (!m) throw new BundleError(`${where}: only "import { a, b } from './x.js';" is supported, got: ${line.trim()}`);
        const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
        for (const n of names) {
          if (/\s+as\s+/.test(n)) throw new BundleError(`${where}: renamed imports are not supported (${n}); import the name as exported`);
        }
        imports.push({ names, from: path.resolve(path.dirname(abs), m[2]), where });
        body.push('');
        return;
      }
      if (/^export\s+default\b/.test(line)) throw new BundleError(`${where}: default exports are not supported; use a named export`);
      if (/^export\s*[{*]/.test(line)) throw new BundleError(`${where}: export lists are not supported; prefix the declaration with export`);
      const d = line.match(DECL_RE);
      if (d) {
        const name = d[1];
        if (declaredIn.has(name) && declaredIn.get(name) !== abs) {
          throw new BundleError(`top-level name "${name}" is declared in both ${rel(declaredIn.get(name))} and ${rel(abs)}; rename one (the bundle shares one scope)`);
        }
        declaredIn.set(name, abs);
        if (line.startsWith('export')) exported.add(name);
      }
      body.push(line.replace(/^export\s+/, ''));
    });
    for (const imp of imports) visit(imp.from, [...chain, abs]);
    for (const imp of imports) {
      const ex = exportsOf.get(imp.from);
      for (const n of imp.names) {
        if (!ex.has(n)) throw new BundleError(`${imp.where}: "${n}" is not exported by ${rel(imp.from)}`);
      }
    }
    seen.add(abs);
    exportsOf.set(abs, exported);
    order.push({ file: abs, text: body.join('\n') });
  };

  visit(entry, []);
  const out = `(() => {\n'use strict';\n${preamble}\n${order.map((m) => `// ---- ${rel(m.file)}\n${m.text}`).join('\n')}\n})();\n`;
  if (/<\/script|<!--/i.test(out)) {
    const at = out.search(/<\/script|<!--/i);
    throw new BundleError(`bundle for ${rel(entry)} contains "</script" or "<!--" near: ${JSON.stringify(out.slice(Math.max(0, at - 60), at + 20))}; write it as '<' + '/script' so the inline script cannot end early`);
  }
  return out;
}

function rel(p) { return path.relative(process.cwd(), p); }
