// Editor file input/output (spec §10): user-selected files only, downloads only.
// Nothing is fetched; nothing is written except through the browser's download.
import { jsonForHtml } from '../../core/embed.js';
import { sniffFileKind } from '../../core/sniff.js';
import { readProjectZip, readLooseFiles, readPresentationHtml } from '../../core/package.js';
import { makeIssue } from '../../core/schema.js';

const SELF_MARK = '__PDE_' + 'SELF__';

export async function readFiles(fileList) {
  return Promise.all([...fileList].map(async (f) => ({
    name: f.name,
    relativePath: f.webkitRelativePath || '',
    bytes: new Uint8Array(await f.arrayBuffer()),
  })));
}

// This editor's own exact bytes (design D6), for inclusion in saved packages.
export function editorSelfHtml() {
  const el = document.getElementById('pde-self');
  if (!el) throw new Error('editor self-copy is missing from this build');
  const tpl = JSON.parse(el.textContent);
  const open = '<' + 'script type="application/json" id="pde-self">';
  const close = '<' + '/script>';
  // Function replacement: the template contains "$'" sequences a string would expand.
  return tpl.replace(SELF_MARK, () => open + jsonForHtml(tpl) + close);
}

export function download(name, data, mimeType) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Decide what the user selected and read it. Returns one of:
//   { kind: 'project', project, assets, issues, source }
//   { kind: 'images', files }
//   { kind: 'error', issues }
export async function interpretSelection(files) {
  if (!files.length) return { kind: 'error', issues: [] };
  const kinds = files.map((f) => sniffFileKind(f.bytes));
  if (files.length === 1 && kinds[0] === 'zip') return { kind: 'project', source: files[0].name, ...(await readProjectZip(files[0].bytes)) };
  if (files.length === 1 && kinds[0] === 'html') {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(files[0].bytes); } catch {
      return { kind: 'error', issues: [makeIssue('E_PRES_FORMAT', files[0].name, '(not UTF-8 text)', 'a .presentation.html exported by this application', 'The file is not readable text.', 'Choose the exported presentation file.')] };
    }
    return { kind: 'project', source: files[0].name, ...readPresentationHtml(text) };
  }
  if (files.some((f) => f.name === 'project.json')) return { kind: 'project', source: 'project.json', ...readLooseFiles(files) };
  if (kinds.every((k) => k === 'image')) return { kind: 'images', files };
  const bad = files.filter((f, i) => kinds[i] !== 'image');
  return {
    kind: 'error',
    issues: bad.map((f) => makeIssue('E_OPEN_UNSUPPORTED', f.name, f.name,
      'a .diagram.zip project, a .presentation.html, project.json with its images, or PNG/JPEG/WebP/SVG images',
      'Only these files can be opened; other content is never interpreted.', 'Choose one of the accepted files.')),
  };
}
