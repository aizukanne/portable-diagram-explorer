// Build the single-file outputs (design D2, D3, D6; guide §2).
//
//   dist/frame.html                  the sandboxed child document (inspection copy)
//   dist/presentation-template.html  viewer runtime with the __PDE_DATA__ placeholder
//   dist/editor.html                 the editor; embeds both templates and its own source
//   dist/sample/*                    sample package + presentation (when samples/ exists)
//
// Every inline <script>/<style> is admitted by SHA-256 hash only; nothing may load
// from the network. Run: node build/build.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { bundle } from './bundle.mjs';
import { jsonForHtml } from '../src/core/embed.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const VERSION = pkg.version;
const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
const read = (p) => readFileSync(p, 'utf8');

export const SELF_MARK = '__PDE_' + 'SELF__';
export const DATA_MARK = '__PDE_DATA__';
export const TITLE_MARK = '__PDE_TITLE__';

function checkCss(name, css) {
  if (/<\/style|<!--/i.test(css)) throw new Error(`${name} contains "</style" or "<!--"`);
  if (/url\(\s*['"]?(https?:)?\/\//i.test(css) || /@import/i.test(css)) throw new Error(`${name} references a network resource`);
  return css;
}

export function buildAll({ outDir = 'dist' } = {}) {
  const frameCss = checkCss('frame.css', read('src/styles/frame.css'));
  const appCss = checkCss('app.css', read('src/styles/app.css'));

  // 1. Frame document. It carries its own policy as well as inheriting the parent's.
  const frameJs = bundle('src/ui/frame-main.js', { preamble: `const __BUILD__ = ${jsonForHtml({ version: VERSION })};` });
  const frameCsp = [
    "default-src 'none'",
    `script-src ${sha(frameJs)}`,
    `style-src ${sha(frameCss)}`,
    'img-src data:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  const frameDoc = `<!doctype html><html lang="en" data-channel="__CHANNEL__"><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="${frameCsp}">`
    + `<style>${frameCss}</style></head><body><script>${frameJs}</script></body></html>`;

  const hostCsp = (hostJs) => [
    "default-src 'none'",
    `script-src ${sha(hostJs)} ${sha(frameJs)}`,
    `style-src ${sha(appCss)} ${sha(frameCss)}`,
    'img-src data: blob:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  const head = (csp, title) => `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">\n`
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">\n`
    + `<meta name="generator" content="Portable Diagram Explorer ${VERSION}">\n`
    + `<title>${title}</title>\n<style>${appCss}</style>\n</head>\n`;

  // 2. Presentation template.
  const presJs = bundle('src/ui/presentation-main.js', {
    preamble: `const __BUILD__ = ${jsonForHtml({ version: VERSION, frameTemplate: frameDoc })};`,
  });
  const presentationTemplate = head(hostCsp(presJs), TITLE_MARK)
    + `<body class="pde-present">\n<div id="pde-root"></div>\n`
    + `<script type="application/json" id="pde-data">${DATA_MARK}</script>\n`
    + `<script>${presJs}</script>\n</body>\n</html>\n`;
  for (const mark of [DATA_MARK, TITLE_MARK]) {
    if (presentationTemplate.split(mark).length !== 2) throw new Error(`presentation template must contain ${mark} exactly once`);
  }

  // 3. Editor, with its byte-exact self-copy (D6).
  const edJs = bundle('src/ui/editor-main.js', {
    preamble: `const __BUILD__ = ${jsonForHtml({ version: VERSION, frameTemplate: frameDoc, presentationTemplate })};`,
  });
  const pre = head(hostCsp(edJs), 'Portable Diagram Explorer — editor')
    + `<body class="pde-edit">\n<div id="pde-root"></div>\n`;
  const post = `\n<script>${edJs}</script>\n</body>\n</html>\n`;
  const selfTemplate = pre + SELF_MARK + post;
  if (selfTemplate.split(SELF_MARK).length !== 2) throw new Error(`editor template must contain ${SELF_MARK} exactly once`);
  const editor = pre + `<script type="application/json" id="pde-self">${jsonForHtml(selfTemplate)}</script>` + post;

  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/frame.html`, frameDoc);
  writeFileSync(`${outDir}/presentation-template.html`, presentationTemplate);
  writeFileSync(`${outDir}/editor.html`, editor);
  return { frameDoc, presentationTemplate, editor, version: VERSION };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = buildAll();
  const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)} KiB`;
  console.log(`editor.html ${kb(r.editor)} · presentation-template.html ${kb(r.presentationTemplate)} · frame ${kb(r.frameDoc)} · v${r.version}`);
  if (existsSync('samples/customer-platform/project.json')) {
    const { buildSample } = await import('./sample.mjs');
    const s = await buildSample(r);
    console.log(`sample: ${s.zipName} ${(s.zipBytes / 1024).toFixed(1)} KiB · ${s.htmlName} ${(s.htmlBytes / 1024).toFixed(1)} KiB`);
  }
}
