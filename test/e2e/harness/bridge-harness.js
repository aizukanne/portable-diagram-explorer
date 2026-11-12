// Test harness: a FrameBridge rendering generated scenes (test-only).
import { FrameBridge } from '../../../src/ui/bridge.js';
import { buildInfo } from '../../../src/ui/build-info.js';

const root = document.getElementById('pde-root');
root.style.setProperty('position', 'fixed');
root.style.setProperty('inset', '0');
const events = [];
window.__events = events;
// `?broken`: the frame template's script is replaced by `throw 0`, so the frame never
// sends READY. (The replaced text no longer matches the frame's own CSP hash, so the
// engine refuses it before it can even throw; either way READY never arrives, and
// onStartFailed must fire within the start-up deadline.)
const broken = new URLSearchParams(location.search).has('broken');
if (broken) {
  const info = buildInfo();
  info.frameTemplate = info.frameTemplate.replace(/(<script__NONCE_ATTR__>)[\s\S]*(<\/script>)/, (_, a, b) => `${a}throw 0${b}`);
}
window.__startFailedAt = 0;
const bridge = new FrameBridge(root, {
  title: 'Diagram: harness',
  onStartFailed: () => { window.__startFailedAt = Date.now(); },
  onActivate: (id, mode, anchor) => events.push({ kind: 'activate', id, mode, anchor }),
  onView: (v, sel) => events.push({ kind: 'view', v, sel }),
  onKey: (key) => events.push({ kind: 'key', key }),
});
bridge.frame.style.setProperty('width', '100%');
bridge.frame.style.setProperty('height', '100%');
bridge.frame.style.setProperty('border', '0');
window.__bridge = bridge;

function image(color) {
  const c = document.createElement('canvas');
  c.width = 800; c.height = 500;
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 800, 500);
  return c.toDataURL('image/png');
}
const settings = { tooltipDelayMs: 100, showHotspotHints: true };
window.__scenes = {
  A: { title: 'Scene A', width: 800, height: 500, hotspots: [{ id: 'h-a1', label: 'A one', tooltip: 'tip A1', rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 }, zIndex: 1, hasMenu: true }], annotations: [{ id: 'n-x', text: '<img src=x onerror="window.top.pwned=1">', x: 0.1, y: 0.7, width: 0.6 }] },
  B: { title: 'Scene B', width: 800, height: 500, hotspots: [{ id: 'h-b1', label: 'B one', tooltip: 'tip B1', rect: { x: 0.5, y: 0.5, width: 0.3, height: 0.3 }, zIndex: 1, hasMenu: false }], annotations: [] },
};
const urls = { A: image('#cde'), B: image('#edc') };
window.__render = (k) => bridge.render(window.__scenes[k], urls[k], null, null, settings).then((r) => { window.__rendered = k; return r || 'ok'; });
window.__render('A').then(() => { document.documentElement.dataset.ready = '1'; }, (e) => { window.__renderRejection = e; });
