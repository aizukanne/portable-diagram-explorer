// Renders validation/import issues as a readable list (house rule: every
// rejection names the field, the value, the accepted form, why, and the fix).
import { h } from './dom.js';

export function issueList(issues, { onGoTo } = {}) {
  return h('ul', { class: 'pde-issues' }, issues.map((i) => h('li', { class: ['pde-issue', `is-${i.severity}`] },
    h('div', { class: 'pde-issue-head' },
      h('span', { class: 'pde-issue-sev', text: i.severity === 'error' ? 'Error' : 'Warning' }),
      h('code', { class: 'pde-issue-code', text: i.code }),
      h('code', { class: 'pde-issue-path', text: i.path }),
      onGoTo && i.goTo ? h('button', { type: 'button', class: 'pde-btn pde-link', text: 'Go to', on: { click: () => onGoTo(i.goTo) } }) : null),
    h('dl', { class: 'pde-issue-body' },
      h('dt', { text: 'Received' }), h('dd', { text: i.received }),
      h('dt', { text: 'Expected' }), h('dd', { text: i.expected }),
      h('dt', { text: 'Why' }), h('dd', { text: i.why }),
      h('dt', { text: 'Fix' }), h('dd', { text: i.fix })))));
}
