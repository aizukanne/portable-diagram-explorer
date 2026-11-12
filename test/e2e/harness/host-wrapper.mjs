// Build-time helper (test-only, run by `build --test`): writes the "hosted" pages
// under dist/test/. Nothing here is part of editor.html, the presentation
// template or the frame document.
//
// Each page is a HOST document with a meta CSP and one <iframe srcdoc="..."> that
// holds a built presentation. A srcdoc document inherits its host's policy, so the
// presentation's own meta policy and the host's policy both apply, which models a
// presentation previewed inside another site's viewer (issue #16).
//
// The host's img-src is an ASSUMPTION (spec section 5.8 item 1): the real host's
// img-src is unknown and live gate LG-1 settles it.
import { readFileSync, writeFileSync } from 'node:fs';

export const TEST_NONCE = 'TESTNONCE';

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const BODIES = (html, tag) => [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);

// Put an attribute on every <script> and <style> start tag. `attr` is written as-is.
const stamp = (html, attr) => html.replace(/<(script|style)(?=[\s>])/g, `<$1 ${attr}`);

function hostDoc(title, policy, presentationHtml) {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n`
    + `<meta http-equiv="Content-Security-Policy" content="${policy}">\n`
    + `<title>${title}</title></head>\n`
    // Size by attributes: a style attribute would itself be refused by the host policy.
    + `<body><iframe title="host frame" width="1280" height="800" srcdoc="${escapeAttr(presentationHtml)}"></iframe></body></html>\n`;
}

// sha: the build's own `sha()` (returns a quoted 'sha256-...' source).
export function writeHostPages(testDir, { sha, appCss, frameCss }) {
  const pages = {};
  for (const [suffix, fixture] of [['', 'viewer-fixture'], ['-slides', 'slides']]) {
    const html = readFileSync(`${testDir}/${fixture}.presentation.html`, 'utf8');
    const presJs = BODIES(html, 'script');
    if (presJs.length !== 1) throw new Error(`${fixture}: expected exactly one executable inline script, found ${presJs.length}`);
    const [pjs] = presJs;
    if (!BODIES(html, 'style').every((s) => s === appCss)) throw new Error(`${fixture}: unexpected inline style`);

    // Models H1: the host admits scripts and styles by NONCE only. Every <script> and
    // <style> in the presentation carries that nonce, and the frame template gets it
    // from the page (stamped by the bridge), so the sandboxed frame is admitted too.
    if (!suffix) {
      pages['hosted-nonce.html'] = hostDoc('hosted: nonce',
        `script-src 'nonce-${TEST_NONCE}'; style-src 'nonce-${TEST_NONCE}'; img-src data: blob:`,
        stamp(html, `nonce="${TEST_NONCE}"`));
    }

    // Models a host that lets OUR PAGE run (by hash) but not our FRAME: the frame
    // script's hash is deliberately absent from script-src and there is no nonce
    // anywhere, so the frame's inline script is refused (the console error in #16).
    const hashOnly = `script-src ${sha(pjs)}; style-src ${sha(appCss)} ${sha(frameCss)}; img-src data: blob:`;
    pages[`hosted-hash-only${suffix}.html`] = hostDoc('hosted: hash only', hashOnly, html);

    // Same host policy, but our tags carry a nonce attribute whose value is not a
    // valid CSP source (it tries to break out of an attribute). It plays no part in
    // the policy; our reader must refuse it and behave as if no nonce were given.
    if (!suffix) {
      pages['hosted-bad-nonce.html'] = hostDoc('hosted: bad nonce', hashOnly,
        stamp(html, `nonce='a" onload="x'`));
    }
  }
  for (const [name, doc] of Object.entries(pages)) writeFileSync(`${testDir}/${name}`, doc);
  return Object.keys(pages);
}
