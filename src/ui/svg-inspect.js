// SVG inspection (spec §5.4, §5.6, §5.8 items 3 and 10).
//
// An SVG is only ever shown as a picture inside <img>, where a browser runs no script and
// loads nothing external. This module therefore never inserts SVG into the document: it
// parses the text with DOMParser (which executes nothing) purely to MEASURE the drawing and
// to COUNT the parts that will not run, so the author is told what the picture leaves out.
import { makeIssue } from '../core/schema.js';
import { MAX_DECODED_PIXELS } from '../core/validate.js';

export const MAX_SVG_BYTES = 20 * 1024 * 1024;
// SP-1 measured no sharpness or pan limit in all three engines up to the largest drawing
// tried; the threshold is a guard on parse/decode time, not a measured cliff.
export const SVG_COMPLEX_ELEMENTS = 200000;

// CSS absolute lengths in px (§5.8 item 10). Anything else (%, em, ex, ...) is relative to
// something the file does not state, so the viewBox decides instead.
const UNIT_PX = { '': 1, px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };
const LENGTH = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)\s*$/;

function absoluteLength(value) {
  if (value == null) return null;
  const m = LENGTH.exec(value);
  if (!m) return null;
  const unit = m[2].toLowerCase();
  if (!Object.hasOwn(UNIT_PX, unit)) return null;
  const px = Number(m[1]) * UNIT_PX[unit];
  return px > 0 && Number.isFinite(px) ? Math.max(1, Math.round(px)) : null;
}

function viewBoxSize(value) {
  if (value == null) return null;
  const n = value.trim().split(/[\s,]+/).map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x)) || n[2] <= 0 || n[3] <= 0) return null;
  return { width: Math.max(1, Math.round(n[2])), height: Math.max(1, Math.round(n[3])) };
}

const EXTERNAL = /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const isExternal = (v) => v != null && EXTERNAL.test(v) && !/^\s*data:/i.test(v);
const CSS_EXTERNAL = /@import|url\(\s*(['"]?)\s*(?:[a-z][a-z0-9+.-]*:|\/\/)(?!\s*data:)/i;

function countInertParts(doc) {
  let script = 0; let handlers = 0; let foreign = 0; let href = 0; let css = 0;
  for (const el of doc.getElementsByTagName('*')) {
    const name = el.localName;
    if (name === 'script') script++;
    else if (name === 'foreignObject') foreign++;
    else if (name === 'style' && CSS_EXTERNAL.test(el.textContent)) css++;
    for (const a of el.attributes) {
      const an = a.localName.toLowerCase();
      if (an.startsWith('on')) handlers++;
      else if (an === 'href' && isExternal(a.value)) href++;
      else if (an === 'style' && CSS_EXTERNAL.test(a.value)) css++;
    }
  }
  const parts = [];
  if (script) parts.push(`script ×${script}`);
  if (handlers) parts.push(`on* attributes ×${handlers}`);
  if (foreign) parts.push(`foreignObject ×${foreign}`);
  if (href) parts.push(`external href ×${href}`);
  if (css) parts.push(`external CSS ×${css}`);
  return parts;
}

// inspectSvg(bytes) -> { width, height, issues }. width/height are null when they cannot be
// determined (an error issue says why). Warnings (W_*) do not stop the import.
export function inspectSvg(bytes, name = 'the SVG file') {
  const out = { width: null, height: null, issues: [] };
  if (bytes.length > MAX_SVG_BYTES) {
    out.issues.push(makeIssue('E_SVG_TOO_LARGE', name, `${(bytes.length / 1048576).toFixed(1)} MiB`, `an SVG file of at most ${MAX_SVG_BYTES / 1048576} MiB`,
      'A drawing this large can exhaust browser memory when the presentation is opened.', 'Simplify the drawing or export it at a smaller size, or import a PNG of it.'));
    return out;
  }
  const doc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(bytes), 'image/svg+xml');
  const bad = doc.getElementsByTagName('parsererror')[0];
  const root = doc.documentElement;
  if (bad || !root || root.localName !== 'svg') {
    const why = bad ? bad.textContent.trim().split('\n')[0].slice(0, 120) : 'no <svg> root element';
    out.issues.push(makeIssue('E_SVG_PARSE', name, why, 'well-formed SVG (XML) text with an <svg> root element',
      'A drawing the browser cannot parse cannot be shown or measured.', 'Re-export the drawing from its editor as plain SVG, or open it in a browser to find the XML error.'));
    return out;
  }
  const w = absoluteLength(root.getAttribute('width'));
  const h = absoluteLength(root.getAttribute('height'));
  const vb = viewBoxSize(root.getAttribute('viewBox'));
  if (w && h) { out.width = w; out.height = h; }
  else if (vb && !w && !h) { out.width = vb.width; out.height = vb.height; }
  else if (vb && (w || h)) {
    // One usable length: derive the other from the viewBox proportions.
    out.width = w || Math.max(1, Math.round(h * vb.width / vb.height));
    out.height = h || Math.max(1, Math.round(w * vb.height / vb.width));
  } else if (vb) { out.width = vb.width; out.height = vb.height; }
  if (!out.width) {
    const present = ['width', 'height', 'viewBox'].filter((a) => root.hasAttribute(a)).map((a) => `${a}="${root.getAttribute(a)}"`);
    out.issues.push(makeIssue('E_SVG_NO_SIZE', name, present.length ? present.join(' ') : 'no width, height or viewBox on the <svg> element',
      'an <svg> element with width and height in absolute units (px, pt, pc, in, cm, mm) or a viewBox of positive size',
      'Without a stated size the drawing has no proportions, so hotspot positions could not be kept exact.',
      'Add width="<w>" height="<h>" (in px) or a viewBox="0 0 <w> <h>" to the <svg> element, for example width="1200" height="800".'));
    return out;
  }
  if (out.width * out.height > MAX_DECODED_PIXELS) {
    out.issues.push(makeIssue('E_IMAGE_TOO_LARGE', name, `${out.width} x ${out.height}`, `at most ${MAX_DECODED_PIXELS / 1e6} million pixels`,
      'Decoding larger images can exhaust browser memory on the recipient\'s computer.', 'Reduce the width/height or viewBox of the SVG, or split the diagram into detail images.'));
    return out;
  }
  const parts = countInertParts(doc);
  if (parts.length) {
    out.issues.push(makeIssue('W_SVG_INERT_PARTS', name, parts.join(', '), 'a drawing without scripts, event handlers, foreignObject or external references',
      'SVG is shown as a picture: scripts, links and anything loaded from the internet will not run or load.',
      'Nothing to do if the picture looks right. To include external images or fonts, embed them in the SVG as data: URLs or convert the text to outlines.', 'warning'));
  }
  const count = doc.getElementsByTagName('*').length;
  if (count > SVG_COMPLEX_ELEMENTS) {
    out.issues.push(makeIssue('W_SVG_COMPLEX', name, `${count} elements`, `at most ${SVG_COMPLEX_ELEMENTS} elements`,
      'A drawing this detailed can make the presentation slow to open and to pan on the recipient\'s computer.',
      'Simplify the drawing (merge or remove tiny shapes), or import a PNG of it.', 'warning'));
  }
  return out;
}
