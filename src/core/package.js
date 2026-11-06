// Project packages and portable presentations (spec §10, design D6–D8).
//
// Two formats:
//   name.diagram.zip         project.json + assets/* (original bytes) + editor.html + README.txt
//   name.presentation.html   viewer runtime + one inert JSON block with project and image bytes
// Readers return { project|null, assets: Map<assetId, Uint8Array>, issues }. A project
// is returned only when it is structurally sound and every image is present and of
// its declared type; semantic problems (dangling links, alignment review) are
// returned as issues alongside it so the author can fix them in the editor.
import { readZip, writeZip, ZipError } from './zip.js';
import { parseProjectJson, validateProject, migrate } from './validate.js';
import { makeIssue } from './schema.js';
import { sniffImage, slug } from './sniff.js';
import { jsonForHtml, extractJsonBlock } from './embed.js';
import { referencedAssetIds } from './envelope.js';

export const PRESENTATION_FORMAT = 'pde-presentation';
export const PRESENTATION_FORMAT_VERSION = 1;
const DATA_PLACEHOLDER = '__PDE_' + 'DATA__';
const TITLE_PLACEHOLDER = '__PDE_' + 'TITLE__';

const README = (title, version) => `Portable Diagram Explorer project: ${title}

This archive is an editable project (format: project.json schemaVersion 1;
written by Portable Diagram Explorer ${version}).

To continue editing:
  1. Extract this archive, or keep it as it is.
  2. Open editor.html in Chrome, Edge, Firefox or Safari (double-click it).
     No installation, server or internet connection is needed.
  3. Choose "Open" and select this .diagram.zip file. You can also select
     project.json together with every file in the assets folder.

To present: in the editor choose "Export presentation". The resulting
.presentation.html is a single file that opens offline by double-clicking.

Contents:
  project.json   diagrams, hotspots, actions and notes (readable JSON)
  assets/        the original image files, unchanged
  editor.html    the editor that wrote this archive
  README.txt     this file
`;

const STRUCTURAL = /^E_(SCHEMA_|JSON_|FUTURE_SCHEMA|DUP_ID)/;

export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function escapeHtmlText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Deterministic package paths: assets/<assetId>-<slug>.<ext>, lowercased; a
// case-only collision between IDs gets a numeric suffix in project order.
export function assignAssetPaths(project) {
  const taken = new Set();
  return project.assets.map((a) => {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[a.mimeType] || 'bin';
    const name = a.path ? a.path.replace(/^.*\//, '') : '';
    const stem = slug(name.replace(new RegExp(`^${a.id.replace(/[^A-Za-z0-9]/g, '.')}-`, 'i'), ''), 40);
    let base = `${a.id.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}-${stem}`;
    let path = `assets/${base}.${ext}`;
    for (let n = 2; taken.has(path); n++) path = `assets/${base}-${n}.${ext}`;
    taken.add(path);
    return { ...a, path };
  });
}

export async function buildProjectZip(project, assetBytes, editorHtml, appVersion = '') {
  const copy = structuredClone(project);
  copy.assets = assignAssetPaths(copy);
  const enc = new TextEncoder();
  const entries = [{ name: 'project.json', bytes: enc.encode(`${JSON.stringify(copy, null, 2)}\n`) }];
  for (const a of copy.assets) {
    const b = assetBytes.get(a.id);
    if (!b) throw new Error(`asset ${a.id} has no bytes in memory; cannot save`);
    entries.push({ name: a.path, bytes: b, compress: false });
  }
  entries.push({ name: 'editor.html', bytes: enc.encode(editorHtml) });
  entries.push({ name: 'README.txt', bytes: enc.encode(README(copy.title, appVersion)) });
  return { bytes: await writeZip(entries), project: copy };
}

function decodeUtf8(bytes, path, issues) {
  try {
    let s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    return s;
  } catch {
    issues.push(makeIssue('E_JSON_SYNTAX', path, '(binary data)', 'UTF-8 text', 'project.json must be UTF-8 text.', 'Save project.json as UTF-8.'));
    return null;
  }
}

// Shared admission: structure first, then image bytes, then semantic issues.
function admit(project, getBytes, issues) {
  const v = validateProject(project);
  const structural = v.errors.filter((i) => STRUCTURAL.test(i.code));
  if (structural.length) { issues.push(...structural); return null; }
  const assets = new Map();
  project.assets.forEach((a, i) => {
    const got = getBytes(a, i);
    if (got.issue) { issues.push(got.issue); return; }
    const t = sniffImage(got.bytes);
    if (!t || t.mimeType !== a.mimeType) {
      issues.push(makeIssue('E_ASSET_TYPE', `assets[${i}]`, `${got.name}: ${t ? t.mimeType : 'not a PNG, JPEG or WebP image'}`, a.mimeType,
        'The file content must match the declared image type; a mismatch means the file was replaced or damaged.',
        `Replace ${got.name} with the original ${a.mimeType} file, or re-import the image in the editor.`));
      return;
    }
    assets.set(a.id, got.bytes);
  });
  if (assets.size !== project.assets.length) return null;
  issues.push(...v.errors, ...v.warnings);
  return assets;
}

export async function readProjectZip(bytes) {
  const issues = [];
  let files;
  try {
    files = await readZip(bytes);
  } catch (e) {
    if (e instanceof ZipError) {
      issues.push(makeIssue(`E_PKG_${e.code.slice(2)}`, e.entry || '(archive)', e.entry || '(archive)', 'a .diagram.zip saved by Portable Diagram Explorer', e.why, e.fix));
      return { project: null, assets: new Map(), issues };
    }
    throw e;
  }
  for (const name of files.keys()) {
    const ok = name === 'project.json' || name === 'README.txt' || name === 'editor.html' || /^assets\/[^/]+$/.test(name);
    if (!ok) {
      issues.push(makeIssue('E_PKG_UNEXPECTED_ENTRY', name, name, 'only project.json, README.txt, editor.html and files directly inside assets/',
        'Unexpected files could carry content this application must not run or silently drop.', `Remove "${name}" from the archive, or save the project again from the editor.`));
    }
  }
  if (issues.length) return { project: null, assets: new Map(), issues };
  if (!files.has('project.json')) {
    issues.push(makeIssue('E_PKG_NO_PROJECT', 'project.json', '(absent)', 'a project.json at the top of the archive',
      'project.json holds the diagrams, hotspots and links; without it there is no project.', 'Choose a .diagram.zip saved by the editor (not a folder of images).'));
    return { project: null, assets: new Map(), issues };
  }
  const text = decodeUtf8(files.get('project.json'), 'project.json', issues);
  if (text === null) return { project: null, assets: new Map(), issues };
  const parsed = parseProjectJson(text);
  if (!parsed.project) return { project: null, assets: new Map(), issues: parsed.issues };
  const project = parsed.project;
  const referenced = new Set();
  const assets = admit(project, (a) => {
    referenced.add(a.path);
    const b = files.get(a.path);
    if (!b) {
      return { issue: makeIssue('E_PKG_MISSING_ASSET', a.path, '(absent)', `the image file ${a.path} inside the archive`,
        `Diagram images are stored as separate files; "${a.path}" is listed in project.json but is not in the archive.`,
        `Add the original image as ${a.path}, or open the project in the editor that saved it and save again.`) };
    }
    return { bytes: b, name: a.path };
  }, issues);
  if (!assets) return { project: null, assets: new Map(), issues };
  for (const name of files.keys()) {
    if (name.startsWith('assets/') && !referenced.has(name)) {
      issues.push(makeIssue('W_PKG_EXTRA_FILE', name, name, 'only images listed in project.json', 'Files no asset refers to are ignored.', 'Remove the file, or ignore this if it is intentional.', 'warning'));
    }
  }
  return { project, assets, issues };
}

// files: [{ name, relativePath, bytes }] chosen together with the file picker.
export function readLooseFiles(files) {
  const issues = [];
  const projects = files.filter((f) => f.name === 'project.json');
  if (projects.length !== 1) {
    issues.push(makeIssue('E_PKG_NO_PROJECT', 'project.json', `${projects.length} file(s) named project.json`, 'exactly one project.json, selected together with its images',
      'project.json says which image belongs to which diagram.', 'Select project.json and every file from its assets folder together.'));
    return { project: null, assets: new Map(), issues };
  }
  const text = decodeUtf8(projects[0].bytes, 'project.json', issues);
  if (text === null) return { project: null, assets: new Map(), issues };
  const parsed = parseProjectJson(text);
  if (!parsed.project) return { project: null, assets: new Map(), issues: parsed.issues };
  const project = parsed.project;
  const images = files.filter((f) => f !== projects[0]);
  const assets = admit(project, (a) => {
    const byPath = images.filter((f) => f.relativePath && (f.relativePath === a.path || f.relativePath.endsWith(`/${a.path}`)));
    if (byPath.length === 1) return { bytes: byPath[0].bytes, name: byPath[0].relativePath };
    const base = a.path.replace(/^.*\//, '');
    const byName = images.filter((f) => f.name === base);
    if (byName.length === 1) return { bytes: byName[0].bytes, name: byName[0].name };
    if (byName.length > 1 || byPath.length > 1) {
      return { issue: makeIssue('E_AMBIGUOUS_ASSET', a.path, `${Math.max(byName.length, byPath.length)} files named ${base}`, `exactly one file for ${a.path}`,
        'Two selected files share a name, and choosing one silently could attach the wrong image.', 'Select the project folder (so paths decide), or remove the duplicate file from the selection.') };
    }
    return { issue: makeIssue('E_PKG_MISSING_ASSET', a.path, '(not selected)', `the file ${base}`,
      `project.json lists "${a.path}", but no selected file has that name.`, `Select ${base} together with project.json.`) };
  }, issues);
  if (!assets) return { project: null, assets: new Map(), issues };
  return { project, assets, issues };
}

export function buildPresentationHtml(template, project, assetBytes, appVersion) {
  const v = validateProject(project);
  if (v.errors.length) throw new Error(`cannot export a project with ${v.errors.length} error(s): ${v.errors.map((e) => e.code).join(', ')}`);
  if (template.split(DATA_PLACEHOLDER).length !== 2 || template.split(TITLE_PLACEHOLDER).length !== 2) throw new Error('presentation template placeholders are missing or duplicated');
  const used = referencedAssetIds(project);
  const copy = structuredClone(project);
  copy.assets = assignAssetPaths({ ...copy, assets: copy.assets.filter((a) => used.has(a.id)) });
  const assets = {};
  for (const a of copy.assets) assets[a.id] = { mimeType: a.mimeType, base64: bytesToBase64(assetBytes.get(a.id)) };
  const data = { format: PRESENTATION_FORMAT, formatVersion: PRESENTATION_FORMAT_VERSION, appVersion, project: copy, assets };
  return template.split(TITLE_PLACEHOLDER).join(escapeHtmlText(project.title)).split(DATA_PLACEHOLDER).join(jsonForHtml(data));
}

export function readPresentationData(raw) {
  const issues = [];
  const bad = (code, received, why, fix) => { issues.push(makeIssue(code, 'presentation', received, `a .presentation.html exported by Portable Diagram Explorer (format ${PRESENTATION_FORMAT_VERSION})`, why, fix)); return { project: null, assets: new Map(), issues }; };
  if (raw === null) return bad('E_PRES_NO_DATA', '(no embedded project data)', 'Only presentations exported by this application carry the project data needed for editing.', 'Choose a .presentation.html exported by Portable Diagram Explorer, or the project\'s .diagram.zip.');
  let data;
  try { data = JSON.parse(raw); } catch (e) { return bad('E_JSON_SYNTAX', e.message, 'The embedded project data is damaged.', 'Export the presentation again from the editor.'); }
  if (!data || data.format !== PRESENTATION_FORMAT) return bad('E_PRES_FORMAT', data && data.format, 'The embedded data is not a Portable Diagram Explorer presentation.', 'Choose a presentation exported by this application.');
  if (data.formatVersion !== PRESENTATION_FORMAT_VERSION) {
    return bad(data.formatVersion > PRESENTATION_FORMAT_VERSION ? 'E_FUTURE_SCHEMA' : 'E_PRES_FORMAT', data.formatVersion,
      'The presentation was written in a format version this editor does not read.', 'Open it with a matching or newer version of the editor.');
  }
  const { project, issues: mig } = migrate(data.project);
  if (!project) return { project: null, assets: new Map(), issues: mig };
  const embedded = data.assets && typeof data.assets === 'object' ? data.assets : {};
  const assets = admit(project, (a) => {
    const e = embedded[a.id];
    if (!e || typeof e.base64 !== 'string') {
      return { issue: makeIssue('E_PKG_MISSING_ASSET', `assets.${a.id}`, '(absent)', `embedded bytes for image ${a.id}`, 'The presentation must carry every image it shows.', 'Export the presentation again from the editor.') };
    }
    try { return { bytes: base64ToBytes(e.base64), name: a.path }; } catch {
      return { issue: makeIssue('E_PKG_CORRUPT', `assets.${a.id}`, '(invalid base64)', 'base64-encoded image bytes', 'The embedded image data is damaged.', 'Export the presentation again from the editor.') };
    }
  }, issues);
  if (!assets) return { project: null, assets: new Map(), issues };
  return { project, assets, issues, appVersion: data.appVersion };
}

export function readPresentationHtml(text) {
  return readPresentationData(extractJsonBlock(text, 'pde-data'));
}
