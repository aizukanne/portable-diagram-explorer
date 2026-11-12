// SlideCursor: DOM-free position model for the running order of slides.
// `index` is a position in `slides`, or null when the current diagram (the
// overview, initially) is outside the order.

export class SlideCursor {
  #slides;
  #root;
  #index;

  constructor(slides, rootDiagramId) {
    this.#slides = Object.freeze([...slides]);
    this.#root = rootDiagramId;
    this.#index = this.#rootPosition();
  }

  #rootPosition() {
    const i = this.#slides.indexOf(this.#root);
    return i === -1 ? null : i;
  }

  get count() { return this.#slides.length; }
  get index() { return this.#index; }
  get current() { return this.#index === null ? null : this.#slides[this.#index]; }
  get hasNext() { return this.#index === null ? this.count > 0 : this.#index < this.count - 1; }
  get hasPrevious() { return this.#index !== null && this.#index > 0; }
  get isLast() { return this.#index !== null && this.#index === this.count - 1; }

  next() {
    if (!this.hasNext) return null;
    return this.jump(this.#index === null ? 0 : this.#index + 1);
  }

  previous() {
    if (!this.hasPrevious) return null;
    return this.jump(this.#index - 1);
  }

  jump(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.count) return null;
    this.#index = i;
    return this.#slides[i];
  }

  home() { this.#index = this.#rootPosition(); }

  label() { return this.#index === null ? '' : `${this.#index + 1} of ${this.count}`; }
}
