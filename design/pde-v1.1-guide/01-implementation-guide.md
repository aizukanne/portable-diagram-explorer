# Portable Diagram Explorer v1.1 — implementation guide

**Epic:** milestone `PDE v1.1`
**Spec:** `docs/superpowers/specs/2026-11-12-pde-v1.1-design.md`, **approved by the owner 2026-11-12**
**Plan:** `docs/superpowers/plans/2026-11-12-pde-v1.1.md`
**Workplan:** `02-workplan.md`
**Status:** ready to build

This guide answers "how" at the file-and-function level. The v1 guide (`design/pde-v1-guide/`) still
describes everything this one does not change. Numbers such as §5.2, R3 and V8 refer to the v1.1 spec.

## 1. Module contracts: new and changed

### src/core/validate.js (changed)

- `SCHEMA_VERSION = 2`.
- `migrate(raw) → { project, issues, migratedFrom }`:
  - version 1 → a copy with `schemaVersion: 2` and `migratedFrom: 1`;
  - version 2 → `migratedFrom: null`;
  - version 3 or higher → `E_FUTURE_SCHEMA`, with the expected value "2 or lower".
- Semantic additions:
  - `E_SEQ_UNKNOWN_DIAGRAM` and `E_SEQ_DUPLICATE`, both at the path `sequence.slides[i]`;
  - `W_UNREACHABLE` seeds its search with the root **and** every `sequence.slides` entry.

### src/core/project-schema.js (changed)

- `schemaVersion: { const: 2 }`, applied after migration.
- `sequence: { slides: ID[1..500] }`, optional, with `additionalProperties: false`.
- `asset.mimeType` enum: adds `image/svg+xml`.

### src/core/sniff.js (changed)

- `IMAGE_TYPES` adds `'image/svg+xml': 'svg'`. It is the single source of the extension map:
  `assignAssetPaths` and `addDiagramFromAsset` both read it.
- `sniffImage(bytes)` recognises SVG when, after a BOM, whitespace, an XML declaration, comments and a
  DOCTYPE, the root tag is `<svg` with the SVG namespace. It inspects at most the first 4 KiB.

### src/core/slides.js (new)

- `class SlideCursor(slides, rootDiagramId)`. Its members are `count`, `index`, `current`, `hasNext`,
  `hasPrevious`, `isLast`, `next()`, `previous()`, `jump(i)`, `home()` and `label()`. The full
  signatures are in plan Task 2.
- It is DOM-free, and stops at both ends with no wrap-around (R4).

### src/core/protocol.js (changed)

- `KEY` accepts `Next` and `Previous`.
- The `RENDER_SCENE` image check accepts `data:image/svg+xml;base64,…`.

### src/core/package.js (changed)

- `PRESENTATION_FORMAT_VERSION = 2`; readers accept formats 1 and 2.
- The README text says `schemaVersion 2`.
- `isOsClutter(name)`, and in `readProjectZip`:
  - classify clutter;
  - strip a single wrapping folder;
  - run the allowed-entry check;
  - report `W_PKG_OS_FILES_SKIPPED`.

  Errors name the original entry paths.

### src/ui/editor/ops.js (changed)

- `emptyProject` sets `schemaVersion: 2`.
- `addToSequence(p, dId)`, `removeFromSequence(p, dId)`, `moveInSequence(p, dId, toIndex)` and
  `sequenceIndex(p, dId)`.
- `removeDiagram` also removes the diagram from `sequence`, and deletes `sequence` when it becomes
  empty.

### src/ui/editor/app.js (changed)

- `renderSidebar` adds a "Running order" section (`ol.pde-seq-list > li.pde-seq-item`) and the
  `Slide N` badges.
- `diagramInspector` adds the Add / Remove toggle.
- `deleteDiagram` adds the running-order sentence (A21).
- Save shows the `I_SAVED_V2` status line once per opened v1 file.
- The image inputs accept `image/svg+xml,.svg`.

### src/ui/svg-inspect.js (new, browser only)

- `inspectSvg(bytes) → { width, height, issues }`. It uses DOMParser (`image/svg+xml`), the unit
  table in plan Task 7, and the codes `E_SVG_PARSE`, `E_SVG_NO_SIZE`, `E_SVG_TOO_LARGE`,
  `W_SVG_INERT_PARTS` and `W_SVG_COMPLEX`.

### src/ui/assets.js (changed)

- `importImage` and `verifyProject` route SVG through `inspectSvg`. The 100-megapixel check applies to
  the computed size.

### src/ui/renderer.js (changed)

- The scene is sized from `scene.width`/`scene.height`, never from `naturalWidth`.
- Present mode, keys: Right Arrow and Page Down → `onKey('Next')`; Left Arrow and Page Up →
  `onKey('Previous')`. This happens only when Alt is not held and the key has no hotspot-specific
  meaning. Edit mode is unchanged.
- An optional `onSwipe(dir)`. It fires for a single touch pointer at fit zoom (≤ 1.0001) that travels
  at least 60 px horizontally, at least twice its vertical travel, in under 600 ms.
- A re-raster of SVG at rest, only if SP-1 requires it for an engine.

### src/ui/viewer.js (changed)

- `this.slides: SlideCursor | null`, and `this.pageDiagramId`.
- `showSlide(id)` replaces `showRoot()`. `pageDiagram()` replaces `rootDiagram()` wherever the code
  means "what the page shows". `rootDiagram()` keeps meaning the overview.
- `nextSlide()` and `previousSlide()`: if a drill-down is open, close it with no focus restore; then
  move the cursor, show the slide, focus `h1.pde-project-title`, announce "Slide N of M: <title>",
  and run `syncSlidebar()`.
- `syncSlidebar()` updates:
  - the Previous and Next disabled states;
  - the count;
  - the "Last slide" marker;
  - the page crumb ("Slide N of M › <title>");
  - the close button's label ("Back to slide" or "Overview").
- Home: `slides.home()`, then show the overview.
- `onDocumentKey`: the slide keys apply only when there are slides, and only when focus is not in a
  field, Alt is not held, and no menu or history-limit dialog is open.
- Hosted mode:
  - `onStartFailed` → swap `this.bridge` for `InPageScene`, set `this.fallback = true`, show the
    notice, and re-render;
  - the notice appears whenever `window.top !== window.self` (a throw also counts as hosted) and the
    viewer is not `embedded`.

### src/ui/bridge.js (changed)

- `FRAME_START_DEADLINE_MS = T`, the value from SP-2.
- Constructor options: `nonce` and `onStartFailed`.
- It replaces both `__NONCE_ATTR__` marks with ` nonce="<v>"` or with nothing.
- A deadline timer is cleared by `READY`. On expiry it fires `onStartFailed` and rejects the pending
  render with `{ startFailed: true }`.

### src/ui/inpage-scene.js (new)

- `InPageScene(container, { onActivate, onView, onKey, title })` has exactly `FrameBridge`'s public
  surface: `setTitle`, `render`, `command`, `focus`, `focusHotspot`, `destroy`, `ready` (always
  true), and `frame` (returns its host element).
- It wraps a present-mode `SceneRenderer`.

### src/ui/presentation-main.js and src/ui/build-info.js (changed)

- `document.currentScript.nonce` is read before anything else runs; put it in the bundle preamble if
  imports are hoisted.
- `hostNonce()` returns it only if it matches `^[A-Za-z0-9+/=_-]{1,200}$`.

### build/build.mjs (changed)

- The frame template marks are `<style__NONCE_ATTR__>` and `<script__NONCE_ATTR__>`. The inspection
  copy `dist/frame.html` has them removed.
- Under `--test` it writes:
  - `hosted-nonce.html`, `hosted-hash-only.html` and `hosted-bad-nonce.html`, using
    `test/e2e/harness/host-wrapper.mjs`;
  - `constants.json`, holding `FRAME_START_DEADLINE_MS` and `FRAME_SCRIPT_HASH`;
  - the fixtures `slides.presentation.html`, `slides-with-overview.presentation.html`,
    `finder-rezip.diagram.zip`, `windows-rezip.diagram.zip`, and `images/diagram.svg`,
    `images/risky.svg` and `images/nosize.svg`.

## 2. Data flow: Next pressed inside a drill-down

```
frame keydown ArrowRight
  → renderer.onKeyDown (present) → onKey('Next')
  → frame-main send KEY{key:'Next'}
  → bridge.receive: validateChildMessage (KEY whitelist)
  → viewer.onKey('Next') → nextSlide()
  → finishClose(null, {restoreFocus:false})   modal hidden, NavStack cleared
  → slides.next() → showSlide(id) → rootRenderer.setScene
  → focus h1, announce, syncSlidebar
```

In fallback mode, `InPageScene` calls `onKey('Next')` directly. Everything from
`viewer.onKey` onwards is the same.

## 3. Hosted start-up sequence

```
presentation-main: HOST_NONCE ← currentScript.nonce (validated)
user opens a drill-down → new FrameBridge({nonce: HOST_NONCE, onStartFailed})
  ├─ READY before T ms → sealed frame, as in v1 (H1 path)
  └─ no READY by T ms  → onStartFailed → InPageScene, notice + "reduced isolation"
notice (hosted) shown at start-up regardless of path
```

## 4. Issue codes added

| Code | Severity | Path | Raised by |
|---|---|---|---|
| `E_SEQ_UNKNOWN_DIAGRAM` | error | `sequence.slides[i]` | validate |
| `E_SEQ_DUPLICATE` | error | `sequence.slides[i]` | validate |
| `E_SVG_PARSE` | error | file name | svg-inspect |
| `E_SVG_NO_SIZE` | error | file name | svg-inspect |
| `E_SVG_TOO_LARGE` | error | file name | svg-inspect |
| `W_SVG_INERT_PARTS` | warning | file name | svg-inspect |
| `W_SVG_COMPLEX` | warning | file name | svg-inspect |
| `W_PKG_OS_FILES_SKIPPED` | warning | `(archive)` | package |
| `I_SAVED_V2` | status line | — | editor save |

## 5. Test plan

- **Unit (`node --test`):**
  - migration from v1 to v2, and refusal of future versions;
  - sequence errors, and reachability through the sequence;
  - format 2 round trip, format 1 read;
  - SVG paths;
  - `SlideCursor`;
  - sequence operations;
  - `KEY` and `RENDER_SCENE` protocol changes;
  - SVG sniffing, including near-misses;
  - the build's nonce marks;
  - ZIP clutter and folder stripping.
- **Browser (all three engines, `file://`):**
  - `running-order.spec` (A15, A21, I_SAVED_V2);
  - `slides.spec` (A16–A20 and Review focus 1–2);
  - `svg.spec` (A22–A24);
  - `hosted.spec` (the #16 reproduction guard, A25–A27, the bridge `?broken` case, Review focus 4);
  - `editor.spec` (A28, and the updated `not-an-image.png` expectation).
- **Regression:** the full v1 suite runs unchanged, and the A14 envelope is re-run (A29 covers compatibility).
- **Live:** LG-1, the owner's SharePoint check.
