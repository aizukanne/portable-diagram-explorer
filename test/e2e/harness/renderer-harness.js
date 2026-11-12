// Test harness: one SceneRenderer over a generated 1600x900 image (test-only).
import { SceneRenderer } from '../../../src/ui/renderer.js';
import { DIAGRAM_SVG } from '../../helpers/svg-diagram.mjs';

const W = 1600;
const H = 900;
const HOTSPOTS = [
  { id: 'h-a', label: 'Alpha', tooltip: 'Alpha tooltip', rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.15 }, zIndex: 1, hasMenu: true },
  { id: 'h-b', label: 'Beta', tooltip: 'Beta tooltip', rect: { x: 0.55, y: 0.5, width: 0.3, height: 0.3 }, zIndex: 1, hasMenu: false },
  { id: 'h-c', label: 'Gamma', tooltip: '', rect: { x: 0.6, y: 0.55, width: 0.1, height: 0.1 }, zIndex: 2, hasMenu: false },
];
const root = document.getElementById('pde-root');
root.style.setProperty('position', 'fixed');
root.style.setProperty('inset', '0');
const events = [];
window.__events = events;
const r = new SceneRenderer(root, {
  tooltipDelayMs: 350,
  onActivate: (id, mode, anchor) => events.push({ kind: 'activate', id, mode, anchor }),
  onView: (v) => events.push({ kind: 'view', v }),
  onKey: (key) => events.push({ kind: 'key', key }),
});
window.__r = r;
const c = document.createElement('canvas');
c.width = W; c.height = H;
const g = c.getContext('2d');
g.fillStyle = '#fafafa'; g.fillRect(0, 0, W, H);
g.strokeStyle = '#ccc';
for (let x = 0; x < W; x += 100) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
for (let y = 0; y < H; y += 100) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
for (const hs of HOTSPOTS) { g.fillStyle = '#9ec5fe'; g.fillRect(hs.rect.x * W, hs.rect.y * H, hs.rect.width * W, hs.rect.height * H); }
if (location.search === '?svg') {
  // SVG mode: the scene is the 1200x800 SVG drawing; one hotspot over its marker rect.
  const svgHotspots = [{ id: 'h-svg', label: 'Marker', tooltip: '', rect: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, zIndex: 1, hasMenu: false }];
  const url = URL.createObjectURL(new Blob([DIAGRAM_SVG], { type: 'image/svg+xml' }));
  r.setScene({ title: 'SVG harness', width: 1200, height: 800, hotspots: svgHotspots, annotations: [] }, url)
    .then(() => { document.documentElement.dataset.ready = '1'; });
} else c.toBlob((blob) => {
  r.setScene({ title: 'Harness', width: W, height: H, hotspots: HOTSPOTS, annotations: [{ id: 'n-1', text: '<b>not bold</b>\nsecond line', x: 0.05, y: 0.8, width: 0.3 }] }, URL.createObjectURL(blob))
    .then(() => { document.documentElement.dataset.ready = '1'; });
}, 'image/png');
