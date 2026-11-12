// FrameBridge: the parent's side of the single reusable modal iframe (spec §8,
// design D16, D17).
//
// The frame is created once, from the trusted srcdoc template the build embeds,
// with sandbox="allow-scripts" only (no same-origin, no navigation, no popups, no
// forms). The parent authenticates every inbound message by exact window identity
// (event.source === the frame's contentWindow), an unguessable per-frame channel,
// a strictly increasing sequence number and the current scene token. Outbound
// messages go only to that frame's window; nothing is ever broadcast.
import { buildInfo, NONCE_RE } from './build-info.js';
import { makeMessage, validateChildMessage, randomToken } from '../core/protocol.js';

const RENDER_TIMEOUT_MS = 20000;
// How long the frame has, from its creation, to send READY before the viewer gives up
// on it and renders drill-downs in the page instead (S7). Spike SP-2 measured the worst
// p99 at 1206 ms (Firefox under load); the formula max(3 x p99, 2000) gives 3618 ms,
// rounded up to a whole second. One value for all engines.
export const FRAME_START_DEADLINE_MS = 4000;
const NONCE_MARK = '__NONCE_ATTR__';

// The frame document for one frame: both nonce marks filled and the channel set. A nonce
// that is not plain base64 text is treated as absent: it cannot carry a quote or an angle
// bracket into the markup, whatever the host page put in the attribute. Function
// replacements are used throughout: a string one would interpret "$'" and "$&" in a value.
export function frameSrcdoc(template, nonce, channel) {
  if (template.split(NONCE_MARK).length !== 3) throw new Error('frame template must carry exactly two nonce marks');
  const attr = typeof nonce === 'string' && NONCE_RE.test(nonce) ? ` nonce="${nonce}"` : '';
  return template.replaceAll(NONCE_MARK, () => attr).replace('__CHANNEL__', () => channel);
}

export class FrameBridge {
  // `nonce` is the host page's CSP nonce, if it has one; it is written into the frame's
  // two inline tags and nowhere else, and only if it is a plain nonce (NONCE_RE).
  // `onStartFailed` fires once if READY has not arrived within FRAME_START_DEADLINE_MS.
  constructor(container, { onActivate, onView, onKey, nonce = '', onStartFailed, title = 'Diagram' } = {}) {
    this.channel = randomToken();
    this.outSeq = 0;
    this.inSeq = 0;
    this.ready = false;
    this.failed = false;
    this.sceneToken = null;
    this.sceneIds = new Set();
    this.pending = null;
    this.queued = null;
    this.handlers = { onActivate: onActivate || (() => {}), onView: onView || (() => {}), onKey: onKey || (() => {}), onStartFailed: onStartFailed || (() => {}) };
    this.stats = { accepted: 0, rejected: 0 };
    const template = buildInfo().frameTemplate;
    if (!template || template.split('__CHANNEL__').length !== 2) throw new Error('frame template missing from build');
    this.frame = document.createElement('iframe');
    this.frame.setAttribute('sandbox', 'allow-scripts');
    this.frame.setAttribute('referrerpolicy', 'no-referrer');
    this.frame.className = 'pde-frame';
    this.frame.title = title;
    this.frame.srcdoc = frameSrcdoc(template, nonce, this.channel);
    this.onMessage = (e) => this.receive(e);
    window.addEventListener('message', this.onMessage);
    container.append(this.frame);
    this.startTimer = setTimeout(() => this.startFailed(), FRAME_START_DEADLINE_MS);
    const stats = this.stats;
    Object.defineProperty(window, '__pdeStats', { configurable: true, get: () => ({ ...stats }) });
  }

  setTitle(title) { this.frame.title = title; }

  // No READY within the deadline. The frame is not trusted to start later: a render the
  // caller is waiting on is rejected as { startFailed: true } (not an Error, so the viewer
  // does not announce it), and the owner is told once so it can render another way.
  startFailed() {
    if (this.ready || this.failed) return;
    this.failed = true;
    this.queued = null;
    const p = this.pending;
    this.pending = null;
    if (p) clearTimeout(p.timer);
    this.handlers.onStartFailed();
    if (p) p.reject({ startFailed: true });
  }

  post(type, fields) {
    if (!this.frame.contentWindow) return;
    this.outSeq += 1;
    // An opaque-origin receiver cannot be addressed by origin; we address the one
    // window we created and never broadcast.
    this.frame.contentWindow.postMessage(makeMessage(this.channel, this.outSeq, type, fields), '*');
  }

  receive(e) {
    const m = e.data;
    if (e.source !== this.frame.contentWindow) {
      if (m && typeof m === 'object' && 'pde' in m) this.stats.rejected += 1;
      return;
    }
    const v = validateChildMessage(m, { channel: this.channel, lastSeq: this.inSeq, sceneToken: this.sceneToken });
    if (!v.ok) { this.stats.rejected += 1; return; }
    if (m.type === 'ACTIVATE_HOTSPOT' && !this.sceneIds.has(m.hotspotId)) { this.stats.rejected += 1; return; }
    this.inSeq = m.seq;
    this.stats.accepted += 1;
    switch (m.type) {
      case 'READY':
        if (this.failed) break;
        clearTimeout(this.startTimer);
        this.ready = true;
        if (this.queued) { const q = this.queued; this.queued = null; this.sendRender(q); }
        break;
      case 'SCENE_READY':
        if (this.pending && this.pending.token === m.sceneToken) { const p = this.pending; this.pending = null; clearTimeout(p.timer); p.resolve(); }
        break;
      case 'ACTIVATE_HOTSPOT': {
        const r = this.frame.getBoundingClientRect();
        this.handlers.onActivate(m.hotspotId, m.mode, { x: Math.round(r.left + m.anchor.x), y: Math.round(r.top + m.anchor.y) });
        break;
      }
      case 'VIEWPORT_CHANGED':
        this.handlers.onView(m.viewport, m.selectedHotspotId);
        break;
      case 'KEY':
        this.handlers.onKey(m.key);
        break;
      default:
        break;
    }
  }

  // Show a scene. Resolves when the frame reports the image rendered; a newer
  // render supersedes an older one (whose promise then resolves as superseded).
  render(scene, dataUrl, viewport, selectedHotspotId, settings) {
    if (this.pending) { const p = this.pending; this.pending = null; clearTimeout(p.timer); p.resolve({ superseded: true }); }
    if (this.failed) return Promise.reject({ startFailed: true });
    const token = randomToken();
    this.sceneToken = token;
    this.sceneIds = new Set(scene.hotspots.map((x) => x.id));
    const job = { token, scene, dataUrl, viewport: viewport || null, selectedHotspotId: selectedHotspotId || null, settings };
    return new Promise((resolve, reject) => {
      this.pending = {
        token, resolve, reject,
        timer: setTimeout(() => {
          if (this.pending && this.pending.token === token) { this.pending = null; reject(new Error(`the diagram "${scene.title}" did not finish rendering`)); }
        }, RENDER_TIMEOUT_MS),
      };
      if (this.ready) this.sendRender(job); else this.queued = job;
    });
  }

  sendRender(job) {
    this.post('RENDER_SCENE', {
      sceneToken: job.token, scene: job.scene, image: { dataUrl: job.dataUrl },
      viewport: job.viewport, selectedHotspotId: job.selectedHotspotId, settings: job.settings,
    });
  }

  command(command) {
    if (this.ready && this.sceneToken) this.post('COMMAND', { sceneToken: this.sceneToken, command });
  }

  // Move browser focus into the frame's window as well as onto the element: some
  // engines leave window focus in the parent otherwise (measured in WebKit).
  focusFrameWindow() {
    this.frame.focus();
    try { this.frame.contentWindow.focus(); } catch { /* cross-origin focus() is permitted; ignore if not */ }
  }

  focusHotspot(hotspotId) {
    this.focusFrameWindow();
    if (this.ready && this.sceneToken) this.post('FOCUS_HOTSPOT', { sceneToken: this.sceneToken, hotspotId });
  }

  focus(which = 'first') {
    this.focusFrameWindow();
    this.command(which === 'last' ? 'focusLast' : 'focusFirst');
  }

  destroy() {
    clearTimeout(this.startTimer);
    window.removeEventListener('message', this.onMessage);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.resolve({ superseded: true }); this.pending = null; }
    this.frame.removeAttribute('srcdoc');
    this.frame.remove();
  }
}
