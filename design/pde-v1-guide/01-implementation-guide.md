# Portable Diagram Explorer v1 — implementation guide

**Epic:** milestone `PDE v1 — portable diagram explorer`
**Spec:** `docs/superpowers/specs/2026-11-06-portable-diagram-explorer-spec.md` (Part 1, owner-authored)
+ `docs/superpowers/specs/2026-11-06-portable-diagram-explorer-design.md` (Part 2, **not owner-reviewed**)
**Plan:** `docs/superpowers/plans/2026-11-06-pde-v1.md`
**Workplan:** `design/pde-v1-guide/02-workplan.md`
**Status:** building

This guide answers "how" at the file-and-function level. Decision numbers (D#) and measured rules
(MR#) refer to the design document.

## 1. Module contracts

### src/core/ids.js
- `newId(prefix: 'p'|'d'|'a'|'h'|'act'|'n'|'v'): string` — `${prefix}-${12 chars [a-z2-7]}`.
- `ID_PATTERN: RegExp` — `/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`.

### src/core/schema.js
- `validateSchema(schema, value, path = ''): Issue[]` — supports `type` (object, array, string, number,
  integer, boolean, null, and arrays of types), `properties`, `required`, `additionalProperties:false`,
  `enum`, `const`, `minimum`, `maximum`, `exclusiveMinimum`, `minLength`, `maxLength`, `pattern`,
  `items`, `minItems`, `maxItems`, `$ref` to `#/$defs/*`. Any other keyword in the schema throws at
  load time (never silently ignored). Non-finite numbers fail `type:number`.
- `Issue = {code, severity, path, received, expected, why, fix}`.

### src/core/validate.js
- `SCHEMA_VERSION = 1`.
- `validateProject(project): {errors: Issue[], warnings: Issue[]}` — runs the structural schema,
  then semantic rules:
  - E_DUP_ID: duplicate IDs (across every collection).
  - E_ROOT_MISSING: root diagram missing.
  - E_ASSET_REF: missing asset reference.
  - E_TARGET_REF: dangling `targetDiagramId`.
  - E_DEFAULT_REF: `defaultActionId` that is not one of the hotspot's actions.
  - E_RECT_BOUNDS: `x+width > 1` or `y+height > 1`, with a 1e-9 tolerance.
  - E_ALIGN_REVIEW: `alignmentReviewRequired`.
  - E_NO_ACTIONS: a hotspot with zero actions.
  - W_OBSCURED: a hotspot fully covered by a higher-z hotspot.
  - W_UNREACHABLE: a diagram not reachable from the root.
  - W_LARGE_IMAGE: either side over 4096.
  - W_EMPTY_TOOLTIP.
- `migrate(raw): {project, issues}` — `schemaVersion` greater than 1 gives E_FUTURE_SCHEMA. A
  missing or non-integer version gives E_SCHEMA_VERSION. Version 1 passes through.
- `parseProjectJson(text): {project|null, issues}` — reports JSON syntax errors with the position.

### src/core/geometry.js
- `fitScale(W, H, availW, availH): number`.
- `viewTransform(W, H, availW, availH, {cx, cy, zoom}): {s, tx, ty}` — `s = fit*zoom`;
  `tx = availW/2 - cx*W*s`; `ty = availH/2 - cy*H*s`.
- `screenToImage(t, sx, sy): {x, y}` and `imageToScreen(t, x, y)`.
- `zoomAt(state, W, H, availW, availH, factor, sx, sy): state` — keeps the image point under (sx, sy)
  fixed; zoom is clamped to [0.25, 16].
- `panBy(state, W, H, availW, availH, dx, dy): state`.
- `clampRect({x, y, width, height}, minSize = 0.002): rect` — inside [0,1], positive size.
- `normRectFromPoints(p1, p2)`.
- `rectContainsRect(a, b)`.

### src/core/navigation.js
- `class NavStack` — `constructor(cap = 64)`.
  - `open(diagramId, overviewState)` → first visit.
  - `push(diagramId, currentState): {ok, visit} | {ok:false, reason:'cap'}`.
  - `back(): {closed:boolean, entry}`.
  - `jump(visitId)`.
  - `close(): overviewState`.
  - `current()`, `breadcrumbs(): [{visitId, diagramId}]`.
  - `updateCurrent(partialState)`.
- `Entry = {visitId, diagramId, viewport, selectedHotspotId, details}`, where `details` is
  `{hotspotId, actionId}` or `{diagram:true}` or `null`.

### src/core/protocol.js
- `PROTOCOL = 1`.
- Builders: `msg(type, fields)`.
- `validateChildMessage(m, {channel, lastSeq, sceneToken}): {ok, reason}` — the type must be one of
  READY, SCENE_READY, ACTIVATE_HOTSPOT, VIEWPORT_CHANGED, KEY, and fields must match the exact
  whitelist:
  - READY {}
  - SCENE_READY {sceneToken}
  - ACTIVATE_HOTSPOT {sceneToken, hotspotId, mode: 'default'|'menu', anchor:{x,y}}
  - VIEWPORT_CHANGED {sceneToken, viewport:{cx,cy,zoom}, selectedHotspotId|null}
  - KEY {key: 'Escape'|'Back'|'Fit'|'ZoomIn'|'ZoomOut'}
- `validateParentMessage(m, {channel, lastSeq})` — the type must be RENDER_SCENE or COMMAND:
  - RENDER_SCENE {sceneToken, scene:{title, width, height, hotspots:[{id, label, tooltip, rect, zIndex, hasMenu}], annotations:[{id, text, x, y, width}]}, image:{dataUrl}, viewport, selectedHotspotId, settings:{tooltipDelayMs, showHotspotHints}}
  - COMMAND {sceneToken, command: 'fit'|'zoomIn'|'zoomOut'|'hideTooltip'|'focusFirst'}

### src/core/crc32.js, src/core/zip.js
- `crc32(bytes): number`.
- `async writeZip(entries: [{name, bytes, compress?: boolean}]): Uint8Array` — local headers +
  central directory + EOCD. Fixed DOS time 1980-01-01, so output is deterministic. UTF-8 flag bit 11.
  Deflate is used only when smaller.
- `async readZip(bytes, limits = DEFAULT_LIMITS): Map<name, Uint8Array>` — parses the EOCD and
  central directory and cross-checks the local headers. Throws `ZipError{code, entry, why, fix}` for
  each D11 rejection: Z_NOT_ZIP, Z_ZIP64, Z_ENCRYPTED, Z_METHOD, Z_TRAVERSAL, Z_ABSOLUTE, Z_DUPLICATE,
  Z_TOO_MANY, Z_TOO_LARGE, Z_RATIO, Z_CRC, Z_TRUNCATED, Z_UNEXPECTED_ENTRY. The allowed-entry check
  is done by `package.js`, not the codec.

### src/core/sniff.js
- `sniffImage(bytes): {mimeType, ext} | null`.
- `slug(name)`.

### src/core/embed.js
- `jsonForHtml(value): string` — `JSON.stringify` with `<`, `>`, `&`, U+2028 and U+2029 escaped.
- `extractJsonBlock(htmlText, id): string|null` — parses with `DOMParser` in the browser, or a strict
  tag scan in Node; nothing executes.

### src/core/package.js
- `async buildProjectZip(project, assetBytes: Map<assetId, Uint8Array>, editorHtml: string): Uint8Array`
  — rewrites `asset.path` deterministically (D8) on a copy and adds README.txt.
- `async readProjectZip(bytes): {project, assets: Map, issues}`.
- `readLooseFiles(files: [{name, relativePath, bytes}]): {project, assets, issues}` — matches paths
  first, then unique basenames, and gives E_AMBIGUOUS_ASSET for a duplicate basename.
- `buildPresentationHtml(template, project, assetBytes, appVersion): string` — only referenced assets
  are included.
- `readPresentationHtml(text): {project, assets, issues}`.
- `measureEnvelope(project, assetBytes): {diagrams, hotspots, maxPerScene, imageBytes, warnings}`.

### src/ui/renderer.js — `class SceneRenderer`
- `constructor(host: HTMLElement, {mode: 'present'|'edit', onActivate(hotspotId, mode, anchor), onViewport(state), onSelect(hotspotId), onKey(key), tooltipDelayMs, showHints})`.
- `setScene(scene, imageUrl, viewport?, selectedHotspotId?)` returns a Promise that resolves after the
  image decodes.
- `getViewport()`, `setViewport()`, `fit()`, `zoomBy(f)`, `focusHotspot(id)`, `hideTooltip()`,
  `destroy()`.
- Edit mode adds `setTool('select'|'hotspot'|'annotation')`, the `onEditGesture(kind, payload)`
  callback, and handles (8 handles plus a move handle).

### src/ui/bridge.js — `class FrameBridge`
- `constructor(container, {onActivate, onViewport, onKey, title})` creates the single iframe with the
  srcdoc built from `FRAME_TEMPLATE` (inserted by the build) and a 128-bit channel.
- `render(scene, dataUrl, viewport, selected, settings): Promise<void>` mints a new sceneToken.
- `command(name)`, `focus()`, `destroy()`.

### src/ui/viewer.js — `class Viewer`
- `constructor(root, project, assetSource: {url(assetId), dataUrl(assetId)}, {embedded: boolean})`.
- Owns the root SceneRenderer, the modal (header, breadcrumb `<nav>`, Back, Overview, Close), the
  bridge, the details panel, the components list, the menu and the toolbar (Back, breadcrumbs,
  Overview, Fit, −, +, hints toggle, fullscreen).
- `destroy()` releases everything.

### src/ui/editor/
- `store.js` — `EditorStore {project, assets, dirty, history}` with `apply(mutator, {label, coalesceKey})`, `undo()`, `redo()` and `subscribe(fn)`.
- `ops.js` — pure model operations, unit-tested:
  - `addDiagram`, `removeDiagram(id, {mode:'retarget', to} | {mode:'removeActions'})`, `replaceAsset`;
  - `addHotspot`, `duplicateHotspot`, `deleteHotspot`, `setRect`, `moveZ`;
  - `addAction`, `removeAction`, `moveAction`, `setDefaultAction`;
  - `addAnnotation`, `deleteAnnotation`, `setRoot`.
- `sidebar.js`, `canvas.js`, `inspector.js`, `dialogs.js`, `fileio.js`.

## 2. Build (build/build.mjs)

1. Bundle `src/ui/frame-main.js`, then `src/ui/presentation-main.js`, then `src/ui/editor-main.js`.
   Bundling walks imports depth-first and fails on `import * as`, on `as` renames, on default exports
   and on duplicate top-level declarations. It strips `import` lines and `export` keywords and wraps
   each bundle in `(()=>{'use strict'; … })()`.
2. Frame document = `frame.css` + the frame bundle. Its hashes are computed.
3. Presentation template = `app.css` + the presentation bundle, with `FRAME_TEMPLATE` injected via
   `jsonForHtml` and a CSP that lists the hashes of both documents. It carries the placeholder
   `<script type="application/json" id="pde-data">__PDE_DATA__</script>`.
4. Editor = `app.css` + the editor bundle, with `PRESENTATION_TEMPLATE` and `FRAME_TEMPLATE` injected,
   and a CSP. Then the self-copy (D6): `editorHtml = PRE + selfBlock + POST`, where selfBlock is
   `<script type="application/json" id="pde-self">` + `jsonForHtml(PRE + MARK + POST)` + `</script>`.
5. Generate the sample package and presentation from `samples/customer-platform/` by importing
   `src/core/package.js`.
6. Write `dist/`, and print sizes and hashes.

## 3. Wiring and lifecycles

- **Asset bytes** live in one `Map<assetId, Uint8Array>`.
  - In the parent, object URLs are created lazily per scene and revoked when the project closes or
    the asset is replaced.
  - The frame always receives `data:` URLs; they are built from base64 on demand and the last three
    are cached.
- **Dirty state:** the editor marks itself dirty on every mutation and clean only after Save Project
  produces a download. `beforeunload` warns while dirty.
- **Preview:** the editor builds a Viewer over the current in-memory model and assets inside a
  full-window overlay, and destroys it when preview closes.

## 4. Test plan

| Layer | Files | Run |
|---|---|---|
| Unit | `test/unit/*.test.mjs` | `npm test` (Node 24 built-in runner) |
| Build | `test/unit/build.test.mjs` (CSP hashes match the inline blocks; no premature `</script>`; the self-copy is byte-identical; no network URLs in `dist`) | `npm run build && npm test` |
| Browser | `test/e2e/*.spec.mjs`, `file://` only, Chromium + Firefox + WebKit | `scripts/e2e.sh` |
| Measured | `test/e2e/a14-envelope.spec.mjs` writes `test-results/a14.json` | `scripts/e2e.sh test/e2e/a14` |
