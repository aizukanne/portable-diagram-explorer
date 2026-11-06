// DOM construction without HTML strings (design D19). User text reaches the page
// only as textContent or attribute values, never as markup.

const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'text') el.textContent = v;
    else if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k === 'props') Object.assign(el, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function h(tag, attrs, ...children) {
  return append(apply(document.createElement(tag), attrs), children);
}

export function svg(tag, attrs, ...children) {
  return append(apply(document.createElementNS(SVG_NS, tag), attrs), children);
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

// An icon-and-label button. The label is always present for assistive technology;
// `iconOnly` hides it visually.
export function button(label, onClick, { cls, icon, iconOnly, title, disabled, attrs } = {}) {
  return h('button', {
    type: 'button',
    class: ['pde-btn', cls, iconOnly && 'pde-btn-icon'],
    title: title || (iconOnly ? label : undefined),
    'aria-label': iconOnly ? label : undefined,
    disabled: disabled || undefined,
    ...(attrs || {}),
    on: { click: onClick },
  }, icon ? h('span', { class: 'pde-icon', 'aria-hidden': 'true', text: icon }) : null, iconOnly ? null : h('span', { class: 'pde-btn-label', text: label }));
}
