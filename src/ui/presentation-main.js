// Presentation entry: the viewer over the project embedded in this file (design D7).
// The data block is parsed as JSON (never executed) and fully validated before use.
import { h } from './dom.js';
import { Viewer } from './viewer.js';
import { issueList } from './issues-view.js';
import { readPresentationData } from '../core/package.js';

const root = document.getElementById('pde-root');
const block = document.getElementById('pde-data');
const r = readPresentationData(block ? block.textContent : null, { decodeAssets: false });
const errors = r.issues.filter((i) => i.severity === 'error');
if (!r.project || errors.length) {
  root.append(h('div', { class: 'pde-fatal' },
    h('h1', { text: 'This presentation cannot be shown' }),
    h('p', { text: 'Its embedded project data failed validation. Nothing has been changed. Export the presentation again from the editor, or send the details below to its author.' }),
    issueList(errors.length ? errors : r.issues)));
} else {
  const assets = {
    url: (id) => assets.dataUrl(id),
    dataUrl: (id) => {
      const a = r.project.assets.find((x) => x.id === id);
      return `data:${a.mimeType};base64,${r.raw.assets[id].base64}`;
    },
  };
  window.__pdeViewer = new Viewer(root, r.project, assets);
}
