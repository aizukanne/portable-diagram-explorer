// The editor (spec §4 "Author a project", §5, §10, §14.3).
import { h, button, clear } from '../dom.js';
import { SceneRenderer } from '../renderer.js';
import { Viewer, sceneOf } from '../viewer.js';
import { issueList } from '../issues-view.js';
import { buildInfo } from '../build-info.js';
import { AssetManager } from '../assets.js';
import { EditorStore } from './store.js';
import { showDialog } from './dialogs.js';
import { readFiles, interpretSelection, editorSelfHtml, download } from './fileio.js';
import {
  emptyProject, addDiagramFromAsset, updateDiagram, setRoot, referencesTo, removeDiagram, replaceAsset,
  markAlignmentReviewed, addHotspot, duplicateHotspot, deleteHotspot, updateHotspot, setRect, moveZ,
  addAction, updateAction, removeAction, moveAction, setDefaultAction, addAnnotation, updateAnnotation,
  deleteAnnotation, updateProjectMeta, addToSequence, removeFromSequence, moveInSequence, sequenceIndex,
} from './ops.js';
import { validateProject } from '../../core/validate.js';
import { buildProjectZip, buildPresentationHtml } from '../../core/package.js';
import { measureEnvelope } from '../../core/envelope.js';
import { slug } from '../../core/sniff.js';
import { DEFAULT_VIEW } from '../../core/geometry.js';

const TOOLS = [
  { id: 'select', label: 'Select', key: 'v', icon: '↖' },
  { id: 'hotspot', label: 'Add hotspot', key: 'h', icon: '▭' },
  { id: 'annotation', label: 'Add note', key: 'n', icon: '✎' },
];

function titleFromFile(name) {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_-]+/g, ' ').trim();
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 200) || 'Untitled diagram';
}

// Map an issue path to something the editor can select.
function goToOf(project, path) {
  const m = /^diagrams\[(\d+)\](?:\.hotspots\[(\d+)\])?(?:\.annotations\[(\d+)\])?/.exec(path || '');
  if (!m) return null;
  const d = project.diagrams[+m[1]];
  if (!d) return null;
  if (m[2] !== undefined && d.hotspots[+m[2]]) return { diagramId: d.id, kind: 'hotspot', id: d.hotspots[+m[2]].id };
  if (m[3] !== undefined && d.annotations[+m[3]]) return { diagramId: d.id, kind: 'annotation', id: d.annotations[+m[3]].id };
  return { diagramId: d.id, kind: null, id: null };
}

export class EditorApp {
  constructor(root) {
    this.root = root;
    this.assets = new AssetManager();
    this.store = new EditorStore(emptyProject());
    this.current = null; // diagram id on the canvas
    this.sel = { kind: null, id: null };
    this.views = new Map(); // per-diagram canvas viewport
    this.issues = { errors: [], warnings: [] };
    this.preview = null;
    this.quietInspector = false;
    this.build();
    this.store.subscribe((ev) => this.onStoreChange(ev));
    this.renderAll();
    window.addEventListener('beforeunload', (e) => {
      if (this.store.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('keydown', (e) => this.onKey(e));
    window.__pdeEditor = this;
  }

  get project() { return this.store.project; }
  diagram(id = this.current) { return this.project.diagrams.find((d) => d.id === id) || null; }

  // ---- layout --------------------------------------------------------------

  build() {
    const fileInput = (role, accept, multiple, onFiles) => {
      const el = h('input', { type: 'file', accept, multiple: multiple || undefined, hidden: true, dataset: { role }, 'aria-hidden': 'true', tabindex: '-1' });
      el.addEventListener('change', async () => { const files = await readFiles(el.files); el.value = ''; onFiles(files); });
      return el;
    };
    this.inputs = {
      open: fileInput('open', '.zip,.html,.htm,.json,image/png,image/jpeg,image/webp,image/svg+xml,.svg', true, (f) => this.openFiles(f)),
      add: fileInput('add-images', 'image/png,image/jpeg,image/webp,image/svg+xml,.svg', true, (f) => this.addImages(f)),
      replace: fileInput('replace-image', 'image/png,image/jpeg,image/webp,image/svg+xml,.svg', false, (f) => this.replaceImage(f)),
    };
    this.titleInput = h('input', { class: 'pde-title-input', type: 'text', maxlength: '200', 'aria-label': 'Project title' });
    this.titleInput.addEventListener('input', () => this.edit((p) => updateProjectMeta(p, { title: this.titleInput.value }), { label: 'Rename project', coalesce: 'project-title', quiet: true }));
    this.undoBtn = button('Undo', () => this.store.undo(), { icon: '↶', iconOnly: true, title: 'Undo (Ctrl+Z)' });
    this.redoBtn = button('Redo', () => this.store.redo(), { icon: '↷', iconOnly: true, title: 'Redo (Ctrl+Shift+Z)' });
    this.dirtyEl = h('span', { class: 'pde-dirty', role: 'status' });
    this.issuesBtn = button('No problems', () => this.showIssues(), { cls: 'pde-issues-btn' });
    this.toolbar = h('header', { class: 'pde-toolbar' },
      h('span', { class: 'pde-brand', text: 'Diagram Explorer' }), this.titleInput,
      h('div', { class: 'pde-tools' },
        button('New', () => this.newProject(), { icon: '⬚' }),
        button('Open…', () => this.inputs.open.click(), { icon: '⇧' }),
        button('Save project', () => this.saveProject(), { icon: '⬇', title: 'Download the editable .diagram.zip (Ctrl+S)' }),
        button('Export presentation', () => this.exportPresentation(), { cls: 'pde-primary', icon: '▶', title: 'Download a single-file offline presentation' }),
        button('Preview', () => this.openPreview(), { icon: '◉' }),
        h('span', { class: 'pde-sep', 'aria-hidden': 'true' }), this.undoBtn, this.redoBtn,
        h('span', { class: 'pde-sep', 'aria-hidden': 'true' }), this.issuesBtn, this.dirtyEl),
      Object.values(this.inputs));

    this.search = h('input', { type: 'search', class: 'pde-search', placeholder: 'Filter diagrams', 'aria-label': 'Filter diagrams' });
    this.search.addEventListener('input', () => this.renderSidebar());
    this.diagramList = h('ul', { class: 'pde-diagram-list', 'aria-label': 'Diagrams' });
    this.seqSection = h('section', { class: 'pde-seq', 'aria-labelledby': 'pde-seq-h' });
    this.sidebar = h('aside', { class: 'pde-sidebar', 'aria-label': 'Diagrams' },
      this.seqSection,
      h('div', { class: 'pde-sidebar-head' }, h('h2', { text: 'Diagrams' }), button('Add images…', () => this.inputs.add.click(), { icon: '+' })),
      this.search, this.diagramList);

    this.toolBtns = TOOLS.map((t) => button(t.label, () => this.setTool(t.id), { cls: 'pde-toggle', icon: t.icon, title: `${t.label} (${t.key.toUpperCase()})`, attrs: { 'aria-pressed': 'false', 'data-tool': t.id } }));
    this.canvasHost = h('div', { class: 'pde-canvas-view', tabindex: '0', 'aria-label': 'Diagram canvas' });
    this.emptyState = h('div', { class: 'pde-empty' },
      h('h2', { text: 'Start with your existing diagram images' }),
      h('p', { text: 'Import PNG, JPEG or WebP files. Each becomes a diagram you can add clickable regions to. Your images are never changed.' }),
      h('div', { class: 'pde-empty-actions' },
        button('Add images…', () => this.inputs.add.click(), { cls: 'pde-primary', icon: '+' }),
        button('Open a project…', () => this.inputs.open.click(), { icon: '⇧' })));
    this.alignBanner = h('div', { class: 'pde-banner', role: 'alert', hidden: true });
    this.canvas = h('section', { class: 'pde-canvas', 'aria-label': 'Canvas' },
      h('div', { class: 'pde-canvas-bar' }, this.toolBtns,
        h('span', { class: 'pde-sep', 'aria-hidden': 'true' }),
        button('Zoom out', () => this.renderer.zoomBy(0.8), { icon: '−', iconOnly: true }),
        button('Fit', () => this.renderer.fit(), { icon: '⤢' }),
        button('Zoom in', () => this.renderer.zoomBy(1.25), { icon: '+', iconOnly: true })),
      this.alignBanner, this.canvasHost, this.emptyState);
    this.inspector = h('aside', { class: 'pde-inspector', 'aria-label': 'Inspector' });
    this.statusEl = h('div', { class: 'pde-status', role: 'status', 'aria-live': 'polite' });
    this.body = h('div', { class: 'pde-editor-body' }, this.sidebar, this.canvas, this.inspector);
    this.app = h('div', { class: 'pde-app pde-editor' }, this.toolbar, this.body, h('footer', { class: 'pde-statusbar' }, this.statusEl));
    this.root.append(this.app);

    this.renderer = new SceneRenderer(this.canvasHost, {
      mode: 'edit',
      tooltipDelayMs: 600,
      onSelect: (id) => this.selectFromCanvas(id),
      onEdit: (kind, payload) => this.onCanvasEdit(kind, payload),
      onView: (v) => { if (this.current) this.views.set(this.current, v); },
      onKey: () => {},
    });
    this.setTool('select');
  }

  status(text) {
    this.statusEl.textContent = '';
    setTimeout(() => { this.statusEl.textContent = text; }, 20);
  }

  // ---- state flow ----------------------------------------------------------

  edit(fn, { label, coalesce, quiet } = {}) {
    this.quietInspector = !!quiet;
    try { return this.store.apply(fn, { label, coalesce }); } finally { this.quietInspector = false; }
  }

  onStoreChange(ev) {
    if (ev.kind === 'reset') { this.current = null; this.sel = { kind: null, id: null }; this.views.clear(); }
    this.renderAll({ keepInspector: this.quietInspector && ev.kind === 'change' });
  }

  validate() {
    this.issues = validateProject(this.project);
    for (const i of [...this.issues.errors, ...this.issues.warnings]) i.goTo = goToOf(this.project, i.path);
  }

  renderAll({ keepInspector = false } = {}) {
    const p = this.project;
    if (this.current && !this.diagram()) this.current = null;
    if (!this.current && p.diagrams.length) this.current = p.rootDiagramId && this.diagram(p.rootDiagramId) ? p.rootDiagramId : p.diagrams[0].id;
    const d = this.diagram();
    if (d && this.sel.kind === 'hotspot' && !d.hotspots.some((x) => x.id === this.sel.id)) this.sel = { kind: null, id: null };
    if (d && this.sel.kind === 'annotation' && !d.annotations.some((x) => x.id === this.sel.id)) this.sel = { kind: null, id: null };
    if (document.activeElement !== this.titleInput) this.titleInput.value = p.title;
    document.title = `${p.title} — Portable Diagram Explorer`;
    this.undoBtn.disabled = !this.store.canUndo;
    this.redoBtn.disabled = !this.store.canRedo;
    this.undoBtn.title = this.store.canUndo ? `Undo ${this.store.undoLabel} (Ctrl+Z)` : 'Nothing to undo';
    this.redoBtn.title = this.store.canRedo ? `Redo ${this.store.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo';
    this.dirtyEl.textContent = this.store.dirty ? 'Unsaved changes' : 'Saved';
    this.dirtyEl.classList.toggle('is-dirty', this.store.dirty);
    this.validate();
    const ne = this.issues.errors.length;
    const nw = this.issues.warnings.length;
    this.issuesBtn.querySelector('.pde-btn-label').textContent = ne || nw ? `${ne} error${ne === 1 ? '' : 's'}, ${nw} warning${nw === 1 ? '' : 's'}` : 'No problems';
    this.issuesBtn.classList.toggle('has-errors', ne > 0);
    this.renderSidebar();
    this.renderCanvas();
    if (!keepInspector) this.renderInspector();
  }

  // ---- sidebar -------------------------------------------------------------

  renderSidebar() {
    const p = this.project;
    const q = this.search.value.trim().toLowerCase();
    const refCount = (id) => referencesTo(p, id).length;
    this.renderSequence();
    clear(this.diagramList);
    for (const d of p.diagrams) {
      if (q && !d.title.toLowerCase().includes(q)) continue;
      const isRoot = d.id === p.rootDiagramId;
      const n = refCount(d.id);
      const item = h('li', { class: ['pde-diagram-item', d.id === this.current && 'is-current'] },
        h('button', {
          type: 'button', class: 'pde-diagram-btn', 'aria-current': d.id === this.current ? 'true' : undefined,
          on: { click: () => this.showDiagram(d.id) },
        },
        h('img', { class: 'pde-thumb', alt: '', src: this.assets.has(d.assetId) ? this.assets.url(d.assetId) : undefined }),
        h('span', { class: 'pde-diagram-meta' },
          h('span', { class: 'pde-diagram-title', text: d.title }),
          h('span', { class: 'pde-diagram-sub' },
            isRoot ? h('span', { class: 'pde-root-badge', text: '★ Overview' }) : null,
            sequenceIndex(p, d.id) >= 0 ? h('span', { class: 'pde-slide-badge', text: `Slide ${sequenceIndex(p, d.id) + 1}` }) : null,
            h('span', { text: `${d.hotspots.length} hotspot${d.hotspots.length === 1 ? '' : 's'}` }),
            h('span', { text: n ? `linked ${n}×` : 'not linked' }),
            d.alignmentReviewRequired ? h('span', { class: 'pde-warn-badge', text: 'review alignment' }) : null))));
      this.diagramList.append(item);
    }
    if (!p.diagrams.length) this.diagramList.append(h('li', { class: 'pde-muted', text: 'No diagrams yet.' }));
  }

  // The running order: the ordered slides a presenter steps through. Every change is one undo step.
  renderSequence() {
    const p = this.project;
    const slides = p.sequence ? p.sequence.slides : [];
    const titleOf = (id) => (this.diagram(id) || {}).title || id;
    const refocus = this.seqFocus;
    this.seqFocus = null;
    const heading = h('h2', { id: 'pde-seq-h', tabindex: '-1', text: 'Running order' });
    clear(this.seqSection).append(heading);
    if (!slides.length) {
      this.seqSection.append(h('p', { class: 'pde-muted', text: 'No slides yet. Select a diagram and choose "Add to running order".' }));
      if (refocus && refocus.heading) heading.focus();
      return;
    }
    const move = (id, to, label = 'Reorder running order') => {
      this.edit((q) => moveInSequence(q, id, to), { label });
      this.status(`Moved ${titleOf(id)} to position ${to + 1} of ${slides.length}`);
    };
    const list = h('ol', { class: 'pde-seq-list', 'aria-label': 'Running order' });
    slides.forEach((id, i) => {
      const act = (name, text, onClick, disabled) => button(text, () => { this.seqFocus = { id, name }; onClick(); }, { iconOnly: true, icon: name === 'up' ? '↑' : name === 'down' ? '↓' : '✕', disabled, attrs: { 'data-seq': name } });
      const li = h('li', { class: 'pde-seq-item', draggable: 'true', dataset: { id } },
        h('span', { class: 'pde-seq-handle', 'aria-hidden': 'true', text: '⠿' }),
        h('span', { class: 'pde-seq-n', text: `${i + 1}.` }),
        h('span', { class: 'pde-seq-title', text: titleOf(id) }),
        act('up', 'Move up', () => move(id, i - 1), i === 0),
        act('down', 'Move down', () => move(id, i + 1), i === slides.length - 1),
        act('remove', 'Remove', () => {
          // The row is about to vanish: hand focus to the row that takes its place, or the heading when none is left.
          this.seqFocus = slides.length === 1 ? { heading: true } : { index: Math.min(i, slides.length - 2), name: 'remove' };
          this.edit((q) => removeFromSequence(q, id), { label: 'Remove slide' });
        }));
      li.addEventListener('dragstart', (e) => { this.seqDrag = id; li.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); });
      li.addEventListener('dragend', () => { this.seqDrag = null; li.classList.remove('is-dragging'); for (const x of list.children) x.classList.remove('is-over'); });
      li.addEventListener('dragover', (e) => { if (!this.seqDrag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; li.classList.add('is-over'); });
      li.addEventListener('dragleave', () => li.classList.remove('is-over'));
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('is-over');
        const from = this.seqDrag;
        this.seqDrag = null;
        if (from && from !== id) move(from, i);
      });
      list.append(li);
    });
    this.seqSection.append(list);
    if (refocus) {
      const row = refocus.index !== undefined ? list.children[refocus.index] : [...list.children].find((x) => x.dataset.id === refocus.id);
      const btn = row && (row.querySelector(`[data-seq="${refocus.name}"]:not([disabled])`) || row.querySelector('button:not([disabled])'));
      if (btn) btn.focus();
    }
  }

  showDiagram(id, { select } = {}) {
    if (this.current && this.renderer.scene) this.views.set(this.current, this.renderer.getView());
    this.current = id;
    this.sel = select || { kind: null, id: null };
    this.renderedDiagram = null;
    this.renderAll();
  }

  // ---- canvas --------------------------------------------------------------

  renderCanvas() {
    const d = this.diagram();
    this.emptyState.hidden = !!d;
    this.canvasHost.hidden = !d;
    this.alignBanner.hidden = !(d && d.alignmentReviewRequired);
    if (d && d.alignmentReviewRequired) {
      clear(this.alignBanner).append(
        h('span', { text: 'This diagram\'s image was replaced with one of different proportions. Check that every hotspot still covers the right component; export is blocked until you confirm.' }),
        button('Mark alignment reviewed', () => this.edit((p) => markAlignmentReviewed(p, d.id), { label: 'Mark alignment reviewed' }), { cls: 'pde-primary' }));
    }
    if (!d) return;
    const scene = sceneOf(this.project, d);
    const asset = this.project.assets.find((a) => a.id === d.assetId);
    const key = `${d.id}|${d.assetId}`;
    if (this.renderedDiagram !== key) {
      this.renderedDiagram = key;
      this.renderer.setScene(scene, this.assets.url(asset.id), this.views.get(d.id) || DEFAULT_VIEW, this.sel.id)
        .catch((e) => this.status(e.message));
    } else {
      this.renderer.updateScene(scene);
      this.renderer.select(this.sel.id, { notify: false });
    }
  }

  setTool(tool) {
    this.tool = tool;
    this.renderer.setTool(tool);
    for (const b of this.toolBtns) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  }

  selectFromCanvas(id) {
    const d = this.diagram();
    if (!d) return;
    if (!id) this.sel = { kind: null, id: null };
    else if (d.hotspots.some((x) => x.id === id)) this.sel = { kind: 'hotspot', id };
    else if (d.annotations.some((x) => x.id === id)) this.sel = { kind: 'annotation', id };
    this.renderInspector();
  }

  select(kind, id) {
    this.sel = { kind, id };
    this.renderer.select(id, { notify: false });
    this.renderInspector();
  }

  onCanvasEdit(kind, payload) {
    const d = this.diagram();
    if (!d) return;
    if (kind === 'createHotspot') {
      const id = this.edit((p) => addHotspot(p, d.id, payload.rect), { label: 'Add hotspot' });
      this.setTool('select');
      this.select('hotspot', id);
      const label = this.inspector.querySelector('[data-field="label"]');
      if (label) { label.focus(); label.select(); }
    } else if (kind === 'createAnnotation') {
      const id = this.edit((p) => addAnnotation(p, d.id, payload.at), { label: 'Add note' });
      this.setTool('select');
      this.select('annotation', id);
      const t = this.inspector.querySelector('[data-field="note-text"]');
      if (t) { t.focus(); t.select(); }
    } else if (kind === 'setRect') {
      this.edit((p) => setRect(p, d.id, payload.id, payload.rect), { label: 'Move hotspot', coalesce: payload.coalesce });
    } else if (kind === 'moveAnnotation') {
      this.edit((p) => updateAnnotation(p, d.id, payload.id, { x: payload.x, y: payload.y }), { label: 'Move note' });
    }
  }

  deleteSelection() {
    const d = this.diagram();
    if (!d || !this.sel.id) return;
    if (this.sel.kind === 'hotspot') this.edit((p) => deleteHotspot(p, d.id, this.sel.id), { label: 'Delete hotspot' });
    else if (this.sel.kind === 'annotation') this.edit((p) => deleteAnnotation(p, d.id, this.sel.id), { label: 'Delete note' });
    this.sel = { kind: null, id: null };
    this.renderInspector();
    this.status('Deleted. Undo with Ctrl+Z.');
  }

  duplicateSelection() {
    const d = this.diagram();
    if (!d || this.sel.kind !== 'hotspot') return;
    const id = this.edit((p) => duplicateHotspot(p, d.id, this.sel.id), { label: 'Duplicate hotspot' });
    this.select('hotspot', id);
  }

  // ---- inspector -----------------------------------------------------------

  field(label, value, onInput, { key, multiline = false, max, type = 'text', step, min, maxNum, hint } = {}) {
    const id = `pde-f-${key}`;
    const input = multiline
      ? h('textarea', { id, rows: '4', maxlength: max, dataset: { field: key } })
      : h('input', { id, type, maxlength: type === 'text' ? max : undefined, step, min, max: maxNum, dataset: { field: key } });
    input.value = value;
    input.addEventListener('input', () => onInput(input.value, input));
    return h('div', { class: 'pde-field' }, h('label', { for: id, text: label }), input, hint ? h('p', { class: 'pde-hint', text: hint }) : null);
  }

  renderInspector() {
    const focused = document.activeElement && this.inspector.contains(document.activeElement) ? document.activeElement.dataset.field : null;
    clear(this.inspector);
    const d = this.diagram();
    if (!d) {
      this.inspector.append(h('h2', { text: 'Project' }), this.projectSettings());
    } else if (this.sel.kind === 'hotspot') {
      this.inspector.append(this.hotspotInspector(d, d.hotspots.find((x) => x.id === this.sel.id)));
    } else if (this.sel.kind === 'annotation') {
      this.inspector.append(this.noteInspector(d, d.annotations.find((x) => x.id === this.sel.id)));
    } else {
      this.inspector.append(this.diagramInspector(d));
    }
    if (focused) {
      const el = this.inspector.querySelector(`[data-field="${CSS.escape(focused)}"]`);
      if (el) el.focus();
    }
  }

  projectSettings() {
    const p = this.project;
    const s = p.settings || {};
    const hints = h('input', { type: 'checkbox', id: 'pde-f-hints', dataset: { field: 'hints' } });
    hints.checked = s.showHotspotHints !== false;
    hints.addEventListener('change', () => this.edit((q) => updateProjectMeta(q, { showHotspotHints: hints.checked }), { label: 'Hotspot hints setting' }));
    return h('div', { class: 'pde-section' },
      this.field('Tooltip delay (ms)', String(s.tooltipDelayMs ?? 350), (v) => {
        const n = Number.parseInt(v, 10);
        if (Number.isInteger(n) && n >= 0 && n <= 5000) this.edit((q) => updateProjectMeta(q, { tooltipDelayMs: n }), { label: 'Tooltip delay', coalesce: 'tooltip-delay', quiet: true });
      }, { key: 'tooltip-delay', type: 'number', min: '0', maxNum: '5000', step: '50', hint: 'How long the pointer rests on a component before its tooltip appears (0–5000).' }),
      h('div', { class: 'pde-field pde-check' }, hints, h('label', { for: 'pde-f-hints', text: 'Show hotspot outlines in presentations' })));
  }

  diagramInspector(d) {
    const p = this.project;
    const asset = p.assets.find((a) => a.id === d.assetId);
    const isRoot = d.id === p.rootDiagramId;
    const inSeq = sequenceIndex(p, d.id) >= 0;
    const list = h('ul', { class: 'pde-mini-list' }, d.hotspots.map((x) => h('li', {}, button(x.label, () => this.select('hotspot', x.id), { cls: 'pde-link' }))));
    const notes = h('ul', { class: 'pde-mini-list' }, d.annotations.map((n) => h('li', {}, button(noteLabel(n.text), () => this.select('annotation', n.id), { cls: 'pde-link' }))));
    return h('div', {},
      h('h2', { text: 'Diagram' }),
      this.field('Title', d.title, (v) => this.edit((q) => updateDiagram(q, d.id, { title: v }), { label: 'Rename diagram', coalesce: `dtitle:${d.id}`, quiet: true }), { key: 'diagram-title', max: '200' }),
      this.field('Description', d.description || '', (v) => this.edit((q) => updateDiagram(q, d.id, { description: v }), { label: 'Edit description', coalesce: `ddesc:${d.id}`, quiet: true }), { key: 'diagram-desc', multiline: true, max: '20000', hint: 'Shown by "About this diagram" in presentations. Plain text.' }),
      h('div', { class: 'pde-section' },
        h('p', { class: 'pde-muted', text: `Image: ${asset.width} × ${asset.height} px, ${asset.mimeType.replace('image/', '').toUpperCase()}` }),
        h('div', { class: 'pde-row' },
          button('Replace image…', () => this.inputs.replace.click(), { icon: '⇄' }),
          button(isRoot ? 'This is the overview' : 'Set as overview', () => this.edit((q) => setRoot(q, d.id), { label: 'Set overview' }), { icon: '★', disabled: isRoot }))),
      h('div', { class: 'pde-section' }, h('h3', { text: `Hotspots on this diagram (${d.hotspots.length})` }),
        d.hotspots.length ? list : h('p', { class: 'pde-muted', text: 'Choose "Add hotspot" and drag over a component on the image.' })),
      h('div', { class: 'pde-section' }, h('h3', { text: `Notes on this diagram (${d.annotations.length})` }),
        d.annotations.length ? notes : h('p', { class: 'pde-muted', text: 'Choose "Add note" and click where the note should go.' })),
      h('div', { class: 'pde-section' }, inSeq
        ? button('Remove from running order', () => this.edit((q) => removeFromSequence(q, d.id), { label: 'Remove slide' }), { icon: '−' })
        : button('Add to running order', () => this.edit((q) => addToSequence(q, d.id), { label: 'Add slide' }), { icon: '+' })),
      h('div', { class: 'pde-section' }, button('Delete diagram…', () => this.deleteDiagram(d.id), { cls: 'pde-danger', icon: '✖' })),
      h('h2', { text: 'Project' }), this.projectSettings());
  }

  hotspotInspector(d, x) {
    const p = this.project;
    const pct = (v) => (Math.round(v * 10000) / 100).toString();
    const geo = (k, label) => this.field(label, pct(x.rect[k]), (v) => {
      const n = Number.parseFloat(v);
      if (!Number.isFinite(n)) return;
      this.edit((q) => setRect(q, d.id, x.id, { ...findRect(q, d.id, x.id), [k]: n / 100 }), { label: 'Edit geometry', coalesce: `geo:${x.id}:${k}`, quiet: true });
    }, { key: `geo-${k}`, type: 'number', step: '0.1', min: '0', maxNum: '100' });
    const actions = h('ol', { class: 'pde-actions' });
    const defName = `pde-default-${x.id}`;
    const radio = (checked, onChange, label) => {
      const id = `${defName}-${label.replace(/\W+/g, '-')}`;
      const r = h('input', { type: 'radio', name: defName, id });
      r.checked = checked;
      r.addEventListener('change', onChange);
      return h('label', { class: 'pde-radio', for: id }, r, ` ${label}`);
    };
    x.actions.forEach((a, i) => {
      const target = a.type === 'diagram'
        ? (() => {
          const sel = h('select', { 'aria-label': `Target of ${a.label}`, dataset: { field: `target-${a.id}` } },
            p.diagrams.map((t) => h('option', { value: t.id, text: t.title, selected: t.id === a.targetDiagramId || undefined })));
          if (!p.diagrams.some((t) => t.id === a.targetDiagramId)) sel.prepend(h('option', { value: '', text: '(missing diagram)', selected: true }));
          sel.addEventListener('change', () => { if (sel.value) this.edit((q) => updateAction(q, d.id, x.id, a.id, { targetDiagramId: sel.value }), { label: 'Change target' }); });
          return sel;
        })()
        : (() => {
          const ta = h('textarea', { rows: '3', maxlength: '20000', 'aria-label': `Text of ${a.label}`, dataset: { field: `text-${a.id}` } });
          ta.value = a.text;
          ta.addEventListener('input', () => this.edit((q) => updateAction(q, d.id, x.id, a.id, { text: ta.value }), { label: 'Edit description', coalesce: `atext:${a.id}`, quiet: true }));
          return ta;
        })();
      const lab = h('input', { type: 'text', maxlength: '120', 'aria-label': `Menu label ${i + 1}`, dataset: { field: `alabel-${a.id}` } });
      lab.value = a.label;
      lab.addEventListener('input', () => this.edit((q) => updateAction(q, d.id, x.id, a.id, { label: lab.value }), { label: 'Edit menu label', coalesce: `alabel:${a.id}`, quiet: true }));
      actions.append(h('li', { class: 'pde-action' },
        h('div', { class: 'pde-action-head' },
          h('span', { class: 'pde-action-type', text: a.type === 'diagram' ? 'Opens diagram' : 'Shows text' }),
          radio(x.defaultActionId === a.id, () => this.edit((q) => setDefaultAction(q, d.id, x.id, a.id), { label: 'Set default action' }), 'Default'),
          button('Move up', () => this.edit((q) => moveAction(q, d.id, x.id, a.id, -1), { label: 'Reorder actions' }), { icon: '↑', iconOnly: true, disabled: i === 0 }),
          button('Move down', () => this.edit((q) => moveAction(q, d.id, x.id, a.id, 1), { label: 'Reorder actions' }), { icon: '↓', iconOnly: true, disabled: i === x.actions.length - 1 }),
          button(`Remove ${a.label}`, () => this.edit((q) => removeAction(q, d.id, x.id, a.id), { label: 'Remove action' }), { icon: '✕', iconOnly: true, cls: 'pde-danger' })),
        lab, target));
    });
    const others = p.diagrams.filter((t) => t.id !== d.id);
    return h('div', {},
      h('h2', { text: 'Hotspot' }),
      this.field('Label', x.label, (v) => this.edit((q) => updateHotspot(q, d.id, x.id, { label: v }), { label: 'Edit label', coalesce: `label:${x.id}`, quiet: true }), { key: 'label', max: '120', hint: 'The component\'s name, read aloud by screen readers and shown in menus.' }),
      this.field('Tooltip', x.tooltip, (v) => this.edit((q) => updateHotspot(q, d.id, x.id, { tooltip: v }), { label: 'Edit tooltip', coalesce: `tooltip:${x.id}`, quiet: true }), { key: 'tooltip', max: '500', hint: 'Short text shown on hover and keyboard focus.' }),
      h('div', { class: 'pde-section' }, h('h3', { text: 'Position (% of image)' }),
        h('div', { class: 'pde-grid2' }, geo('x', 'Left'), geo('y', 'Top'), geo('width', 'Width'), geo('height', 'Height'))),
      h('div', { class: 'pde-section' }, h('h3', { text: 'Actions' }),
        h('div', { class: 'pde-radio-row' }, radio(!x.defaultActionId, () => this.edit((q) => setDefaultAction(q, d.id, x.id, null), { label: 'Show menu on click' }), 'Click shows the menu (no default)')),
        actions,
        h('div', { class: 'pde-row' },
          button('Open diagram', () => {
            const target = others[0] || d;
            this.edit((q) => addAction(q, d.id, x.id, { type: 'diagram', targetDiagramId: target.id, label: 'Open diagram' }), { label: 'Add action' });
          }, { icon: '+', disabled: !p.diagrams.length }),
          button('Description', () => this.edit((q) => addAction(q, d.id, x.id, { type: 'details', label: 'Read description', text: 'Description' }), { label: 'Add action' }), { icon: '+' }))),
      h('div', { class: 'pde-section' }, h('h3', { text: 'Stacking' }),
        h('div', { class: 'pde-row' },
          button('Bring to front', () => this.edit((q) => moveZ(q, d.id, x.id, 'top'), { label: 'Bring to front' })),
          button('Forward', () => this.edit((q) => moveZ(q, d.id, x.id, 'up'), { label: 'Bring forward' })),
          button('Backward', () => this.edit((q) => moveZ(q, d.id, x.id, 'down'), { label: 'Send backward' })),
          button('Send to back', () => this.edit((q) => moveZ(q, d.id, x.id, 'bottom'), { label: 'Send to back' })))),
      h('div', { class: 'pde-section pde-row' },
        button('Duplicate', () => this.duplicateSelection(), { icon: '⎘', title: 'Duplicate (Ctrl+D)' }),
        button('Delete hotspot', () => this.deleteSelection(), { icon: '✖', cls: 'pde-danger', title: 'Delete (Del)' }),
        button('Done', () => this.select(null, null))));
  }

  noteInspector(d, n) {
    const pct = (v) => (Math.round(v * 10000) / 100).toString();
    const num = (k, label) => this.field(label, pct(n[k]), (v) => {
      const val = Number.parseFloat(v);
      if (Number.isFinite(val)) this.edit((q) => updateAnnotation(q, d.id, n.id, { [k]: val / 100 }), { label: 'Edit note', coalesce: `note:${n.id}:${k}`, quiet: true });
    }, { key: `note-${k}`, type: 'number', step: '0.1', min: '0', maxNum: '100' });
    return h('div', {},
      h('h2', { text: 'Note' }),
      this.field('Text', n.text, (v) => this.edit((q) => updateAnnotation(q, d.id, n.id, { text: v }), { label: 'Edit note', coalesce: `ntext:${n.id}`, quiet: true }), { key: 'note-text', multiline: true, max: '2000', hint: 'Visible on the diagram in presentations. Plain text; line breaks are kept.' }),
      h('div', { class: 'pde-grid2' }, num('x', 'Left (%)'), num('y', 'Top (%)'), num('width', 'Width (%)')),
      h('div', { class: 'pde-section pde-row' },
        button('Delete note', () => this.deleteSelection(), { icon: '✖', cls: 'pde-danger' }),
        button('Done', () => this.select(null, null))));
  }

  // ---- diagrams ------------------------------------------------------------

  async addImages(files) {
    const issues = [];
    const warnings = [];
    let firstId = null;
    for (const f of files) {
      const r = await this.assets.importImage(f.name, f.bytes);
      if (r.issue) { issues.push(r.issue); continue; }
      warnings.push(...r.warnings);
      const id = this.edit((p) => addDiagramFromAsset(p, r.asset, titleFromFile(f.name)), { label: 'Add diagram' });
      if (!firstId) firstId = id;
      if (r.asset.width > 4096 || r.asset.height > 4096) this.status(`${f.name} is ${r.asset.width} × ${r.asset.height}; very large images open and zoom slowly.`);
    }
    if (firstId) this.showDiagram(firstId);
    if (issues.length) await this.showIssueDialog('Some files were not imported', 'Nothing else was changed.', [...issues, ...warnings]);
    else if (warnings.length) await this.showIssueDialog('Imported, with warnings', 'The images were imported. These parts of them will not be shown.', warnings);
  }

  async replaceImage(files) {
    const d = this.diagram();
    if (!d || !files.length) return;
    const r = await this.assets.importImage(files[0].name, files[0].bytes);
    if (r.issue) { await this.showIssueDialog('The image was not replaced', 'The diagram still uses its previous image.', [r.issue]); return; }
    const res = this.edit((p) => replaceAsset(p, d.id, r.asset), { label: 'Replace image' });
    this.renderedDiagram = null;
    this.renderAll();
    if (res.aspectChanged) this.status(`Image replaced (${res.from} → ${res.to}). Its proportions changed: review every hotspot, then choose "Mark alignment reviewed".`);
    else if (res.sizeChanged) this.status(`Image replaced (${res.from} → ${res.to}). Same proportions, so hotspots keep their positions.`);
    else this.status('Image replaced.');
    if (r.warnings.length) await this.showIssueDialog('Image replaced, with warnings', 'These parts of the image will not be shown.', r.warnings);
  }

  async deleteDiagram(id) {
    const p = this.project;
    const d = this.diagram(id);
    const refs = referencesTo(p, id).filter((r) => r.diagramId !== id);
    const others = p.diagrams.filter((x) => x.id !== id);
    const body = [h('p', { text: `Delete "${d.title}" and its ${d.hotspots.length} hotspot(s) and ${d.annotations.length} note(s)? Its image file is not affected. You can undo this.` })];
    const slideAt = sequenceIndex(p, id);
    if (slideAt >= 0) body.push(h('p', { text: `It is slide ${slideAt + 1} of ${p.sequence.slides.length} in the running order and will be removed from it.` }));
    let retarget = null;
    let mode = null;
    if (refs.length) {
      mode = h('select', { 'aria-label': 'What to do with links to this diagram' },
        h('option', { value: 'retarget', text: 'Point them to another diagram' }),
        h('option', { value: 'removeActions', text: `Remove the ${refs.length} link(s)` }));
      retarget = h('select', { 'aria-label': 'New target' }, others.map((x) => h('option', { value: x.id, text: x.title })));
      if (!others.length) { mode.value = 'removeActions'; mode.disabled = true; retarget.disabled = true; }
      mode.addEventListener('change', () => { retarget.disabled = mode.value !== 'retarget'; });
      body.push(h('p', { text: `${refs.length} action(s) open this diagram:` }),
        h('ul', { class: 'pde-mini-list' }, refs.map((r) => h('li', { text: `${r.diagramTitle} › ${r.hotspotLabel} › ${r.actionLabel}` }))),
        h('div', { class: 'pde-field' }, h('label', { text: 'Those links' }), mode),
        h('div', { class: 'pde-field' }, h('label', { text: 'New target' }), retarget));
    }
    let newRoot = null;
    if (id === p.rootDiagramId && others.length) {
      newRoot = h('select', { 'aria-label': 'New overview' }, others.map((x) => h('option', { value: x.id, text: x.title })));
      body.push(h('div', { class: 'pde-field' }, h('label', { text: 'New overview diagram' }), newRoot));
    }
    const ok = await showDialog({ title: 'Delete diagram', body, inertRoot: this.app, actions: [{ label: 'Cancel', value: false }, { label: 'Delete diagram', value: true, danger: true }], cancelValue: false });
    if (!ok) return;
    const decision = refs.length ? (mode.value === 'retarget' ? { mode: 'retarget', to: retarget.value } : { mode: 'removeActions' }) : {};
    this.edit((q) => removeDiagram(q, id, decision, newRoot ? newRoot.value : undefined), { label: 'Delete diagram' });
    this.current = null;
    this.renderedDiagram = null;
    this.renderAll();
    this.status(`Deleted "${d.title}". Undo with Ctrl+Z.`);
  }

  // ---- open / save / export ------------------------------------------------

  async confirmDiscard(what) {
    if (!this.store.dirty) return true;
    return showDialog({
      title: 'Unsaved changes', inertRoot: this.app, cancelValue: false,
      body: h('p', { text: `This project has changes that have not been saved to a .diagram.zip. ${what} will replace it in this window.` }),
      actions: [{ label: 'Cancel', value: false }, { label: 'Save project first', value: 'save' }, { label: 'Discard changes', value: true, danger: true }],
    }).then(async (v) => { if (v === 'save') { await this.saveProject(); return !this.store.dirty; } return v; });
  }

  async newProject() {
    if (!(await this.confirmDiscard('A new project'))) return;
    this.assets.clear();
    this.renderedDiagram = null;
    this.store.reset(emptyProject());
    this.migratedFromV1 = false;
    this.status('New project.');
  }

  async openFiles(files) {
    const r = await interpretSelection(files);
    if (r.kind === 'images') { await this.addImages(r.files); return; }
    if (r.kind === 'error' || !r.project) {
      await this.showIssueDialog('This could not be opened', 'Nothing was changed: the project you were editing is still open.', r.issues);
      return;
    }
    const verify = new AssetManager();
    for (const [id, bytes] of r.assets) verify.add(id, bytes, r.project.assets.find((a) => a.id === id).mimeType);
    const dimIssues = await verify.verifyProject(r.project);
    if (dimIssues.length) {
      verify.clear();
      await this.showIssueDialog('This could not be opened', 'Nothing was changed: the project you were editing is still open.', dimIssues);
      return;
    }
    if (!(await this.confirmDiscard(`"${r.project.title}"`))) { verify.clear(); return; }
    this.assets.clear();
    this.assets = verify;
    this.renderedDiagram = null;
    this.store.reset(r.project);
    this.store.markSaved();
    this.migratedFromV1 = r.migratedFrom === 1;
    const errs = r.issues.filter((i) => i.severity === 'error');
    this.status(`Opened "${r.project.title}" from ${r.source}${errs.length ? ` with ${errs.length} problem(s) to fix before export` : ''}.`);
    if (errs.length) await this.showIssues();
    const notes = r.issues.filter((i) => i.severity === 'warning');
    if (notes.length) await this.showIssueDialog('Opened, with notes', 'The project opened. These parts of the file were skipped or changed on the way in.', notes);
  }

  async saveProject() {
    if (!this.project.diagrams.length) { this.status('Nothing to save yet: add images first.'); return; }
    const { bytes } = await buildProjectZip(this.project, this.assets.bytes, editorSelfHtml(), buildInfo().version || '');
    const name = `${slug(this.project.title, 60)}.diagram.zip`;
    download(name, bytes, 'application/zip');
    this.store.markSaved();
    const notes = [];
    if (this.migratedFromV1) { notes.push('Saved in the v1.1 format; v1 editors cannot open it.'); this.migratedFromV1 = false; }
    this.status(`Saved ${name}. ${notes.length ? `${notes.join(' ')} ` : ''}Your browser decides where downloads go and cannot confirm the file was kept; check your downloads folder.`);
  }

  async exportPresentation() {
    this.validate();
    if (this.issues.errors.length) {
      await this.showIssueDialog('Fix these problems before exporting', 'A presentation must open correctly for someone without the editor, so problems that would break it block export. Warnings do not.', this.issues.errors);
      return;
    }
    const env = measureEnvelope(this.project, this.assets.bytes);
    if (env.warnings.length) {
      const go = await showDialog({
        title: 'Larger than the tested size', inertRoot: this.app, cancelValue: false, wide: true,
        body: [h('p', { text: 'The export will work, but this project is beyond the size that has been tested. It may open slowly on the recipient\'s computer.' }), issueList(env.warnings)],
        actions: [{ label: 'Cancel', value: false }, { label: 'Export anyway', value: true, primary: true }],
      });
      if (!go) return;
    }
    const html = buildPresentationHtml(buildInfo().presentationTemplate, this.project, this.assets.bytes, buildInfo().version || '');
    const name = `${slug(this.project.title, 60)}.presentation.html`;
    download(name, html, 'text/html');
    this.status(`Exported ${name} (${(html.length / 1024 / 1024).toFixed(1)} MB). It opens offline by double-clicking. This is not an editable save; use "Save project" for that.`);
  }

  async showIssueDialog(title, intro, issues) {
    await showDialog({ title, inertRoot: this.app, wide: true, body: [h('p', { text: intro }), issueList(issues)], actions: [{ label: 'Close', value: true, primary: true }] });
  }

  async showIssues() {
    this.validate();
    const all = [...this.issues.errors, ...this.issues.warnings];
    let target = null;
    await showDialog({
      title: all.length ? `${this.issues.errors.length} error(s), ${this.issues.warnings.length} warning(s)` : 'No problems found',
      inertRoot: this.app, wide: true,
      body: all.length ? issueList(all, { onGoTo: (g) => { target = g; document.querySelector('.pde-dialog .pde-dialog-actions button').click(); } }) : h('p', { text: 'The project is ready to export.' }),
      actions: [{ label: 'Close', value: true, primary: true }],
    });
    if (target) this.showDiagram(target.diagramId, { select: { kind: target.kind, id: target.id } });
  }

  // ---- preview -------------------------------------------------------------

  openPreview() {
    const p = this.project;
    if (!p.diagrams.length || !p.diagrams.some((d) => d.id === p.rootDiagramId)) { this.status('Add images and choose an overview diagram to preview.'); return; }
    const host = h('div', { class: 'pde-preview' });
    document.body.append(host);
    this.app.inert = true;
    const before = document.activeElement;
    const close = () => {
      this.preview.destroy();
      this.preview = null;
      host.remove();
      this.app.inert = false;
      if (before && before.focus) before.focus();
    };
    this.preview = new Viewer(host, structuredClone(p), { url: (id) => this.assets.url(id), dataUrl: (id) => this.assets.dataUrl(id) }, { embedded: true, onExit: close });
    const first = host.querySelector('.pde-hotspot');
    if (first) first.focus(); else host.querySelector('button').focus();
  }

  // ---- keys ----------------------------------------------------------------

  onKey(e) {
    if (this.preview || this.app.inert) return;
    const typing = e.target && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey && !typing) { e.preventDefault(); this.store.undo(); return; }
      if (((k === 'z' && e.shiftKey) || k === 'y') && !typing) { e.preventDefault(); this.store.redo(); return; }
      if (k === 's') { e.preventDefault(); this.saveProject(); return; }
      if (k === 'd' && !typing) { e.preventDefault(); this.duplicateSelection(); return; }
      return;
    }
    if (typing) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel.id) { e.preventDefault(); this.deleteSelection(); return; }
    if (e.key === 'Escape') {
      if (this.tool !== 'select') this.setTool('select');
      else if (this.sel.id) this.select(null, null);
      return;
    }
    const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
    if (t && !e.altKey) { e.preventDefault(); this.setTool(t.id); }
  }
}

function findRect(p, dId, hId) {
  return p.diagrams.find((d) => d.id === dId).hotspots.find((x) => x.id === hId).rect;
}

// The inspector names a note by its first line, shortened, so a list of notes stays readable.
function noteLabel(text) {
  const first = String(text).split('\n').find((l) => l.trim()) || '';
  const t = first.trim();
  if (!t) return '(empty note)';
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
}
