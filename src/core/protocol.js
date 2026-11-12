// The parent <-> frame message protocol, version 1 (spec §8, design D16).
//
// Every message is { pde: 1, channel, seq, type, ...fields }. A receiver accepts a
// message only if: it is a plain object; the protocol version and channel match;
// seq strictly increases; the type is known for that direction; the field set is
// exactly the type's whitelist; and every field has the right shape. Messages that
// concern a scene must carry the current sceneToken, so a reply to an earlier scene
// can never act on the one now shown. Child messages never carry targets or URLs:
// the parent resolves everything from its own model.
import { ID_PATTERN } from './ids.js';
import { ZOOM_MIN, ZOOM_MAX } from './geometry.js';

export const PROTOCOL = 1;
const BASE = ['pde', 'channel', 'seq', 'type'];
const TOKEN_RE = /^[0-9a-f]{32}$/;

export function randomToken() {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const isFiniteIn = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isId = (v) => typeof v === 'string' && ID_PATTERN.test(v);
const isStr = (v, max) => typeof v === 'string' && v.length <= max;
const exactKeys = (o, keys) => isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
const isView = (v) => exactKeys(v, ['cx', 'cy', 'zoom']) && isFiniteIn(v.cx, 0, 1) && isFiniteIn(v.cy, 0, 1) && isFiniteIn(v.zoom, ZOOM_MIN, ZOOM_MAX);
const isRect = (r) => exactKeys(r, ['x', 'y', 'width', 'height']) && isFiniteIn(r.x, 0, 1) && isFiniteIn(r.y, 0, 1) && isFiniteIn(r.width, 0, 1) && isFiniteIn(r.height, 0, 1);

const CHILD_TYPES = {
  READY: { fields: [], token: false, check: () => true },
  SCENE_READY: { fields: ['sceneToken'], token: true, check: () => true },
  ACTIVATE_HOTSPOT: {
    fields: ['sceneToken', 'hotspotId', 'mode', 'anchor'], token: true,
    check: (m) => isId(m.hotspotId) && (m.mode === 'default' || m.mode === 'menu')
      && exactKeys(m.anchor, ['x', 'y']) && isFiniteIn(m.anchor.x, -1e5, 1e5) && isFiniteIn(m.anchor.y, -1e5, 1e5),
  },
  VIEWPORT_CHANGED: {
    fields: ['sceneToken', 'viewport', 'selectedHotspotId'], token: true,
    check: (m) => isView(m.viewport) && (m.selectedHotspotId === null || isId(m.selectedHotspotId)),
  },
  KEY: { fields: ['key'], token: false, check: (m) => ['Escape', 'Back', 'Next', 'Previous', 'Fit', 'ZoomIn', 'ZoomOut', 'FocusOut'].includes(m.key) },
};

const isScene = (s) => exactKeys(s, ['title', 'width', 'height', 'hotspots', 'annotations'])
  && isStr(s.title, 200) && Number.isInteger(s.width) && s.width > 0 && Number.isInteger(s.height) && s.height > 0
  && Array.isArray(s.hotspots) && s.hotspots.length <= 1000 && s.hotspots.every((h) => exactKeys(h, ['id', 'label', 'tooltip', 'rect', 'zIndex', 'hasMenu'])
    && isId(h.id) && isStr(h.label, 120) && isStr(h.tooltip, 500) && isRect(h.rect) && Number.isInteger(h.zIndex) && typeof h.hasMenu === 'boolean')
  && Array.isArray(s.annotations) && s.annotations.length <= 500 && s.annotations.every((n) => exactKeys(n, ['id', 'text', 'x', 'y', 'width'])
    && isId(n.id) && isStr(n.text, 2000) && isFiniteIn(n.x, 0, 1) && isFiniteIn(n.y, 0, 1) && isFiniteIn(n.width, 0, 1));

const PARENT_TYPES = {
  RENDER_SCENE: {
    fields: ['sceneToken', 'scene', 'image', 'viewport', 'selectedHotspotId', 'settings'],
    check: (m) => TOKEN_RE.test(m.sceneToken) && isScene(m.scene)
      && exactKeys(m.image, ['dataUrl']) && typeof m.image.dataUrl === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(m.image.dataUrl)
      && (m.viewport === null || isView(m.viewport)) && (m.selectedHotspotId === null || isId(m.selectedHotspotId))
      && exactKeys(m.settings, ['tooltipDelayMs', 'showHotspotHints']) && Number.isInteger(m.settings.tooltipDelayMs)
      && m.settings.tooltipDelayMs >= 0 && m.settings.tooltipDelayMs <= 5000 && typeof m.settings.showHotspotHints === 'boolean',
  },
  COMMAND: {
    fields: ['sceneToken', 'command'],
    check: (m) => TOKEN_RE.test(m.sceneToken) && ['fit', 'zoomIn', 'zoomOut', 'hideTooltip', 'focusFirst', 'focusLast', 'focusHotspot'].includes(m.command),
  },
  FOCUS_HOTSPOT: {
    fields: ['sceneToken', 'hotspotId'],
    check: (m) => TOKEN_RE.test(m.sceneToken) && isId(m.hotspotId),
  },
};

export function makeMessage(channel, seq, type, fields) {
  return { pde: PROTOCOL, channel, seq, type, ...fields };
}

function validateCommon(m, ctx, types) {
  if (!isObj(m)) return { ok: false, reason: 'not a plain object' };
  if (m.pde !== PROTOCOL) return { ok: false, reason: 'protocol version' };
  if (m.channel !== ctx.channel) return { ok: false, reason: 'channel' };
  if (!Number.isInteger(m.seq) || m.seq <= ctx.lastSeq) return { ok: false, reason: 'sequence' };
  const spec = Object.prototype.hasOwnProperty.call(types, m.type) ? types[m.type] : null;
  if (!spec) return { ok: false, reason: 'type' };
  if (!exactKeys(m, [...BASE, ...spec.fields])) return { ok: false, reason: 'fields' };
  if (!spec.check(m)) return { ok: false, reason: 'shape' };
  return { ok: true, spec };
}

// Parent side: validate a message that claims to come from the frame.
export function validateChildMessage(m, ctx) {
  const r = validateCommon(m, ctx, CHILD_TYPES);
  if (!r.ok) return r;
  if (r.spec.token && m.sceneToken !== ctx.sceneToken) return { ok: false, reason: 'stale scene' };
  return { ok: true };
}

// Frame side: validate a message that claims to come from the parent.
export function validateParentMessage(m, ctx) {
  const r = validateCommon(m, ctx, PARENT_TYPES);
  return r.ok ? { ok: true } : r;
}
