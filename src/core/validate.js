// Structural + semantic validation and schema migration (spec §9, design D5).
//
// validateProject never throws on bad data: it returns every problem it can find,
// each as a self-sufficient Issue (code, severity, path, received, expected, why,
// fix). Errors block export; warnings inform.
import { PROJECT_SCHEMA } from './project-schema.js';
import { validateSchema, makeIssue } from './schema.js';

export const SCHEMA_VERSION = 2;
export const LARGE_IMAGE_SIDE = 4096;
export const MAX_DECODED_PIXELS = 100_000_000;
const EPS = 1e-9;

export function parseProjectJson(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      project: null,
      issues: [makeIssue('E_JSON_SYNTAX', 'project.json', String(e.message),
        'well-formed JSON (UTF-8)', 'The project file must be readable JSON before anything in it can be checked.',
        `Fix the JSON syntax error reported by the parser: ${e.message}`)],
    };
  }
  return migrate(raw);
}

export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { project: null, issues: [makeIssue('E_SCHEMA_TYPE', '(project)', raw, 'a JSON object', 'A project file is a single JSON object.', 'Supply the project.json of a Portable Diagram Explorer project.')] };
  }
  const v = raw.schemaVersion;
  if (!Number.isInteger(v) || v < 1) {
    return { project: null, issues: [makeIssue('E_SCHEMA_VERSION', 'schemaVersion', v, `an integer from 1 to ${SCHEMA_VERSION}`, 'The version says how to read the rest of the file.', `Set "schemaVersion": ${SCHEMA_VERSION} if this file was written for this format.`)] };
  }
  if (v > SCHEMA_VERSION) {
    return { project: null, issues: [makeIssue('E_FUTURE_SCHEMA', 'schemaVersion', v, `${SCHEMA_VERSION} or lower`,
      `This file was written by a newer version of the application (format ${v}); reading it with an older one could silently lose data.`,
      'Open it with the editor.html that was saved alongside it, or with a newer version of Portable Diagram Explorer.')] };
  }
  // Version 1 -> 2 only adds optional fields (sequence, SVG assets), so the step is the version bump.
  // Later versions add explicit, tested steps here.
  if (v === 1) return { project: { ...raw, schemaVersion: 2 }, issues: [], migratedFrom: 1 };
  return { project: raw, issues: [], migratedFrom: null };
}

function orderOf(hotspots) {
  return hotspots.map((h, i) => ({ h, i })).sort((a, b) => (a.h.zIndex - b.h.zIndex) || (a.i - b.i));
}

function contains(a, b) {
  return b.x >= a.x - EPS && b.y >= a.y - EPS && b.x + b.width <= a.x + a.width + EPS && b.y + b.height <= a.y + a.height + EPS;
}

export function validateProject(project) {
  const { issues: mig, project: p } = migrate(project);
  if (!p) return { errors: mig, warnings: [] };
  const all = validateSchema(PROJECT_SCHEMA, p);
  // Semantic checks need the structure; run them on whatever is well-formed enough.
  if (Array.isArray(p.diagrams) && Array.isArray(p.assets)) semantic(p, all);
  return {
    errors: all.filter((i) => i.severity === 'error'),
    warnings: all.filter((i) => i.severity === 'warning'),
  };
}

function semantic(p, out) {
  const seen = new Map();
  const claim = (id, path) => {
    if (typeof id !== 'string') return;
    if (seen.has(id)) {
      out.push(makeIssue('E_DUP_ID', path, id, 'an ID used nowhere else in the project',
        `IDs identify diagrams, assets, hotspots, actions and notes for links and saving; "${id}" is already used at ${seen.get(id)}.`,
        `Give this item a different ID, for example "${id}-2", and update anything that should point to it.`));
    } else seen.set(id, path);
  };
  claim(p.projectId, 'projectId');
  const assets = new Map();
  p.assets.forEach((a, i) => {
    if (!a || typeof a !== 'object') return;
    claim(a.id, `assets[${i}].id`);
    assets.set(a.id, a);
    if (Number.isInteger(a.width) && Number.isInteger(a.height)) {
      if (a.width * a.height > MAX_DECODED_PIXELS) {
        out.push(makeIssue('E_IMAGE_TOO_LARGE', `assets[${i}]`, `${a.width} x ${a.height}`, `at most ${MAX_DECODED_PIXELS / 1e6} million pixels`,
          'Decoding larger images can exhaust browser memory and fail on the recipient\'s computer.', 'Export a smaller image, or split the diagram into detail images.'));
      } else if (a.width > LARGE_IMAGE_SIDE || a.height > LARGE_IMAGE_SIDE) {
        out.push(makeIssue('W_LARGE_IMAGE', `assets[${i}]`, `${a.width} x ${a.height}`, `each side at most ${LARGE_IMAGE_SIDE} pixels`,
          'Very large images slow down opening and zooming, especially in presentations with many diagrams.', 'Consider a smaller export of the image, or split detail into child diagrams.', 'warning'));
      }
    }
  });
  const diagramIds = p.diagrams.filter((d) => d && typeof d.id === 'string').map((d) => d.id);
  const diagramList = diagramIds.slice(0, 8).map((d) => JSON.stringify(d)).join(', ') + (diagramIds.length > 8 ? ', …' : '');
  const usedAssets = new Set();

  p.diagrams.forEach((d, di) => {
    if (!d || typeof d !== 'object') return;
    const dp = `diagrams[${di}]`;
    claim(d.id, `${dp}.id`);
    if (typeof d.assetId === 'string') {
      usedAssets.add(d.assetId);
      if (!assets.has(d.assetId)) {
        out.push(makeIssue('E_ASSET_REF', `${dp}.assetId`, d.assetId, `one of the asset IDs: ${[...assets.keys()].slice(0, 8).map((a) => JSON.stringify(a)).join(', ') || '(no assets)'}`,
          'A diagram displays one image; without it there is nothing to show or click.', 'Choose an existing image for this diagram, or import the missing image file.'));
      }
    }
    if (d.alignmentReviewRequired === true) {
      out.push(makeIssue('E_ALIGN_REVIEW', `${dp}.alignmentReviewRequired`, true, 'false, after the hotspots have been checked against the new image',
        `The image of "${d.title}" was replaced with one of different dimensions, so hotspots may no longer sit over the right components.`,
        'Open the diagram, check every hotspot against the new image, then choose "Mark alignment reviewed".'));
    }
    const hs = Array.isArray(d.hotspots) ? d.hotspots : [];
    hs.forEach((h, hi) => {
      if (!h || typeof h !== 'object') return;
      const hp = `${dp}.hotspots[${hi}]`;
      claim(h.id, `${hp}.id`);
      const r = h.rect;
      if (r && [r.x, r.y, r.width, r.height].every(Number.isFinite)) {
        if (r.x + r.width > 1 + EPS || r.y + r.height > 1 + EPS) {
          out.push(makeIssue('E_RECT_BOUNDS', `${hp}.rect`, r, 'x + width <= 1 and y + height <= 1',
            'A hotspot must lie inside its image; outside it there is nothing to click.',
            `Move or shrink the region so it ends inside the image, for example width ${Math.max(0.001, +(1 - r.x).toFixed(4))}.`));
        }
      }
      const actions = Array.isArray(h.actions) ? h.actions : [];
      if (actions.length === 0) {
        out.push(makeIssue('E_NO_ACTIONS', `${hp}.actions`, '0 action(s)', 'at least one action: open a diagram or show a description',
          `"${h.label}" would be clickable but do nothing.`, 'Add an "Open diagram" or "Read description" action, or delete the hotspot.'));
      }
      actions.forEach((a, ai) => {
        if (!a || typeof a !== 'object') return;
        claim(a.id, `${hp}.actions[${ai}].id`);
        if (a.type === 'diagram' && typeof a.targetDiagramId === 'string' && !diagramIds.includes(a.targetDiagramId)) {
          out.push(makeIssue('E_TARGET_REF', `${hp}.actions[${ai}].targetDiagramId`, a.targetDiagramId, `one of the diagram IDs: ${diagramList}`,
            `"${a.label}" on "${h.label}" points at a diagram that is not in this project, so it would open nothing.`,
            'Choose an existing target diagram, or remove the action.'));
        }
      });
      if (h.defaultActionId !== undefined && h.defaultActionId !== null && !actions.some((a) => a && a.id === h.defaultActionId)) {
        out.push(makeIssue('E_DEFAULT_REF', `${hp}.defaultActionId`, h.defaultActionId,
          `null (show the menu) or one of this hotspot's action IDs: ${actions.map((a) => a && JSON.stringify(a.id)).join(', ') || '(none)'}`,
          'The default action is what a click performs; it must be one of the hotspot\'s own actions.', 'Pick one of this hotspot\'s actions as default, or choose "Show menu".'));
      }
      if (typeof h.tooltip === 'string' && h.tooltip.trim() === '') {
        out.push(makeIssue('W_EMPTY_TOOLTIP', `${hp}.tooltip`, h.tooltip, 'a short description shown on hover and focus',
          'Without a tooltip, viewers only see the label when they focus the component.', 'Add a few words describing the component.', 'warning'));
      }
    });
    const ordered = orderOf(hs.filter((h) => h && h.rect && [h.rect.x, h.rect.y, h.rect.width, h.rect.height].every(Number.isFinite) && Number.isFinite(h.zIndex)));
    ordered.forEach(({ h, i }, k) => {
      const cover = ordered.slice(k + 1).find((o) => contains(o.h.rect, h.rect));
      if (cover) {
        out.push(makeIssue('W_OBSCURED', `${dp}.hotspots[${i}]`, h.label, 'a region not completely covered by a higher hotspot',
          `"${h.label}" is completely covered by "${cover.h.label}", which receives every click there.`,
          'Raise its stacking order, move it, or shrink the covering hotspot. It is still reachable from the keyboard and the component list.', 'warning'));
      }
    });
    const ns = Array.isArray(d.annotations) ? d.annotations : [];
    ns.forEach((n, ni) => {
      if (!n || typeof n !== 'object') return;
      claim(n.id, `${dp}.annotations[${ni}].id`);
      if (Number.isFinite(n.x) && Number.isFinite(n.width) && n.x + n.width > 1 + EPS) {
        out.push(makeIssue('E_RECT_BOUNDS', `${dp}.annotations[${ni}]`, { x: n.x, width: n.width }, 'x + width <= 1',
          'A note must lie inside its image.', `Move the note left or narrow it to width ${Math.max(0.001, +(1 - n.x).toFixed(4))} or less.`));
      }
    });
  });

  const slides = p.sequence && Array.isArray(p.sequence.slides) ? p.sequence.slides : [];
  const slideSeen = new Set();
  slides.forEach((id, i) => {
    if (typeof id !== 'string') return;
    const sp = `sequence.slides[${i}]`;
    if (!diagramIds.includes(id)) {
      out.push(makeIssue('E_SEQ_UNKNOWN_DIAGRAM', sp, id, `the ID of a diagram in "diagrams": ${diagramList}`,
        'The running order lists the diagrams presented in sequence; one that does not exist cannot be shown.',
        'Choose an existing diagram ID for this entry, or remove the entry from the running order.'));
    } else if (slideSeen.has(id)) {
      out.push(makeIssue('E_SEQ_DUPLICATE', sp, id, 'each diagram at most once in sequence.slides',
        `"${id}" already appears earlier in the running order, so stepping through would show it twice.`,
        'Remove the repeated entry; a diagram appears in the running order at most once.'));
    }
    slideSeen.add(id);
  });

  if (typeof p.rootDiagramId === 'string' && !diagramIds.includes(p.rootDiagramId)) {
    out.push(makeIssue('E_ROOT_MISSING', 'rootDiagramId', p.rootDiagramId, `one of the diagram IDs: ${diagramList}`,
      'The presentation opens on the overview diagram; without it nothing can be shown.', 'Choose an existing diagram as the overview.'));
  } else if (typeof p.rootDiagramId === 'string') {
    const byId = new Map(p.diagrams.filter((d) => d && typeof d.id === 'string').map((d) => [d.id, d]));
    const seeds = [p.rootDiagramId, ...slides.filter((id) => typeof id === 'string' && byId.has(id))];
    const reached = new Set(seeds);
    const queue = [...reached];
    while (queue.length) {
      const d = byId.get(queue.shift());
      for (const h of (d && Array.isArray(d.hotspots) ? d.hotspots : [])) {
        for (const a of (h && Array.isArray(h.actions) ? h.actions : [])) {
          if (a && a.type === 'diagram' && byId.has(a.targetDiagramId) && !reached.has(a.targetDiagramId)) {
            reached.add(a.targetDiagramId); queue.push(a.targetDiagramId);
          }
        }
      }
    }
    p.diagrams.forEach((d, di) => {
      if (d && typeof d.id === 'string' && !reached.has(d.id)) {
        out.push(makeIssue('W_UNREACHABLE', `diagrams[${di}]`, d.title || d.id, 'a diagram that some hotspot opens, starting from the overview, or one listed in the running order',
          `No path of hotspots leads from the overview to "${d.title || d.id}", and it is not in the running order, so presentation viewers cannot reach it.`,
          'Add an "Open diagram" action that targets it, add it to the running order, or delete it if it is no longer needed.', 'warning'));
      }
    });
  }
  p.assets.forEach((a, i) => {
    if (a && typeof a.id === 'string' && !usedAssets.has(a.id)) {
      out.push(makeIssue('W_UNUSED_ASSET', `assets[${i}]`, a.path || a.id, 'an image that some diagram displays',
        'Unused images are left out of exports.', 'Assign the image to a diagram, or ignore this if it is intentional.', 'warning'));
    }
  });
}

