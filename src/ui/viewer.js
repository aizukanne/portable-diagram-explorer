// The presentation shell (spec §4 "Present a project", §5, §6, §11; design D17,
// D18, D21). The parent owns everything that decides: navigation history,
// breadcrumbs, menus, details and focus. The root diagram renders directly; every
// drill-down level renders in the one reusable sandboxed frame.
import { h, button, clear } from './dom.js';
import { SceneRenderer } from './renderer.js';
import { FrameBridge } from './bridge.js';
import { InPageScene } from './inpage-scene.js';
import { hostNonce } from './build-info.js';
import { ComponentMenu } from './menu.js';
import { NavStack, HISTORY_CAP } from '../core/navigation.js';
import { SlideCursor } from '../core/slides.js';

const DEFAULT_SETTINGS = { tooltipDelayMs: 350, showHotspotHints: true };

// The host-viewer notice (spec section 5.3). Shown when this page is inside another
// site's viewer; the second sentence is added once drill-downs had to fall back to
// rendering in the page.
const NOTICE_BASE = 'This presentation is being shown inside another site, which limits what it can do. For the full experience, download the file and open it in your browser.';
const NOTICE_FALLBACK = 'Drill-down diagrams are being shown with reduced isolation.';
const LOADING_TEXT = 'Loading diagram…';

// Inside another page's frame? Reading win.top can throw across origins, and a throw
// means we are hosted.
export function isHostedWindow(win) {
  try { return win.top !== win.self; } catch { return true; }
}

// The one decision about the notice: its text, or '' for none. The editor's own
// preview (embedded) never shows it. If the fallback happened while not hosted, the
// base sentence would be false, so only the isolation sentence shows.
export function hostNoticeText({ embedded, hosted, fallback }) {
  if (embedded) return '';
  return [hosted ? NOTICE_BASE : '', fallback ? NOTICE_FALLBACK : ''].filter(Boolean).join(' ');
}

export function sceneOf(project, diagram) {
  const asset = project.assets.find((a) => a.id === diagram.assetId);
  return {
    title: diagram.title,
    width: asset.width,
    height: asset.height,
    hotspots: diagram.hotspots.map((x) => ({
      id: x.id, label: x.label, tooltip: x.tooltip, rect: { ...x.rect }, zIndex: x.zIndex,
      hasMenu: !x.defaultActionId && !(x.actions.length === 1 && x.actions[0].type === 'details'),
    })),
    annotations: diagram.annotations.map((n) => ({ id: n.id, text: n.text, x: n.x, y: n.y, width: n.width })),
  };
}

// A side panel: shows either the components list or a details text.
class SidePanel {
  constructor(viewer, ctx) {
    this.viewer = viewer;
    this.ctx = ctx;
    this.heading = h('h2', { class: 'pde-side-title', id: `pde-side-${ctx}-title` });
    this.body = h('div', { class: 'pde-side-body' });
    this.closeBtn = button('Close panel', () => this.close({ focusBack: true }), { cls: 'pde-side-close', icon: '✕', iconOnly: true });
    this.el = h('aside', { class: 'pde-side', hidden: true, 'aria-labelledby': this.heading.id },
      h('div', { class: 'pde-side-head' }, this.heading, this.closeBtn), this.body);
    this.state = null; // null | { kind: 'details', hotspotId, actionId } | { kind: 'about' } | { kind: 'list' }
  }

  get isOpen() { return !this.el.hidden; }

  showDetails(diagram, state) {
    let title = '';
    let text = '';
    if (state.kind === 'about') {
      title = diagram.title;
      text = diagram.description || 'No description.';
    } else {
      const hs = diagram.hotspots.find((x) => x.id === state.hotspotId);
      const action = hs && hs.actions.find((a) => a.id === state.actionId);
      if (!hs || !action) return;
      title = `${hs.label}: ${action.label}`;
      text = action.text;
    }
    this.state = { ...state };
    this.heading.textContent = title;
    clear(this.body).append(h('p', { class: 'pde-details-text', text }));
    this.el.hidden = false;
    this.el.classList.remove('is-list');
    this.viewer.syncToggles();
  }

  showList(diagram) {
    this.state = { kind: 'list' };
    this.heading.textContent = 'Components';
    clear(this.body);
    const items = [...diagram.hotspots].sort((a, b) => (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x));
    if (!items.length) this.body.append(h('p', { class: 'pde-muted', text: 'This diagram has no clickable components.' }));
    const list = h('ul', { class: 'pde-component-list' });
    for (const hs of items) {
      list.append(h('li', {},
        button(hs.label, (e) => this.viewer.activate(this.ctx, hs.id, 'default', anchorFrom(e.currentTarget)), { cls: 'pde-component', title: hs.tooltip || undefined }),
        button(`Actions for ${hs.label}`, (e) => this.viewer.activate(this.ctx, hs.id, 'menu', anchorFrom(e.currentTarget)), { cls: 'pde-component-menu', icon: '⋯', iconOnly: true })));
    }
    this.body.append(list);
    this.el.hidden = false;
    this.el.classList.add('is-list');
    this.viewer.syncToggles();
  }

  close({ focusBack } = {}) {
    if (this.el.hidden) return false;
    const was = this.state;
    this.el.hidden = true;
    this.state = null;
    this.viewer.syncToggles();
    if (focusBack) this.viewer.focusContext(this.ctx, was && was.hotspotId);
    return true;
  }

  detailsState() {
    return this.state && this.state.kind !== 'list' ? { ...this.state } : null;
  }
}

function anchorFrom(el) {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.right - 8), y: Math.round(r.top + r.height / 2) };
}

export class Viewer {
  constructor(root, project, assets, { embedded = false, onExit = null } = {}) {
    this.root = root;
    this.project = project;
    this.assets = assets;
    this.embedded = embedded;
    this.onExit = onExit;
    this.settings = { ...DEFAULT_SETTINGS, ...(project.settings || {}) };
    this.byId = new Map(project.diagrams.map((d) => [d.id, d]));
    this.nav = new NavStack(HISTORY_CAP);
    this.bridge = null;
    this.fallback = false; // once the frame has failed to start, drill-downs render in the page for the session
    this.notice = null;
    this.noticeDismissed = false;
    this.modalView = null;
    this.modalSelected = null;
    this.originHotspotId = null;
    // The running order (spec §3): null when the project has no sequence, and then
    // no slide control is built at all.
    this.slides = project.sequence ? new SlideCursor(project.sequence.slides, project.rootDiagramId) : null;
    this.pageDiagramId = project.rootDiagramId;
    this.build();
    this.showSlide(this.pageDiagramId);
    this.syncSlidebar();
    if (this.isHosted()) this.syncNotice();
  }

  // ---- host notice ---------------------------------------------------------

  isHosted() { return !this.embedded && isHostedWindow(window); }

  // Build, update or remove the notice from the current state. `revive` shows it even
  // if the user dismissed it (the isolation state changed, so they should know).
  syncNotice({ revive = false } = {}) {
    const text = hostNoticeText({ embedded: this.embedded, hosted: isHostedWindow(window), fallback: this.fallback });
    if (!text) return;
    if (revive) this.noticeDismissed = false;
    if (this.noticeDismissed) return;
    if (!this.notice) {
      this.noticeText = h('p', { class: 'pde-host-notice-text' });
      this.notice = h('div', { class: 'pde-host-notice', role: 'status' }, this.noticeText,
        button('Dismiss', () => this.dismissNotice(), { cls: 'pde-link' }));
    }
    this.noticeText.textContent = text;
    this.placeNotice();
  }

  // One notice, kept where it can be seen: inside the drill-down dialog while that is
  // open (the dialog's backdrop covers the page), after the toolbar otherwise.
  placeNotice() {
    if (!this.notice) return;
    if (this.nav.isOpen) this.modalHead.after(this.notice); else this.toolbar.after(this.notice);
  }

  showLoading() {
    this.loading.textContent = LOADING_TEXT;
    this.loading.hidden = false;
  }

  hideLoading() { this.loading.hidden = true; }

  showHostNotice() { this.syncNotice({ revive: true }); }

  dismissNotice() {
    this.noticeDismissed = true;
    if (this.notice) this.notice.remove();
    this.notice = null;
    // The focused button is gone; keep focus somewhere sensible.
    this.app.querySelector('h1.pde-project-title').focus();
  }

  // ---- layout --------------------------------------------------------------

  build() {
    const p = this.project;
    const fsOk = !!(document.fullscreenEnabled && document.documentElement.requestFullscreen);
    this.hintsBtn = button('Hotspot hints', () => this.toggleHints(), { cls: 'pde-toggle', icon: '▢', attrs: { 'aria-pressed': String(this.settings.showHotspotHints) } });
    this.rootListBtn = button('Components', () => this.togglePanel('root', 'list'), { icon: '☰', attrs: { 'aria-expanded': 'false' } });
    this.rootAboutBtn = button('About this diagram', () => this.togglePanel('root', 'about'), { icon: 'ⓘ', attrs: { 'aria-expanded': 'false' } });
    this.fsBtn = fsOk ? button('Full screen', () => this.toggleFullscreen(), { icon: '⛶' }) : null;
    this.homeBtn = this.slides ? button('Home', () => this.goHome(), { icon: '⌂', title: 'Show the overview' }) : null;
    this.rootTitle = h('span', { class: 'pde-crumb-current', 'aria-current': 'page' });
    this.toolbar = h('header', { class: 'pde-toolbar' },
      h('h1', { class: 'pde-project-title', tabindex: '-1', text: p.title }),
      h('nav', { class: 'pde-crumbs', 'aria-label': 'Location' }, h('ol', {}, h('li', {}, this.rootTitle))),
      h('div', { class: 'pde-tools' },
        this.homeBtn,
        this.rootListBtn, this.rootAboutBtn,
        h('span', { class: 'pde-sep', 'aria-hidden': 'true' }),
        button('Zoom out', () => this.rootRenderer.zoomBy(0.8), { icon: '−', iconOnly: true }),
        button('Fit', () => this.rootRenderer.fit(), { icon: '⤢' }),
        button('Zoom in', () => this.rootRenderer.zoomBy(1.25), { icon: '+', iconOnly: true }),
        h('span', { class: 'pde-sep', 'aria-hidden': 'true' }),
        this.hintsBtn, this.fsBtn,
        this.embedded && this.onExit ? button('Exit preview', () => this.onExit(), { cls: 'pde-primary', icon: '✕' }) : null));
    this.rootHost = h('div', { class: 'pde-root-view' });
    this.rootPanel = new SidePanel(this, 'root');
    this.stage = h('main', { class: 'pde-stage' }, this.rootHost, this.rootPanel.el);
    this.rootRenderer = new SceneRenderer(this.rootHost, {
      mode: 'present',
      slideKeys: this.slides ? 'intercept' : false,
      onSwipe: this.slides ? (dir) => (dir === 'next' ? this.nextSlide() : this.previousSlide()) : undefined,
      tooltipDelayMs: this.settings.tooltipDelayMs,
      showHints: this.settings.showHotspotHints,
      onActivate: (id, mode, anchor) => {
        const r = this.rootHost.getBoundingClientRect();
        this.activate('root', id, mode, { x: r.left + anchor.x, y: r.top + anchor.y });
      },
      onKey: (key) => this.onKey(key),
    });

    this.slidebar = this.slides ? this.buildSlidebar() : null;

    // Modal
    this.modalTitle = h('h2', { class: 'pde-modal-title', id: 'pde-modal-title', tabindex: '-1' });
    this.crumbs = h('ol', {});
    this.backBtn = button('Back', () => this.back(), { icon: '←' });
    this.modalListBtn = button('Components', () => this.togglePanel('modal', 'list'), { icon: '☰', attrs: { 'aria-expanded': 'false' } });
    this.modalAboutBtn = button('About this diagram', () => this.togglePanel('modal', 'about'), { icon: 'ⓘ', attrs: { 'aria-expanded': 'false' } });
    this.frameHost = h('div', { class: 'pde-frame-host' });
    this.loading = h('div', { class: 'pde-loading', role: 'status', hidden: true });
    this.modalPanel = new SidePanel(this, 'modal');
    const sentinel = (where) => h('span', { class: 'pde-sentinel', tabindex: '0', 'aria-hidden': 'true', on: { focus: () => this.wrapFocus(where) } });
    this.modal = h('div', { class: 'pde-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pde-modal-title' },
      sentinel('start'),
      (this.modalHead = h('div', { class: 'pde-modal-head' },
        h('div', { class: 'pde-modal-nav' }, this.backBtn,
          h('nav', { class: 'pde-crumbs', 'aria-label': 'Breadcrumbs' }, this.crumbs)),
        this.modalTitle,
        h('div', { class: 'pde-tools' },
          this.modalListBtn, this.modalAboutBtn,
          h('span', { class: 'pde-sep', 'aria-hidden': 'true' }),
          button('Zoom out', () => this.bridge.command('zoomOut'), { icon: '−', iconOnly: true }),
          button('Fit', () => this.bridge.command('fit'), { icon: '⤢' }),
          button('Zoom in', () => this.bridge.command('zoomIn'), { icon: '+', iconOnly: true }),
          h('span', { class: 'pde-sep', 'aria-hidden': 'true' }),
          (this.overviewBtn = button('Overview', () => this.closeModal(), { icon: '⌂' })),
          button('Close', () => this.closeModal(), { cls: 'pde-primary', icon: '✕' })))),
      h('div', { class: 'pde-modal-body' }, this.frameHost, this.modalPanel.el, this.loading),
      sentinel('end'));
    this.modalLayer = h('div', { class: 'pde-modal-layer', hidden: true }, h('div', { class: 'pde-backdrop' }), this.modal);
    this.live = h('div', { class: 'pde-sr-only', role: 'status', 'aria-live': 'polite' });
    this.overlay = h('div', { class: 'pde-overlay-layer' });
    this.app = h('div', { class: ['pde-app', 'pde-viewer', this.embedded && 'pde-embedded'] },
      this.toolbar, this.stage, this.slidebar, this.modalLayer, this.overlay, this.live);
    this.menu = new ComponentMenu(this.overlay);
    this.root.append(this.app);

    this.onDocKey = (e) => this.onDocumentKey(e);
    document.addEventListener('keydown', this.onDocKey);
    this.onFs = () => this.syncFullscreen();
    document.addEventListener('fullscreenchange', this.onFs);
  }

  // ---- root ----------------------------------------------------------------

  // The project overview; the diagram shown on the page is pageDiagram().
  rootDiagram() { return this.byId.get(this.project.rootDiagramId); }
  pageDiagram() { return this.byId.get(this.pageDiagramId); }

  showSlide(diagramId) {
    this.pageDiagramId = diagramId;
    const d = this.pageDiagram();
    this.rootTitle.textContent = d.title;
    this.rootAboutBtn.hidden = !d.description;
    this.rootPanel.close();
    return this.rootRenderer.setScene(sceneOf(this.project, d), this.assets.url(d.assetId)).catch((e) => this.announce(e.message));
  }

  // ---- slides --------------------------------------------------------------

  buildSlidebar() {
    this.prevBtn = button('Previous', () => this.previousSlide(), { icon: '◀' });
    this.nextBtn = button('Next', () => this.nextSlide(), { icon: '▶' });
    this.slideCount = h('span', { class: 'pde-slide-count' });
    this.lastSlide = h('span', { class: 'pde-last-slide', hidden: true, text: 'Last slide' });
    this.slidesBtn = button('Slides', () => this.openSlidesMenu(), { icon: '☰', attrs: { 'aria-haspopup': 'menu' } });
    return h('div', { class: 'pde-slidebar', role: 'group', 'aria-label': 'Slides' },
      this.prevBtn, this.slideCount, this.nextBtn, this.slidesBtn, this.lastSlide);
  }

  slideTitle(id) { return this.byId.get(id).title; }

  syncSlidebar() {
    const c = this.slides;
    if (!c) return;
    this.prevBtn.disabled = !c.hasPrevious;
    this.nextBtn.disabled = !c.hasNext;
    this.slideCount.textContent = c.label();
    this.lastSlide.hidden = !c.isLast;
    const title = this.pageDiagram().title;
    this.rootTitle.textContent = c.index === null ? title : `Slide ${c.index + 1} of ${c.count} › ${title}`;
    this.overviewBtn.querySelector('.pde-btn-label').textContent = this.pageDiagramId !== this.project.rootDiagramId ? 'Back to slide' : 'Overview';
  }

  // Moving between slides never leaves a drill-down behind it.
  stepSlide(dir) {
    if (!this.slides || this.menu.isOpen || this.capDialog) return;
    // At either end the key does nothing: decide before closing a drill-down.
    if (!(dir > 0 ? this.slides.hasNext : this.slides.hasPrevious)) return;
    if (this.nav.isOpen) this.finishClose(this.nav.close(), { restoreFocus: false });
    const id = dir > 0 ? this.slides.next() : this.slides.previous();
    if (!id) return;
    this.showSlide(id);
    this.syncSlidebar();
    this.app.querySelector('h1.pde-project-title').focus();
    this.announce(`Slide ${this.slides.label()}: ${this.slideTitle(id)}`);
  }

  nextSlide() { this.stepSlide(1); }
  previousSlide() { this.stepSlide(-1); }

  goHome() {
    if (!this.slides || this.menu.isOpen || this.capDialog) return;
    if (this.nav.isOpen) this.finishClose(this.nav.close(), { restoreFocus: false });
    this.slides.home();
    this.showSlide(this.project.rootDiagramId);
    this.syncSlidebar();
    this.announce(`Overview: ${this.slideTitle(this.project.rootDiagramId)}`);
  }

  openSlidesMenu() {
    const r = this.slidesBtn.getBoundingClientRect();
    this.menu.open({
      title: 'Slides',
      anchor: { x: Math.round(r.left), y: window.innerHeight }, // the menu clamps itself above the bottom edge
      items: this.project.sequence.slides.map((id, i) => ({
        label: `${i + 1}. ${this.slideTitle(id)}`,
        current: this.slides.index === i,
        onSelect: () => this.jumpToSlide(i),
      })),
      onClose: ({ restoreFocus }) => { if (restoreFocus) this.slidesBtn.focus(); },
    });
  }

  jumpToSlide(i) {
    if (this.nav.isOpen) this.finishClose(this.nav.close(), { restoreFocus: false });
    const id = this.slides.jump(i);
    if (!id) return;
    this.showSlide(id);
    this.syncSlidebar();
    this.app.querySelector('h1.pde-project-title').focus();
    this.announce(`Slide ${this.slides.label()}: ${this.slideTitle(id)}`);
  }

  // ---- context helpers -----------------------------------------------------

  contextDiagram(ctx) {
    if (ctx === 'root') return this.pageDiagram();
    const cur = this.nav.current();
    return cur ? this.byId.get(cur.diagramId) : null;
  }

  panel(ctx) { return ctx === 'root' ? this.rootPanel : this.modalPanel; }

  togglePanel(ctx, kind) {
    const panel = this.panel(ctx);
    const d = this.contextDiagram(ctx);
    if (panel.isOpen && ((kind === 'list' && panel.state.kind === 'list') || (kind === 'about' && panel.state.kind === 'about'))) {
      panel.close();
      return;
    }
    if (kind === 'list') panel.showList(d); else panel.showDetails(d, { kind: 'about' });
    const first = panel.el.querySelector('button.pde-component') || panel.closeBtn;
    if (kind === 'list' && first) first.focus();
  }

  syncToggles() {
    const set = (btn, panel, kind) => btn.setAttribute('aria-expanded', String(panel.isOpen && panel.state && panel.state.kind === kind));
    set(this.rootListBtn, this.rootPanel, 'list');
    set(this.rootAboutBtn, this.rootPanel, 'about');
    set(this.modalListBtn, this.modalPanel, 'list');
    set(this.modalAboutBtn, this.modalPanel, 'about');
  }

  focusContext(ctx, hotspotId) {
    if (ctx === 'root') {
      if (!(hotspotId && this.rootRenderer.focusHotspot(hotspotId))) this.rootRenderer.focusEdge('first');
    } else if (this.bridge) {
      if (hotspotId) this.bridge.focusHotspot(hotspotId); else this.bridge.focus('first');
    }
  }

  announce(text) {
    this.live.textContent = '';
    setTimeout(() => { this.live.textContent = text; }, 30);
  }

  // ---- activation ----------------------------------------------------------

  activate(ctx, hotspotId, mode, anchor) {
    if (ctx === 'modal' && !this.nav.isOpen) return;
    const d = this.contextDiagram(ctx);
    const hs = d && d.hotspots.find((x) => x.id === hotspotId);
    if (!hs) return;
    if (ctx === 'root') this.rootRenderer.select(hotspotId, { notify: false });
    if (mode === 'menu') { this.openMenu(ctx, hs, anchor); return; }
    const def = hs.defaultActionId ? hs.actions.find((a) => a.id === hs.defaultActionId) : null;
    if (def) this.runAction(ctx, hs, def);
    else if (hs.actions.length === 1 && hs.actions[0].type === 'details') this.runAction(ctx, hs, hs.actions[0]);
    else this.openMenu(ctx, hs, anchor);
  }

  openMenu(ctx, hs, anchor) {
    this.menu.open({
      title: hs.label,
      anchor,
      items: hs.actions.map((a) => ({ label: a.label, onSelect: () => this.runAction(ctx, hs, a) })),
      onClose: ({ restoreFocus }) => { if (restoreFocus) this.focusContext(ctx, hs.id); },
    });
  }

  runAction(ctx, hs, action) {
    if (action.type === 'details') {
      this.panel(ctx).showDetails(this.contextDiagram(ctx), { kind: 'details', hotspotId: hs.id, actionId: action.id });
      this.panel(ctx).closeBtn.focus();
      return;
    }
    if (action.type === 'diagram' && this.byId.has(action.targetDiagramId)) this.navigate(ctx, hs, action.targetDiagramId);
  }

  // ---- navigation ----------------------------------------------------------

  rootState() {
    return { viewport: this.rootRenderer.getView(), selectedHotspotId: this.rootRenderer.selectedId || null, details: this.rootPanel.detailsState() };
  }

  modalState() {
    return { viewport: this.modalView, selectedHotspotId: this.modalSelected, details: this.modalPanel.detailsState() };
  }

  navigate(ctx, hs, targetId) {
    if (ctx === 'root') {
      this.originHotspotId = hs.id;
      this.nav.open(targetId, this.rootState());
      this.openModal();
    } else {
      const r = this.nav.push(targetId, { ...this.modalState(), selectedHotspotId: hs.id });
      if (!r.ok) { this.showCapDialog(); return; }
      // Going deeper from a key or click inside the frame: the frame keeps focus.
      if (this.focusInBridge()) { this.renderCurrent({}); return; }
    }
    this.renderCurrent({ focus: 'open' });
  }

  bridgeHandlers() {
    return {
      onActivate: (id, mode, anchor) => this.activate('modal', id, mode, anchor),
      onView: (v, sel) => { this.modalView = v; this.modalSelected = sel; },
      onKey: (key) => this.onKey(key),
    };
  }

  // Focus is "in the frame" when the iframe holds it, or (fallback) something inside
  // the in-page scene does.
  focusInBridge() {
    const f = this.bridge && this.bridge.frame;
    return !!f && (document.activeElement === f || (f.tagName !== 'IFRAME' && f.contains(document.activeElement)));
  }

  // The sandboxed frame did not send READY in time (a host page whose policy refuses its
  // inline script, or any other reason). Render drill-downs in the page from now on,
  // replay what was being shown, and say so. There is no way back within the session.
  onFrameStartFailed() {
    if (this.fallback) return;
    this.fallback = true;
    // Destroying the frame drops focus to the page; if it was in the frame (or nowhere),
    // put it back on the dialog heading, as when a diagram opens.
    const lostFocus = this.focusInBridge() || !document.activeElement || document.activeElement === document.body;
    if (this.bridge) this.bridge.destroy();
    this.bridge = new InPageScene(this.frameHost, this.bridgeHandlers());
    this.hideLoading();
    this.showHostNotice();
    if (this.nav.isOpen) {
      if (lostFocus) this.modalTitle.focus();
      this.renderCurrent({});
    }
  }

  openModal() {
    if (!this.bridge) {
      this.bridge = new FrameBridge(this.frameHost, {
        ...this.bridgeHandlers(),
        nonce: hostNonce(),
        onStartFailed: () => this.onFrameStartFailed(),
      });
    }
    this.toolbar.inert = true;
    this.stage.inert = true;
    if (this.slidebar) this.slidebar.inert = true;
    this.rootRenderer.hideTooltip();
    this.modalLayer.hidden = false;
    this.placeNotice();
  }

  renderCurrent({ focus } = {}) {
    const entry = this.nav.current();
    const d = this.byId.get(entry.diagramId);
    this.modalTitle.textContent = d.title;
    this.bridge.setTitle(`Diagram: ${d.title}`);
    this.modalAboutBtn.hidden = !d.description;
    this.modalView = entry.viewport;
    this.modalSelected = entry.selectedHotspotId;
    this.renderCrumbs();
    this.modalPanel.close();
    if (entry.details) this.modalPanel.showDetails(d, entry.details);
    const level = this.nav.breadcrumbs().length;
    this.announce(`${d.title}, level ${level + 1}`);
    // Focus policy (the same in every engine): opening moves focus to the dialog's
    // heading, which announces the diagram; Back and breadcrumbs keep focus on the
    // control the user pressed. When navigation came from a key inside the frame,
    // the frame restores focus itself (it already holds window focus).
    if (focus === 'open') this.modalTitle.focus();
    else if (focus === 'restore' && (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected)) this.backBtn.focus();
    // While the frame has not started, the dialog would be blank: say so (visibly and to
    // screen readers) until the scene is shown or the in-page fallback takes over.
    if (!this.bridge.ready) this.showLoading();
    return this.bridge.render(sceneOf(this.project, d), this.assets.dataUrl(d.assetId), entry.viewport, entry.selectedHotspotId, { ...this.settings })
      .then((r) => { if (!(r && r.superseded)) this.hideLoading(); })
      .catch((e) => {
        if (e && e.startFailed) return; // the fallback replays this render
        this.hideLoading();
        this.announce(e.message);
      });
  }

  renderCrumbs() {
    clear(this.crumbs);
    const trail = this.nav.breadcrumbs();
    this.crumbs.append(h('li', {}, button(this.pageCrumbLabel(), () => this.closeModal(), { cls: 'pde-crumb', title: this.pageDiagramId === this.project.rootDiagramId ? 'Return to the overview' : 'Return to the slide' })));
    trail.forEach((c, i) => {
      const d = this.byId.get(c.diagramId);
      const last = i === trail.length - 1;
      this.crumbs.append(h('li', {}, last
        ? h('span', { class: 'pde-crumb-current', 'aria-current': 'page', text: d.title })
        : button(d.title, () => { this.backBtn.focus(); this.jump(c.visitId); }, { cls: 'pde-crumb' })));
    });
    const lastEl = this.crumbs.lastElementChild;
    if (lastEl && lastEl.scrollIntoView) lastEl.scrollIntoView({ block: 'nearest', inline: 'end' });
  }

  pageCrumbLabel() {
    const c = this.slides;
    const t = this.pageDiagram().title;
    return c && c.index !== null ? `Slide ${c.index + 1} of ${c.count} › ${t}` : t;
  }

  back() {
    if (!this.nav.isOpen) return;
    const r = this.nav.back();
    if (r.closed) this.finishClose(r.entry);
    else this.renderCurrent({ focus: 'restore' });
  }

  jump(visitId) {
    if (this.nav.jump(visitId)) this.renderCurrent({ focus: 'restore' });
  }

  closeModal() {
    if (!this.nav.isOpen) return;
    this.finishClose(this.nav.close());
  }

  finishClose(overview, { restoreFocus = true } = {}) {
    this.menu.close({ restoreFocus: false });
    this.closeCapDialog();
    this.modalPanel.close();
    this.toolbar.inert = false;
    this.stage.inert = false;
    if (this.slidebar) this.slidebar.inert = false;
    if (overview && restoreFocus) {
      this.rootRenderer.setView(overview.viewport, { silent: true });
      if (overview.details) this.rootPanel.showDetails(this.pageDiagram(), overview.details);
    }
    // Take window focus back from the frame, and focus the originating hotspot
    // while the frame is still shown: hiding a focused frame first leaves focus on
    // nothing in some engines (measured in Firefox).
    window.focus();
    const focusId = this.originHotspotId || (overview && overview.selectedHotspotId);
    this.originHotspotId = null;
    if (restoreFocus && !(focusId && this.rootRenderer.focusHotspot(focusId, { quiet: true }))) this.rootRenderer.focusEdge('first');
    this.modalLayer.hidden = true;
    this.placeNotice();
    if (restoreFocus) this.announce(this.pageDiagramId === this.project.rootDiagramId ? 'Overview' : `Slide: ${this.pageDiagram().title}`);
  }

  showCapDialog() {
    this.closeCapDialog();
    const trail = this.nav.breadcrumbs();
    const list = h('ul', { class: 'pde-cap-list' }, trail.slice(0, -1).reverse().slice(0, 12).map((c) =>
      h('li', {}, button(this.byId.get(c.diagramId).title, () => { this.closeCapDialog(); this.jump(c.visitId); }, { cls: 'pde-crumb' }))));
    const title = h('h2', { id: 'pde-cap-title', text: 'History limit reached' });
    this.capDialog = h('div', { class: 'pde-cap', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'pde-cap-title', 'aria-describedby': 'pde-cap-text' },
      title,
      h('p', { id: 'pde-cap-text', text: `You have opened ${HISTORY_CAP} diagrams in a row. To keep navigation responsive, return to an earlier diagram or start again from the overview.` }),
      h('p', { class: 'pde-muted', text: 'Return to:' }), list,
      h('div', { class: 'pde-cap-actions' },
        button('Reset to overview', () => { this.closeCapDialog(); this.closeModal(); }, { cls: 'pde-primary' }),
        button('Stay here', () => this.closeCapDialog())));
    this.overlay.append(this.capDialog);
    this.capDialog.querySelector('button').focus();
  }

  closeCapDialog() {
    if (!this.capDialog) return false;
    this.capDialog.remove();
    this.capDialog = null;
    if (this.nav.isOpen) this.backBtn.focus();
    return true;
  }

  wrapFocus(where) {
    const focusables = [...this.modal.querySelectorAll('button:not([disabled]):not([hidden]), iframe, .pde-inpage-scene')]
      .filter((el) => el.offsetParent !== null || el.tagName === 'IFRAME');
    if (!focusables.length) return;
    if (where === 'start') {
      const last = focusables[focusables.length - 1];
      if (this.bridge && last === this.bridge.frame) this.bridge.focus('last'); else last.focus();
    } else {
      focusables[0].focus();
    }
  }

  // ---- keys ----------------------------------------------------------------

  // Escape order (design D18): menu, then dialog, then details panel, then modal.
  escape() {
    if (this.menu.close({ restoreFocus: true })) return;
    if (this.closeCapDialog()) return;
    const ctx = this.nav.isOpen ? 'modal' : 'root';
    if (this.panel(ctx).close({ focusBack: true })) return;
    if (this.nav.isOpen) this.closeModal();
  }

  onKey(key) {
    if (key === 'Escape') this.escape();
    else if (key === 'Back') this.back();
    else if (key === 'Next') this.nextSlide();
    else if (key === 'Previous') this.previousSlide();
  }

  // Arrow keys already mean something inside a menu or on a slider-like control.
  inControl(el) { return !!(el && el.closest && el.closest('[role=menu], [role=slider], [role=listbox]')); }

  onDocumentKey(e) {
    if (e.defaultPrevented) return;
    const typing = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key === 'Escape') {
      if (this.rootHost.contains(e.target)) return; // the renderer forwards it after its tooltip
      e.preventDefault();
      this.escape();
      return;
    }
    if (this.slides && !typing && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !this.menu.isOpen && !this.capDialog) {
      const next = e.key === 'ArrowRight' || e.key === 'PageDown';
      const prev = e.key === 'ArrowLeft' || e.key === 'PageUp';
      if ((next || prev) && !this.inControl(e.target)) {
        e.preventDefault();
        if (next) this.nextSlide(); else this.previousSlide();
        return;
      }
    }
    if (!this.nav.isOpen || typing) return;
    if ((e.key === 'Backspace' && !this.menu.isOpen) || (e.key === 'ArrowLeft' && e.altKey)) {
      e.preventDefault();
      this.back();
    }
  }

  // ---- toggles -------------------------------------------------------------

  toggleHints() {
    this.settings.showHotspotHints = !this.settings.showHotspotHints;
    this.hintsBtn.setAttribute('aria-pressed', String(this.settings.showHotspotHints));
    this.rootRenderer.setHints(this.settings.showHotspotHints);
    if (this.nav.isOpen) {
      this.nav.updateCurrent(this.modalState());
      this.renderCurrent({});
    }
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch((e) => this.announce(`Full screen is not available: ${e.message}`));
  }

  syncFullscreen() {
    if (!this.fsBtn) return;
    this.fsBtn.querySelector('.pde-btn-label').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  }

  destroy() {
    document.removeEventListener('keydown', this.onDocKey);
    document.removeEventListener('fullscreenchange', this.onFs);
    this.menu.destroy();
    if (this.bridge) this.bridge.destroy();
    this.rootRenderer.destroy();
    this.app.remove();
  }
}
