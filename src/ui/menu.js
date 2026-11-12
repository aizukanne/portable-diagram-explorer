// The component menu: a keyboard-navigable role=menu popup (spec §5, §11).
import { h } from './dom.js';

export class ComponentMenu {
  constructor(layer) {
    this.layer = layer;
    this.el = h('div', { class: 'pde-menu', role: 'menu', hidden: true, tabindex: '-1' });
    this.layer.append(this.el);
    this.onClose = null;
    this.onDocDown = (e) => { if (!this.el.hidden && !this.el.contains(e.target)) this.close({ restoreFocus: false }); };
    document.addEventListener('pointerdown', this.onDocDown, true);
    this.el.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen() { return !this.el.hidden; }

  // items: [{ label, onSelect, current? }]; anchor: { x, y } in page (viewport) coordinates.
  open({ title, items, anchor, onClose }) {
    this.el.replaceChildren();
    this.el.setAttribute('aria-label', title);
    this.el.append(h('div', { class: 'pde-menu-title', 'aria-hidden': 'true', text: title }));
    this.items = items.map((it) => {
      const b = h('button', {
        type: 'button', role: 'menuitem', class: 'pde-menu-item', tabindex: '-1', text: it.label, 'aria-current': it.current ? 'true' : undefined,
        on: { click: () => { this.close({ restoreFocus: false }); it.onSelect(); } },
      });
      this.el.append(b);
      return b;
    });
    this.onClose = onClose || null;
    this.el.hidden = false;
    const w = this.el.offsetWidth;
    const hh = this.el.offsetHeight;
    const x = Math.max(4, Math.min(anchor.x, window.innerWidth - w - 4));
    const y = Math.max(4, Math.min(anchor.y, window.innerHeight - hh - 4));
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (this.items[0]) this.items[0].focus(); else this.el.focus();
  }

  close({ restoreFocus = true } = {}) {
    if (this.el.hidden) return false;
    this.el.hidden = true;
    this.el.replaceChildren();
    const cb = this.onClose;
    this.onClose = null;
    if (cb) cb({ restoreFocus });
    return true;
  }

  onKey(e) {
    const i = this.items.indexOf(document.activeElement);
    const n = this.items.length;
    const go = (k) => { e.preventDefault(); if (n) this.items[(k + n) % n].focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(n - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close({ restoreFocus: true }); }
    else if (e.key === 'Tab') { e.preventDefault(); this.close({ restoreFocus: true }); }
  }

  destroy() {
    document.removeEventListener('pointerdown', this.onDocDown, true);
    this.el.remove();
  }
}
