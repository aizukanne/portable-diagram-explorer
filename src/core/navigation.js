// The drill-down visit stack (spec §6, design D21).
//
// Diagrams form a graph; the stack records the route actually taken. Each entry is
// a visit with its own ID, so revisiting a diagram is unambiguous. The overview's
// state is held separately and restored on close.

export const HISTORY_CAP = 64;

export class NavStack {
  constructor(cap = HISTORY_CAP) {
    this.cap = cap;
    this.stack = [];
    this.overview = null;
    this.counter = 0;
  }

  get isOpen() { return this.stack.length > 0; }

  makeVisit(diagramId) {
    this.counter += 1;
    return { visitId: `v${this.counter}`, diagramId, viewport: null, selectedHotspotId: null, details: null };
  }

  // Open the first child from the overview. overviewState is restored on close.
  open(diagramId, overviewState) {
    this.overview = structuredClone(overviewState);
    this.stack = [this.makeVisit(diagramId)];
    return this.current();
  }

  // Go deeper, saving the current visit's state first.
  push(diagramId, currentState) {
    if (!this.isOpen) throw new Error('push before open');
    if (this.stack.length >= this.cap) return { ok: false, reason: 'cap' };
    this.updateCurrent(currentState);
    const v = this.makeVisit(diagramId);
    this.stack.push(v);
    return { ok: true, visit: structuredClone(v) };
  }

  updateCurrent(partial) {
    if (!this.isOpen || !partial) return;
    Object.assign(this.stack[this.stack.length - 1], structuredClone(partial));
  }

  current() {
    return this.isOpen ? structuredClone(this.stack[this.stack.length - 1]) : null;
  }

  // One step back; at the first child, closing returns the overview state.
  back() {
    if (!this.isOpen) return { closed: true, entry: this.overview };
    if (this.stack.length === 1) return { closed: true, entry: this.close() };
    this.stack.pop();
    return { closed: false, entry: this.current() };
  }

  // Return to an earlier visit, discarding the ones after it.
  jump(visitId) {
    const i = this.stack.findIndex((v) => v.visitId === visitId);
    if (i < 0) return null;
    this.stack.length = i + 1;
    return this.current();
  }

  close() {
    const o = this.overview;
    this.stack = [];
    this.overview = null;
    return o;
  }

  breadcrumbs() {
    return this.stack.map((v) => ({ visitId: v.visitId, diagramId: v.diagramId }));
  }
}
