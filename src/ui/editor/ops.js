// Pure model operations for the editor (spec §3, §5, §14.3; design D10, D20).
// Each operation mutates the project it is given; EditorStore always passes a
// fresh clone, so an operation either completes as one undoable step or is
// discarded. Nothing here touches the DOM or asset bytes.
import { newId } from '../../core/ids.js';
import { clampRect, roundRect } from '../../core/geometry.js';

const ASPECT_TOLERANCE = 0.005;

export function emptyProject(title = 'Untitled project') {
  return {
    schemaVersion: 1, projectId: newId('p'), title, rootDiagramId: '',
    assets: [], diagrams: [], settings: { tooltipDelayMs: 350, showHotspotHints: true },
  };
}

export function findDiagram(p, id) {
  const d = p.diagrams.find((x) => x.id === id);
  if (!d) throw new Error(`diagram ${id} not found`);
  return d;
}

export function findHotspot(p, dId, hId) {
  const h = findDiagram(p, dId).hotspots.find((x) => x.id === hId);
  if (!h) throw new Error(`hotspot ${hId} not found`);
  return h;
}

function dropUnusedAssets(p) {
  const used = new Set(p.diagrams.map((d) => d.assetId));
  p.assets = p.assets.filter((a) => used.has(a.id));
}

// asset: { id, mimeType, width, height, name } from the AssetManager.
export function addDiagramFromAsset(p, asset, title) {
  if (!p.assets.some((a) => a.id === asset.id)) {
    p.assets.push({ id: asset.id, path: `assets/${asset.id}.${{ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[asset.mimeType]}`, mimeType: asset.mimeType, width: asset.width, height: asset.height });
  }
  const d = { id: newId('d'), title: title || 'Untitled diagram', assetId: asset.id, description: '', hotspots: [], annotations: [] };
  p.diagrams.push(d);
  if (!p.rootDiagramId || !p.diagrams.some((x) => x.id === p.rootDiagramId)) p.rootDiagramId = d.id;
  return d.id;
}

export function updateDiagram(p, dId, patch) {
  const d = findDiagram(p, dId);
  if (patch.title !== undefined) d.title = patch.title;
  if (patch.description !== undefined) d.description = patch.description;
}

export function setRoot(p, dId) { findDiagram(p, dId); p.rootDiagramId = dId; }

export function referencesTo(p, dId) {
  const out = [];
  for (const d of p.diagrams) for (const h of d.hotspots) for (const a of h.actions) {
    if (a.type === 'diagram' && a.targetDiagramId === dId) out.push({ diagramId: d.id, diagramTitle: d.title, hotspotId: h.id, hotspotLabel: h.label, actionId: a.id, actionLabel: a.label });
  }
  return out;
}

// Deleting a diagram that others link to needs an explicit decision (spec §14.3):
// { mode: 'retarget', to } points every such action elsewhere; { mode: 'removeActions' }
// deletes them. `newRoot` is required when deleting the overview while others remain.
export function removeDiagram(p, dId, decision = {}, newRoot) {
  findDiagram(p, dId);
  const refs = referencesTo(p, dId).filter((r) => r.diagramId !== dId);
  if (refs.length) {
    if (decision.mode === 'retarget') {
      findDiagram(p, decision.to);
      if (decision.to === dId) throw new Error('cannot retarget to the diagram being deleted');
    } else if (decision.mode !== 'removeActions') {
      throw new Error(`diagram ${dId} is linked from ${refs.length} action(s); choose retarget or removeActions`);
    }
  }
  for (const d of p.diagrams) for (const h of d.hotspots) {
    if (decision.mode === 'retarget') {
      for (const a of h.actions) if (a.type === 'diagram' && a.targetDiagramId === dId) a.targetDiagramId = decision.to;
    } else {
      const gone = new Set(h.actions.filter((a) => a.type === 'diagram' && a.targetDiagramId === dId).map((a) => a.id));
      if (gone.size) {
        h.actions = h.actions.filter((a) => !gone.has(a.id));
        if (gone.has(h.defaultActionId)) h.defaultActionId = null;
      }
    }
  }
  p.diagrams = p.diagrams.filter((d) => d.id !== dId);
  if (p.rootDiagramId === dId) {
    if (newRoot) findDiagram(p, newRoot);
    p.rootDiagramId = newRoot || (p.diagrams[0] ? p.diagrams[0].id : '');
  }
  dropUnusedAssets(p);
}

// Replace a diagram's image. Hotspots are kept (they are normalized). A different
// aspect ratio means they may no longer cover the same components: the diagram is
// flagged and export is blocked until the author reviews it (design D20).
export function replaceAsset(p, dId, asset) {
  const d = findDiagram(p, dId);
  const old = p.assets.find((a) => a.id === d.assetId);
  if (!p.assets.some((a) => a.id === asset.id)) {
    p.assets.push({ id: asset.id, path: `assets/${asset.id}.${{ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[asset.mimeType]}`, mimeType: asset.mimeType, width: asset.width, height: asset.height });
  }
  d.assetId = asset.id;
  const ratioOld = old ? old.width / old.height : asset.width / asset.height;
  const ratioNew = asset.width / asset.height;
  const aspectChanged = Math.abs(ratioNew / ratioOld - 1) > ASPECT_TOLERANCE;
  const sizeChanged = !old || old.width !== asset.width || old.height !== asset.height;
  if (aspectChanged && (d.hotspots.length || d.annotations.length)) d.alignmentReviewRequired = true;
  dropUnusedAssets(p);
  return { aspectChanged, sizeChanged, from: old ? `${old.width} x ${old.height}` : null, to: `${asset.width} x ${asset.height}` };
}

export function markAlignmentReviewed(p, dId) { delete findDiagram(p, dId).alignmentReviewRequired; }

const nextZ = (d) => d.hotspots.reduce((m, h) => Math.max(m, h.zIndex), 0) + 1;

export function addHotspot(p, dId, rect) {
  const d = findDiagram(p, dId);
  const h = { id: newId('h'), label: `Component ${d.hotspots.length + 1}`, tooltip: '', rect: roundRect(clampRect(rect)), zIndex: nextZ(d), defaultActionId: null, actions: [] };
  d.hotspots.push(h);
  return h.id;
}

export function duplicateHotspot(p, dId, hId) {
  const d = findDiagram(p, dId);
  const src = findHotspot(p, dId, hId);
  const copy = structuredClone(src);
  copy.id = newId('h');
  copy.label = `${src.label} (copy)`.slice(0, 120);
  const idMap = new Map();
  for (const a of copy.actions) { const nid = newId('act'); idMap.set(a.id, nid); a.id = nid; }
  copy.defaultActionId = src.defaultActionId ? idMap.get(src.defaultActionId) : null;
  const off = 0.02;
  copy.rect = roundRect(clampRect({ ...src.rect, x: src.rect.x + off, y: src.rect.y + off }));
  copy.zIndex = nextZ(d);
  d.hotspots.push(copy);
  return copy.id;
}

export function deleteHotspot(p, dId, hId) {
  const d = findDiagram(p, dId);
  findHotspot(p, dId, hId);
  d.hotspots = d.hotspots.filter((h) => h.id !== hId);
}

export function updateHotspot(p, dId, hId, patch) {
  const h = findHotspot(p, dId, hId);
  if (patch.label !== undefined) h.label = patch.label;
  if (patch.tooltip !== undefined) h.tooltip = patch.tooltip;
}

export function setRect(p, dId, hId, rect) {
  findHotspot(p, dId, hId).rect = roundRect(clampRect(rect));
}

// Reorder stacking: 'up'/'down' swap with the neighbour; 'top'/'bottom' move to the end.
export function moveZ(p, dId, hId, where) {
  const d = findDiagram(p, dId);
  const order = d.hotspots.map((h, i) => ({ h, i })).sort((a, b) => (a.h.zIndex - b.h.zIndex) || (a.i - b.i)).map((x) => x.h);
  const i = order.findIndex((h) => h.id === hId);
  if (i < 0) throw new Error(`hotspot ${hId} not found`);
  const [h] = order.splice(i, 1);
  const j = where === 'top' ? order.length : where === 'bottom' ? 0 : where === 'up' ? Math.min(order.length, i + 1) : Math.max(0, i - 1);
  order.splice(j, 0, h);
  order.forEach((x, k) => { x.zIndex = k + 1; });
}

export function addAction(p, dId, hId, action) {
  const h = findHotspot(p, dId, hId);
  const a = action.type === 'diagram'
    ? { id: newId('act'), label: action.label || 'Open diagram', type: 'diagram', targetDiagramId: action.targetDiagramId }
    : { id: newId('act'), label: action.label || 'Read description', type: 'details', text: action.text || 'Description' };
  if (a.type === 'diagram') findDiagram(p, a.targetDiagramId);
  h.actions.push(a);
  if (h.actions.length === 1 && !h.defaultActionId) h.defaultActionId = a.id;
  return a.id;
}

export function updateAction(p, dId, hId, aId, patch) {
  const a = findHotspot(p, dId, hId).actions.find((x) => x.id === aId);
  if (!a) throw new Error(`action ${aId} not found`);
  if (patch.label !== undefined) a.label = patch.label;
  if (a.type === 'diagram' && patch.targetDiagramId !== undefined) { findDiagram(p, patch.targetDiagramId); a.targetDiagramId = patch.targetDiagramId; }
  if (a.type === 'details' && patch.text !== undefined) a.text = patch.text;
}

export function removeAction(p, dId, hId, aId) {
  const h = findHotspot(p, dId, hId);
  h.actions = h.actions.filter((a) => a.id !== aId);
  if (h.defaultActionId === aId) h.defaultActionId = null;
}

export function moveAction(p, dId, hId, aId, delta) {
  const h = findHotspot(p, dId, hId);
  const i = h.actions.findIndex((a) => a.id === aId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= h.actions.length) return;
  const [a] = h.actions.splice(i, 1);
  h.actions.splice(j, 0, a);
}

export function setDefaultAction(p, dId, hId, aId) {
  const h = findHotspot(p, dId, hId);
  if (aId !== null && !h.actions.some((a) => a.id === aId)) throw new Error(`action ${aId} not on hotspot ${hId}`);
  h.defaultActionId = aId;
}

export function addAnnotation(p, dId, at) {
  const d = findDiagram(p, dId);
  const width = 0.25;
  const n = { id: newId('n'), text: 'Note', x: Math.min(Math.max(0, at.x), 1 - width), y: Math.min(Math.max(0, at.y), 0.98), width };
  n.x = Math.round(n.x * 1e6) / 1e6;
  n.y = Math.round(n.y * 1e6) / 1e6;
  d.annotations.push(n);
  return n.id;
}

export function updateAnnotation(p, dId, nId, patch) {
  const n = findDiagram(p, dId).annotations.find((x) => x.id === nId);
  if (!n) throw new Error(`note ${nId} not found`);
  if (patch.text !== undefined) n.text = patch.text;
  if (patch.width !== undefined) n.width = Math.min(Math.max(0.02, patch.width), 1);
  if (patch.x !== undefined) n.x = Math.min(Math.max(0, patch.x), 1);
  if (patch.y !== undefined) n.y = Math.min(Math.max(0, patch.y), 0.995);
  if (n.x + n.width > 1) n.x = Math.max(0, 1 - n.width);
}

export function deleteAnnotation(p, dId, nId) {
  const d = findDiagram(p, dId);
  d.annotations = d.annotations.filter((n) => n.id !== nId);
}

export function updateProjectMeta(p, patch) {
  if (patch.title !== undefined) p.title = patch.title;
  if (patch.tooltipDelayMs !== undefined) p.settings = { ...(p.settings || {}), tooltipDelayMs: patch.tooltipDelayMs };
  if (patch.showHotspotHints !== undefined) p.settings = { ...(p.settings || {}), showHotspotHints: patch.showHotspotHints };
}
