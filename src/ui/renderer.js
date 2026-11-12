// SceneRenderer: one image, its hotspots and notes, in one transformed image-space
// container (spec §5, §7; design D14, D15). Used by the presentation root view,
// inside the sandboxed frame, and by the editor canvas.
//
// Coordinates: hotspot and note geometry is stored normalized (0–1); inside the
// scene container everything is in natural image pixels; one CSS transform maps
// image pixels to the viewport. Pointer input is mapped back through the inverse of
// that same transform, so overlays cannot drift from the image at any zoom.
import { h, svg, clear } from './dom.js';
import { viewTransform, screenToImage, zoomAt, panBy, normalizeView, clampRect, normRectFromPoints, roundRect, DEFAULT_VIEW } from '../core/geometry.js';

const DRAG_THRESHOLD = 5;
const HANDLE_PX = 9;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export class SceneRenderer {
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = {
      mode: 'present',
      tooltipDelayMs: 350,
      showHints: true,
      onActivate: () => {},
      onView: () => {},
      onSelect: () => {},
      onKey: () => {},
      onEdit: () => {},
      ...opts,
    };
    this.view = { ...DEFAULT_VIEW };
    this.scene = null;
    this.selectedId = null;
    this.tool = 'select';
    this.pointers = new Map();
    this.gesture = null;
    this.spaceDown = false;
    this.tooltipTimer = 0;
    this.tooltipFor = null;
    this.menuBtnFor = null;
    this.menuBtnTimer = 0;

    host.classList.add('pde-viewport', `pde-mode-${this.opts.mode}`);
    this.img = h('img', { class: 'pde-image', alt: '', draggable: 'false', decoding: 'async' });
    this.notes = h('div', { class: 'pde-notes' });
    this.layer = svg('svg', { class: 'pde-hotspots', 'aria-label': 'Components' });
    this.sceneEl = h('div', { class: 'pde-scene' }, this.img, this.notes, this.layer);
    this.tooltip = h('div', { class: 'pde-tooltip', role: 'tooltip', id: `pde-tip-${Math.random().toString(36).slice(2)}`, hidden: true });
    this.menuBtn = h('button', { type: 'button', class: 'pde-hotspot-menu', hidden: true, tabindex: '-1', text: '⋯' });
    this.status = h('div', { class: 'pde-sr-only', role: 'status', 'aria-live': 'polite' });
    host.append(this.sceneEl, this.tooltip, this.menuBtn, this.status);
    this.setHints(this.opts.showHints);

    this.bound = {
      down: (e) => this.onPointerDown(e),
      move: (e) => this.onPointerMove(e),
      up: (e) => this.onPointerUp(e),
      cancel: (e) => this.onPointerCancel(e),
      wheel: (e) => this.onWheel(e),
      context: (e) => this.onContextMenu(e),
      keydown: (e) => this.onKeyDown(e),
      keyup: (e) => { if (e.key === ' ') this.spaceDown = false; },
      blur: () => { this.spaceDown = false; },
    };
    host.addEventListener('pointerdown', this.bound.down);
    host.addEventListener('pointermove', this.bound.move);
    host.addEventListener('pointerup', this.bound.up);
    host.addEventListener('pointercancel', this.bound.cancel);
    host.addEventListener('wheel', this.bound.wheel, { passive: false });
    host.addEventListener('contextmenu', this.bound.context);
    host.addEventListener('keydown', this.bound.keydown);
    host.addEventListener('keyup', this.bound.keyup);
    window.addEventListener('blur', this.bound.blur);
    this.menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = this.menuBtnFor;
      if (id) this.opts.onActivate(id, 'menu', this.anchorOf(id));
    });
    this.menuBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.menuBtn.addEventListener('pointerenter', () => clearTimeout(this.menuBtnTimer));
    this.menuBtn.addEventListener('pointerleave', () => this.scheduleMenuBtnHide());
    // The viewport never scrolls: all movement is the scene transform. Focusing a
    // hotspot can still scroll an overflow:hidden box in some engines, which would
    // shift everything by a few pixels (measured in WebKit), so undo any scroll.
    this.bound.scroll = () => { if (host.scrollLeft || host.scrollTop) { host.scrollLeft = 0; host.scrollTop = 0; } };
    host.addEventListener('scroll', this.bound.scroll);
    this.resizeObs = new ResizeObserver(() => this.apply());
    this.resizeObs.observe(host);
  }

  // ---- scene ---------------------------------------------------------------

  setScene(scene, imageUrl, view, selectedId) {
    this.scene = scene;
    this.selectedId = selectedId || null;
    this.view = normalizeView(view || DEFAULT_VIEW);
    this.hideTooltip();
    this.hideMenuBtn();
    this.sceneEl.style.width = `${scene.width}px`;
    this.sceneEl.style.height = `${scene.height}px`;
    this.img.width = scene.width;
    this.img.height = scene.height;
    this.img.alt = scene.title;
    this.layer.setAttribute('viewBox', `0 0 ${scene.width} ${scene.height}`);
    this.layer.setAttribute('width', scene.width);
    this.layer.setAttribute('height', scene.height);
    this.renderContent();
    this.apply();
    const loaded = new Promise((resolve, reject) => {
      if (this.img.getAttribute('src') === imageUrl && this.img.complete && this.img.naturalWidth) { resolve(); return; }
      this.img.onload = () => resolve();
      this.img.onerror = () => reject(new Error(`the image for "${scene.title}" could not be decoded`));
    });
    if (this.img.getAttribute('src') !== imageUrl) this.img.src = imageUrl;
    return loaded;
  }

  // Re-render hotspots and notes without reloading the image (editor changes).
  updateScene(scene) {
    const dimsChanged = !this.scene || scene.width !== this.scene.width || scene.height !== this.scene.height;
    this.scene = scene;
    if (dimsChanged) {
      this.sceneEl.style.width = `${scene.width}px`;
      this.sceneEl.style.height = `${scene.height}px`;
      this.img.width = scene.width; this.img.height = scene.height;
      this.layer.setAttribute('viewBox', `0 0 ${scene.width} ${scene.height}`);
      this.layer.setAttribute('width', scene.width); this.layer.setAttribute('height', scene.height);
    }
    if (this.selectedId && !scene.hotspots.some((x) => x.id === this.selectedId) && !scene.annotations.some((x) => x.id === this.selectedId)) this.selectedId = null;
    const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;
    this.renderContent();
    if (focusedId) this.focusHotspot(focusedId, { quiet: true });
    this.apply();
  }

  renderContent() {
    const { scene } = this;
    clear(this.layer);
    clear(this.notes);
    const W = scene.width;
    const H = scene.height;
    const ordered = scene.hotspots.map((hs, i) => ({ hs, i })).sort((a, b) => (a.hs.zIndex - b.hs.zIndex) || (a.i - b.i));
    for (const { hs } of ordered) {
      const r = hs.rect;
      const el = svg('rect', {
        class: ['pde-hotspot', hs.id === this.selectedId && 'is-selected'],
        x: r.x * W, y: r.y * H, width: r.width * W, height: r.height * H,
        rx: Math.min(W, H) * 0.004,
        tabindex: '0', role: 'button', focusable: 'true',
        'aria-label': hs.label,
        'aria-describedby': hs.tooltip ? this.tooltip.id : undefined,
        'aria-haspopup': hs.hasMenu ? 'menu' : undefined,
        dataset: { id: hs.id, rect: JSON.stringify(r) },
      });
      el.addEventListener('pointerenter', () => this.onHotspotEnter(hs.id));
      el.addEventListener('pointerleave', () => this.onHotspotLeave(hs.id));
      el.addEventListener('focus', () => this.onHotspotFocus(hs.id));
      el.addEventListener('blur', () => this.onHotspotBlur(hs.id));
      this.layer.append(el);
    }
    const fontPx = Math.max(10, Math.round(Math.max(W, H) / 70));
    for (const n of scene.annotations) {
      this.notes.append(h('div', {
        class: ['pde-annotation', n.id === this.selectedId && 'is-selected'],
        dataset: { id: n.id },
        style: {
          left: `${n.x * W}px`, top: `${n.y * H}px`, width: `${n.width * W}px`,
          'max-height': `${(1 - n.y) * H}px`, 'font-size': `${fontPx}px`,
        },
        text: n.text,
      }));
    }
    if (this.opts.mode === 'edit') this.renderHandles();
  }

  renderHandles() {
    this.layer.querySelectorAll('.pde-handle').forEach((x) => x.remove());
    const hs = this.scene && this.scene.hotspots.find((x) => x.id === this.selectedId);
    if (!hs) return;
    const W = this.scene.width;
    const H = this.scene.height;
    const s = this.transform().s || 1;
    const size = HANDLE_PX / s;
    const r = hs.rect;
    const pos = {
      nw: [r.x, r.y], n: [r.x + r.width / 2, r.y], ne: [r.x + r.width, r.y], e: [r.x + r.width, r.y + r.height / 2],
      se: [r.x + r.width, r.y + r.height], s: [r.x + r.width / 2, r.y + r.height], sw: [r.x, r.y + r.height], w: [r.x, r.y + r.height / 2],
    };
    for (const k of HANDLES) {
      this.layer.append(svg('rect', {
        class: `pde-handle pde-handle-${k}`, x: pos[k][0] * W - size / 2, y: pos[k][1] * H - size / 2,
        width: size, height: size, dataset: { handle: k }, 'aria-hidden': 'true',
      }));
    }
  }

  // ---- view ----------------------------------------------------------------

  size() {
    const r = this.host.getBoundingClientRect();
    return { w: r.width, h: r.height, left: r.left, top: r.top };
  }

  transform() {
    if (!this.scene) return { s: 1, tx: 0, ty: 0 };
    const { w, h: hh } = this.size();
    return viewTransform(this.scene.width, this.scene.height, w, hh, this.view);
  }

  apply() {
    if (!this.scene) return;
    const t = this.transform();
    this.sceneEl.style.transform = `matrix(${t.s}, 0, 0, ${t.s}, ${t.tx}, ${t.ty})`;
    this.host.style.setProperty('--pde-scale', String(t.s));
    if (this.opts.mode === 'edit') this.renderHandles();
    if (this.tooltipFor) this.positionTooltip(this.tooltipFor);
    if (this.menuBtnFor) this.positionMenuBtn(this.menuBtnFor);
  }

  getView() { return { ...this.view }; }

  setView(view, { silent } = {}) {
    this.view = normalizeView(view);
    this.apply();
    if (!silent) this.opts.onView(this.getView());
  }

  fit() { this.setView({ ...DEFAULT_VIEW }); }

  zoomBy(factor, sx, sy) {
    if (!this.scene) return;
    const { w, h: hh } = this.size();
    this.setView(zoomAt(this.view, this.scene.width, this.scene.height, w, hh, factor, sx ?? w / 2, sy ?? hh / 2));
  }

  setHints(on) {
    this.host.classList.toggle('pde-hints-off', !on);
  }

  setTool(tool) {
    this.tool = tool;
    this.host.dataset.tool = tool;
  }

  // ---- hotspot focus, selection, tooltip -------------------------------------

  hotspot(id) { return this.scene ? this.scene.hotspots.find((x) => x.id === id) : null; }

  hotspotEl(id) { return this.layer.querySelector(`.pde-hotspot[data-id="${CSS.escape(id)}"]`); }

  // Anchor for menus: the hotspot's right edge midpoint, in viewport coordinates.
  anchorOf(id) {
    const el = this.hotspotEl(id);
    const host = this.host.getBoundingClientRect();
    if (!el) return { x: host.width / 2, y: host.height / 2 };
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left - host.left + r.width / 2), y: Math.round(r.top - host.top + r.height / 2) };
  }

  select(id, { notify = true } = {}) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.layer.querySelectorAll('.pde-hotspot').forEach((el) => el.classList.toggle('is-selected', el.dataset.id === id));
    this.notes.querySelectorAll('.pde-annotation').forEach((el) => el.classList.toggle('is-selected', el.dataset.id === id));
    if (this.opts.mode === 'edit') this.renderHandles();
    if (notify) this.opts.onSelect(id);
  }

  focusHotspot(id, { quiet } = {}) {
    const el = this.hotspotEl(id);
    if (!el) return false;
    if (quiet) this.quietFocus = true;
    el.focus({ preventScroll: true });
    this.quietFocus = false;
    this.bound.scroll();
    return true;
  }

  focusEdge(which) {
    const els = [...this.layer.querySelectorAll('.pde-hotspot')];
    const el = which === 'last' ? els[els.length - 1] : els[0];
    if (el) el.focus({ preventScroll: true });
    return !!el;
  }

  onHotspotEnter(id) {
    if (this.gesture) return;
    clearTimeout(this.tooltipTimer);
    this.tooltipTimer = setTimeout(() => this.showTooltip(id), this.opts.tooltipDelayMs);
    if (this.opts.mode === 'present') this.showMenuBtn(id);
  }

  onHotspotLeave(id) {
    clearTimeout(this.tooltipTimer);
    if (this.tooltipFor === id && document.activeElement !== this.hotspotEl(id)) this.hideTooltip();
    this.scheduleMenuBtnHide();
  }

  onHotspotFocus(id) {
    if (this.opts.mode === 'present' || !this.quietFocus) this.select(id, { notify: true });
    if (!this.quietFocus) this.showTooltip(id);
    if (this.opts.mode === 'present') this.showMenuBtn(id);
  }

  onHotspotBlur(id) {
    if (this.tooltipFor === id) this.hideTooltip();
    this.scheduleMenuBtnHide();
  }

  showTooltip(id) {
    const hs = this.hotspot(id);
    if (!hs || !hs.tooltip) { this.hideTooltip(); return; }
    this.tooltip.textContent = hs.tooltip;
    this.tooltip.hidden = false;
    this.tooltipFor = id;
    this.positionTooltip(id);
  }

  hideTooltip() {
    clearTimeout(this.tooltipTimer);
    if (this.tooltip.hidden) return false;
    this.tooltip.hidden = true;
    this.tooltipFor = null;
    return true;
  }

  positionTooltip(id) {
    const el = this.hotspotEl(id);
    if (!el) return;
    const host = this.host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const tw = this.tooltip.offsetWidth;
    const th = this.tooltip.offsetHeight;
    let x = r.left - host.left;
    let y = r.bottom - host.top + 6;
    if (y + th > host.height - 4) y = r.top - host.top - th - 6;
    x = Math.max(4, Math.min(x, host.width - tw - 4));
    y = Math.max(4, Math.min(y, host.height - th - 4));
    this.tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  showMenuBtn(id) {
    clearTimeout(this.menuBtnTimer);
    const hs = this.hotspot(id);
    if (!hs) return;
    this.menuBtnFor = id;
    this.menuBtn.setAttribute('aria-label', `Actions for ${hs.label}`);
    this.menuBtn.title = `Actions for ${hs.label}`;
    this.menuBtn.hidden = false;
    this.positionMenuBtn(id);
  }

  scheduleMenuBtnHide() {
    clearTimeout(this.menuBtnTimer);
    this.menuBtnTimer = setTimeout(() => this.hideMenuBtn(), 400);
  }

  hideMenuBtn() {
    clearTimeout(this.menuBtnTimer);
    this.menuBtn.hidden = true;
    this.menuBtnFor = null;
  }

  positionMenuBtn(id) {
    const el = this.hotspotEl(id);
    if (!el) return;
    const host = this.host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const bw = this.menuBtn.offsetWidth || 28;
    const x = Math.max(2, Math.min(r.right - host.left - bw - 2, host.width - bw - 2));
    const y = Math.max(2, Math.min(r.top - host.top + 2, host.height - bw - 2));
    this.menuBtn.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  // ---- input ---------------------------------------------------------------

  local(e) {
    const r = this.host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  toImageNorm(p) {
    const q = screenToImage(this.transform(), p.x, p.y);
    return { x: q.x / this.scene.width, y: q.y / this.scene.height };
  }

  hitHotspotId(target) {
    const el = target && target.closest ? target.closest('.pde-hotspot') : null;
    return el && this.layer.contains(el) ? el.dataset.id : null;
  }

  onPointerDown(e) {
    if (!this.scene || e.target === this.menuBtn) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.gesture = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    if (this.pointers.size > 2) return;
    try { this.host.setPointerCapture(e.pointerId); } catch { /* element may be detached */ }
    // Edit gestures cancel the default action (so dragging does not select text),
    // which would also leave keyboard focus in whatever field was used last. Move it
    // to the canvas so Delete, Ctrl+D and the arrow keys act on the selection.
    if (this.opts.mode === 'edit' && !this.host.contains(document.activeElement) && this.host.tabIndex >= 0) this.host.focus({ preventScroll: true });
    const hotspotId = this.hitHotspotId(e.target);
    const handle = e.target.dataset ? e.target.dataset.handle : undefined;
    const noteEl = e.target.closest ? e.target.closest('.pde-annotation') : null;
    const g = { kind: 'pending', start: p, last: p, hotspotId, moved: false, pointerId: e.pointerId };
    if (this.spaceDown) g.kind = 'pan';
    else if (this.opts.mode === 'edit') {
      if (this.tool === 'hotspot') {
        g.kind = 'draw'; g.origin = this.toImageNorm(p);
      } else if (this.tool === 'annotation') {
        g.kind = 'place';
      } else if (handle && this.selectedId) {
        g.kind = 'resize'; g.handle = handle; g.rect0 = { ...this.hotspot(this.selectedId).rect }; g.origin = this.toImageNorm(p);
      } else if (hotspotId) {
        this.select(hotspotId);
        g.kind = 'move'; g.rect0 = { ...this.hotspot(hotspotId).rect }; g.origin = this.toImageNorm(p);
      } else if (noteEl) {
        const n = this.scene.annotations.find((x) => x.id === noteEl.dataset.id);
        this.select(n.id);
        g.kind = 'moveNote'; g.noteId = n.id; g.note0 = { x: n.x, y: n.y, width: n.width }; g.origin = this.toImageNorm(p);
      } else {
        this.select(null);
      }
    }
    this.gesture = g;
    if (g.kind === 'draw' || g.kind === 'move' || g.kind === 'resize' || g.kind === 'moveNote') e.preventDefault();
  }

  onPointerMove(e) {
    const g = this.gesture;
    if (!this.pointers.has(e.pointerId) || !g) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (g.kind === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.dist > 0 && d > 0) this.zoomBy(d / g.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      g.dist = d;
      return;
    }
    if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < DRAG_THRESHOLD) return;
    if (!g.moved) { g.moved = true; this.hideTooltip(); this.host.classList.add('is-dragging'); }
    const { w, h: hh } = this.size();
    if (g.kind === 'pending' || g.kind === 'pan') {
      g.kind = 'pan';
      this.view = panBy(this.view, this.scene.width, this.scene.height, w, hh, p.x - g.last.x, p.y - g.last.y);
      this.apply();
      g.last = p;
      return;
    }
    const q = this.toImageNorm(p);
    if (g.kind === 'draw') {
      g.rect = normRectFromPoints(g.origin, q);
      this.drawPreview(g.rect);
    } else if (g.kind === 'move') {
      g.rect = clampRect({ ...g.rect0, x: g.rect0.x + q.x - g.origin.x, y: g.rect0.y + q.y - g.origin.y });
      this.previewRect(this.selectedId, g.rect);
    } else if (g.kind === 'resize') {
      g.rect = resizeRect(g.rect0, g.handle, q.x - g.origin.x, q.y - g.origin.y);
      this.previewRect(this.selectedId, g.rect);
    } else if (g.kind === 'moveNote') {
      const x = Math.min(Math.max(0, g.note0.x + q.x - g.origin.x), 1 - g.note0.width);
      const y = Math.min(Math.max(0, g.note0.y + q.y - g.origin.y), 0.995);
      g.note = { x, y };
      const el = this.notes.querySelector(`.pde-annotation[data-id="${CSS.escape(g.noteId)}"]`);
      if (el) { el.style.left = `${x * this.scene.width}px`; el.style.top = `${y * this.scene.height}px`; }
    }
  }

  onPointerUp(e) {
    const g = this.gesture;
    const was = this.pointers.has(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!g || !was) return;
    if (g.kind === 'pinch') {
      if (this.pointers.size === 0) { this.gesture = null; this.opts.onView(this.getView()); }
      return;
    }
    this.gesture = null;
    this.host.classList.remove('is-dragging');
    const p = this.local(e);
    if (g.kind === 'pan') { this.opts.onView(this.getView()); return; }
    if (this.opts.mode === 'present') {
      if (!g.moved && g.hotspotId) {
        this.hideTooltip();
        this.select(g.hotspotId);
        this.opts.onActivate(g.hotspotId, 'default', { x: Math.round(p.x), y: Math.round(p.y) });
      }
      return;
    }
    // edit mode
    if (g.kind === 'draw') {
      this.clearPreview();
      if (g.rect && g.rect.width * this.scene.width >= 4 && g.rect.height * this.scene.height >= 4) {
        this.opts.onEdit('createHotspot', { rect: roundRect(clampRect(g.rect)) });
      }
    } else if (g.kind === 'place') {
      if (!g.moved) this.opts.onEdit('createAnnotation', { at: this.toImageNorm(p) });
    } else if ((g.kind === 'move' || g.kind === 'resize') && g.moved && g.rect) {
      this.opts.onEdit('setRect', { id: this.selectedId, rect: roundRect(g.rect) });
    } else if (g.kind === 'moveNote' && g.moved && g.note) {
      this.opts.onEdit('moveAnnotation', { id: g.noteId, x: Math.round(g.note.x * 1e6) / 1e6, y: Math.round(g.note.y * 1e6) / 1e6 });
    }
  }

  onPointerCancel(e) {
    this.pointers.delete(e.pointerId);
    if (this.gesture && this.gesture.kind !== 'pinch') {
      if (this.gesture.kind === 'draw') this.clearPreview();
      if (this.gesture.kind === 'move' || this.gesture.kind === 'resize' || this.gesture.kind === 'moveNote') this.renderContent();
    }
    if (this.pointers.size === 0) this.gesture = null;
    this.host.classList.remove('is-dragging');
  }

  previewRect(id, rect) {
    const el = this.hotspotEl(id);
    if (!el) return;
    const W = this.scene.width;
    const H = this.scene.height;
    el.setAttribute('x', rect.x * W); el.setAttribute('y', rect.y * H);
    el.setAttribute('width', rect.width * W); el.setAttribute('height', rect.height * H);
    const hs = this.hotspot(id);
    if (hs) { const saved = hs.rect; hs.rect = rect; this.renderHandles(); hs.rect = saved; }
  }

  drawPreview(rect) {
    let el = this.layer.querySelector('.pde-draw-preview');
    if (!el) { el = svg('rect', { class: 'pde-draw-preview', 'aria-hidden': 'true' }); this.layer.append(el); }
    el.setAttribute('x', rect.x * this.scene.width); el.setAttribute('y', rect.y * this.scene.height);
    el.setAttribute('width', rect.width * this.scene.width); el.setAttribute('height', rect.height * this.scene.height);
  }

  clearPreview() {
    const el = this.layer.querySelector('.pde-draw-preview');
    if (el) el.remove();
  }

  onWheel(e) {
    if (!this.scene) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const factor = 2 ** (-(e.deltaY * unit) / 300);
    const p = this.local(e);
    this.hideTooltip();
    this.zoomBy(factor, p.x, p.y);
  }

  onContextMenu(e) {
    const id = this.hitHotspotId(e.target);
    if (!id) return; // the browser's own menu everywhere else
    e.preventDefault();
    if (this.opts.mode === 'edit') { this.select(id); return; }
    this.hideTooltip();
    this.select(id);
    const p = this.local(e);
    this.opts.onActivate(id, 'menu', { x: Math.round(p.x), y: Math.round(p.y) });
  }

  onKeyDown(e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const id = this.hitHotspotId(e.target);
    if (e.key === ' ' && !id) { this.spaceDown = true; e.preventDefault(); return; }
    if (id && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      this.hideTooltip();
      if (this.opts.mode === 'present') this.opts.onActivate(id, 'default', this.anchorOf(id));
      return;
    }
    if (id && ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu')) {
      e.preventDefault();
      this.hideTooltip();
      if (this.opts.mode === 'present') this.opts.onActivate(id, 'menu', this.anchorOf(id));
      return;
    }
    if (e.key === 'Escape') {
      if (this.hideTooltip()) { e.preventDefault(); e.stopPropagation(); return; }
      this.opts.onKey('Escape', e);
      return;
    }
    if (this.opts.mode === 'edit' && this.selectedId && this.hotspot(this.selectedId) && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1);
      const hs = this.hotspot(this.selectedId);
      const dx = (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0) / this.scene.width;
      const dy = (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0) / this.scene.height;
      this.opts.onEdit('setRect', { id: hs.id, rect: roundRect(clampRect({ ...hs.rect, x: hs.rect.x + dx, y: hs.rect.y + dy })), coalesce: `nudge:${hs.id}` });
      return;
    }
    if (this.opts.mode === 'present' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); this.opts.onKey('Next', e); return; }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); this.opts.onKey('Previous', e); return; }
    }
    if (e.key === 'Backspace' && this.opts.mode === 'present') { e.preventDefault(); this.opts.onKey('Back', e); return; }
    if (e.key === 'ArrowLeft' && e.altKey) { e.preventDefault(); this.opts.onKey('Back', e); return; }
    if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); this.zoomBy(1.25); return; }
    if (e.key === '-' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); this.zoomBy(0.8); return; }
    if (e.key === '0' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); this.fit(); }
  }

  announce(text) {
    this.status.textContent = '';
    setTimeout(() => { this.status.textContent = text; }, 30);
  }

  destroy() {
    clearTimeout(this.tooltipTimer);
    clearTimeout(this.menuBtnTimer);
    this.resizeObs.disconnect();
    window.removeEventListener('blur', this.bound.blur);
    this.host.removeEventListener('pointerdown', this.bound.down);
    this.host.removeEventListener('pointermove', this.bound.move);
    this.host.removeEventListener('pointerup', this.bound.up);
    this.host.removeEventListener('pointercancel', this.bound.cancel);
    this.host.removeEventListener('wheel', this.bound.wheel);
    this.host.removeEventListener('contextmenu', this.bound.context);
    this.host.removeEventListener('keydown', this.bound.keydown);
    this.host.removeEventListener('keyup', this.bound.keyup);
    this.host.removeEventListener('scroll', this.bound.scroll);
    this.img.removeAttribute('src');
    clear(this.host);
  }
}

// Resize a normalized rect by dragging one of its eight handles.
export function resizeRect(r, handle, dx, dy) {
  let x0 = r.x; let y0 = r.y; let x1 = r.x + r.width; let y1 = r.y + r.height;
  if (handle.includes('w')) x0 += dx;
  if (handle.includes('e')) x1 += dx;
  if (handle.includes('n')) y0 += dy;
  if (handle.includes('s')) y1 += dy;
  return clampRect(normRectFromPoints({ x: x0, y: y0 }, { x: x1, y: y1 }));
}
