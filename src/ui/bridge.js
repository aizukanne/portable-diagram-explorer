// FrameBridge: the parent's side of the single reusable modal iframe (spec §8,
// design D16, D17).
//
// The frame is created once, from the trusted srcdoc template the build embeds,
// with sandbox="allow-scripts" only (no same-origin, no navigation, no popups, no
// forms). The parent authenticates every inbound message by exact window identity
// (event.source === the frame's contentWindow), an unguessable per-frame channel,
// a strictly increasing sequence number and the current scene token. Outbound
// messages go only to that frame's window; nothing is ever broadcast.
import { buildInfo } from './build-info.js';
import { makeMessage, validateChildMessage, randomToken } from '../core/protocol.js';

const RENDER_TIMEOUT_MS = 20000;

export class FrameBridge {
  constructor(container, { onActivate, onView, onKey, title = 'Diagram' } = {}) {
    this.channel = randomToken();
    this.outSeq = 0;
    this.inSeq = 0;
    this.ready = false;
    this.sceneToken = null;
    this.sceneIds = new Set();
    this.pending = null;
    this.queued = null;
    this.handlers = { onActivate: onActivate || (() => {}), onView: onView || (() => {}), onKey: onKey || (() => {}) };
    this.stats = { accepted: 0, rejected: 0 };
    const template = buildInfo().frameTemplate;
    if (!template || template.split('__CHANNEL__').length !== 2) throw new Error('frame template missing from build');
    this.frame = document.createElement('iframe');
    this.frame.setAttribute('sandbox', 'allow-scripts');
    this.frame.setAttribute('referrerpolicy', 'no-referrer');
    this.frame.className = 'pde-frame';
    this.frame.title = title;
    this.frame.srcdoc = template.replace('__CHANNEL__', this.channel);
    this.onMessage = (e) => this.receive(e);
    window.addEventListener('message', this.onMessage);
    container.append(this.frame);
    const stats = this.stats;
    Object.defineProperty(window, '__pdeStats', { configurable: true, get: () => ({ ...stats }) });
  }

  setTitle(title) { this.frame.title = title; }

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

  focusHotspot(hotspotId) {
    this.frame.focus();
    if (this.ready && this.sceneToken) this.post('FOCUS_HOTSPOT', { sceneToken: this.sceneToken, hotspotId });
  }

  focus(which = 'first') {
    this.frame.focus();
    this.command(which === 'last' ? 'focusLast' : 'focusFirst');
  }

  destroy() {
    window.removeEventListener('message', this.onMessage);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.resolve({ superseded: true }); this.pending = null; }
    this.frame.removeAttribute('srcdoc');
    this.frame.remove();
  }
}
