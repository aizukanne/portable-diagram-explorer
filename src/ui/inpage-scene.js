// InPageScene: the drill-down renderer used when the sandboxed frame cannot start
// (S7, issue #16). It has FrameBridge's public surface, so the viewer drives either
// one the same way, but it renders in the page itself.
//
// What this gives up, and nothing more: the frame's opaque-origin isolation. The
// scene is still built only from DOM construction (no markup strings), the image is
// an <img> (inert; scripts in an SVG never run there), and the page's own CSP is not
// touched. The viewer tells the user the isolation is reduced (spec section 5.3).
import { SceneRenderer } from './renderer.js';
import { h } from './dom.js';
import { randomToken } from '../core/protocol.js';

export class InPageScene {
  constructor(container, { onActivate, onView, onKey, title = 'Diagram' } = {}) {
    this.handlers = { onActivate: onActivate || (() => {}), onView: onView || (() => {}), onKey: onKey || (() => {}) };
    this.sceneToken = null;
    this.viewQueued = false;
    this.el = h('div', { class: 'pde-inpage-scene', role: 'group', 'aria-label': title, tabindex: '-1' });
    container.append(this.el);
    this.renderer = new SceneRenderer(this.el, {
      mode: 'present',
      // Exactly the frame's mode: the slide keys are forwarded to the viewer, which
      // decides what they mean (it knows whether the project has a running order).
      slideKeys: 'forward',
      onActivate: (id, mode, anchor) => {
        if (!this.sceneToken) return;
        // The renderer's anchor is local to its element; the viewer wants viewport
        // coordinates, as FrameBridge delivers them.
        const r = this.el.getBoundingClientRect();
        this.handlers.onActivate(id, mode, { x: Math.round(r.left + anchor.x), y: Math.round(r.top + anchor.y) });
      },
      onView: () => this.queueView(),
      onSelect: () => this.queueView(),
      onKey: (key, e) => {
        // In the frame a key is delivered to the viewer once. Here the same keydown would
        // go on bubbling to the viewer's document handler (arrows step slides, Escape
        // closes) and act a second time, so the keydown is marked handled.
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        this.handlers.onKey(key);
      },
    });
  }

  get ready() { return true; }

  // The element viewer.wrapFocus and navigate treat as "the frame".
  get frame() { return this.el; }

  setTitle(title) { this.el.setAttribute('aria-label', title); }

  queueView() {
    if (this.viewQueued || !this.sceneToken) return;
    this.viewQueued = true;
    requestAnimationFrame(() => {
      this.viewQueued = false;
      if (this.sceneToken) this.handlers.onView(this.renderer.getView(), this.renderer.selectedId || null);
    });
  }

  // Resolves when the image has rendered; a newer render supersedes an older one,
  // whose promise then resolves as superseded (the same contract as FrameBridge).
  render(scene, dataUrl, viewport, selectedHotspotId, settings) {
    const token = randomToken();
    this.sceneToken = token;
    // Work inside the scene keeps its keyboard focus on the new scene, as in the frame.
    const hadFocus = this.el.contains(document.activeElement);
    this.renderer.opts.tooltipDelayMs = settings.tooltipDelayMs;
    this.renderer.setHints(settings.showHotspotHints);
    return this.renderer.setScene(scene, dataUrl, viewport || null, selectedHotspotId || null).then(() => {
      if (this.sceneToken !== token) return { superseded: true };
      if (hadFocus && !(selectedHotspotId && this.renderer.focusHotspot(selectedHotspotId))) this.renderer.focusEdge('first');
      return undefined;
    });
  }

  command(command) {
    switch (command) {
      case 'fit': this.renderer.fit(); break;
      case 'zoomIn': this.renderer.zoomBy(1.25); break;
      case 'zoomOut': this.renderer.zoomBy(0.8); break;
      case 'hideTooltip': this.renderer.hideTooltip(); break;
      case 'focusFirst': this.focus('first'); break;
      case 'focusLast': this.focus('last'); break;
      default: break;
    }
  }

  focus(which = 'first') {
    if (!this.renderer.focusEdge(which === 'last' ? 'last' : 'first')) this.el.focus({ preventScroll: true });
  }

  focusHotspot(hotspotId) {
    if (!this.renderer.focusHotspot(hotspotId)) this.focus('first');
  }

  destroy() {
    this.sceneToken = null;
    this.renderer.destroy();
    this.el.remove();
  }
}
