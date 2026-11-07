// EditorStore: the project being edited, with bounded snapshot undo/redo
// (design D10). Every change goes through apply(), which works on a clone and
// records the previous state as one history entry. Consecutive changes sharing a
// coalesce key within a short window (keyboard nudges, typing in one field) fold
// into a single entry. Asset bytes live outside history and are never discarded
// while the project is open, so undoing a deletion restores the image too.

export const HISTORY_LIMIT = 100;
const COALESCE_MS = 1200;

export class EditorStore {
  constructor(project) {
    this.listeners = new Set();
    this.reset(project);
  }

  reset(project) {
    this.project = project;
    this.past = [];
    this.future = [];
    this.version = 0;
    this.nextVersion = 1;
    this.savedVersion = 0;
    this.lastCoalesce = null;
    this.emit({ kind: 'reset' });
  }

  get dirty() { return this.version !== this.savedVersion; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get undoLabel() { return this.past.length ? this.past[this.past.length - 1].label : ''; }
  get redoLabel() { return this.future.length ? this.future[this.future.length - 1].label : ''; }

  apply(mutator, { label = 'Edit', coalesce = null } = {}) {
    const next = structuredClone(this.project);
    const result = mutator(next);
    const now = Date.now();
    const fold = coalesce && this.lastCoalesce && this.lastCoalesce.key === coalesce && now - this.lastCoalesce.at < COALESCE_MS && this.past.length;
    if (!fold) {
      this.past.push({ project: this.project, version: this.version, label });
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.lastCoalesce = coalesce ? { key: coalesce, at: now } : null;
    this.future = [];
    this.project = next;
    this.version = this.nextVersion++;
    this.emit({ kind: 'change', label });
    return result;
  }

  undo() {
    if (!this.past.length) return false;
    const e = this.past.pop();
    this.future.push({ project: this.project, version: this.version, label: e.label });
    this.project = e.project;
    this.version = e.version;
    this.lastCoalesce = null;
    this.emit({ kind: 'undo', label: e.label });
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    const e = this.future.pop();
    this.past.push({ project: this.project, version: this.version, label: e.label });
    this.project = e.project;
    this.version = e.version;
    this.lastCoalesce = null;
    this.emit({ kind: 'redo', label: e.label });
    return true;
  }

  markSaved() {
    this.savedVersion = this.version;
    this.emit({ kind: 'saved' });
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(ev) { for (const fn of this.listeners) fn(ev, this); }
}
