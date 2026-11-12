// Test harness: exposes inspectSvg to the browser (it needs DOMParser). Test-only.
import { inspectSvg, MAX_SVG_BYTES, SVG_COMPLEX_ELEMENTS } from '../../../src/ui/svg-inspect.js';

const enc = new TextEncoder();
window.__inspect = (text) => inspectSvg(enc.encode(text), 'case.svg');
// Inputs too large to ship through the test runner are generated here.
window.__inspectBig = (kind) => {
  if (kind === 'bytes') {
    const head = enc.encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    const b = new Uint8Array(MAX_SVG_BYTES + 1);
    b.set(head);
    return inspectSvg(b, 'big.svg');
  }
  const n = kind === 'elements-over' ? SVG_COMPLEX_ELEMENTS + 1 : SVG_COMPLEX_ELEMENTS;
  // The root counts as one element.
  return inspectSvg(enc.encode(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${'<g/>'.repeat(n - 1)}</svg>`), 'many.svg');
};
document.documentElement.dataset.ready = '1';
