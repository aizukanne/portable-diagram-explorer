// Modal dialogs for the editor. While one is open the rest of the editor is inert;
// Escape cancels; focus returns to where it was.
import { h, button } from '../dom.js';

let dialogCount = 0;

// actions: [{ label, value, primary?, danger? }]. Resolves with the chosen value,
// or with `cancelValue` on Escape / Cancel.
export function showDialog({ title, body, actions, cancelValue = null, inertRoot, role = 'dialog', wide = false }) {
  return new Promise((resolve) => {
    dialogCount += 1;
    const id = `pde-dlg-${dialogCount}`;
    const before = document.activeElement;
    const scrim = h('div', { class: 'pde-dialog-scrim' });
    const finish = (v) => {
      dlg.removeEventListener('keydown', onKey);
      scrim.remove();
      dlg.remove();
      if (inertRoot) inertRoot.inert = false;
      if (before && before.isConnected && before.focus) before.focus();
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(cancelValue); }
      if (e.key === 'Tab') {
        const f = [...dlg.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')];
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    const dlg = h('div', { class: ['pde-dialog', wide && 'is-wide'], role, 'aria-modal': 'true', 'aria-labelledby': `${id}-t` },
      h('h2', { id: `${id}-t`, text: title }),
      h('div', { class: 'pde-dialog-body' }, body),
      h('div', { class: 'pde-dialog-actions' }, actions.map((a) => button(a.label, () => finish(typeof a.value === 'function' ? a.value() : a.value), { cls: [a.primary && 'pde-primary', a.danger && 'pde-danger'].filter(Boolean).join(' ') }))));
    dlg.addEventListener('keydown', onKey);
    if (inertRoot) inertRoot.inert = true;
    document.body.append(scrim, dlg);
    const first = dlg.querySelector('input, select, textarea') || dlg.querySelector('.pde-primary') || dlg.querySelector('button');
    if (first) first.focus();
  });
}
