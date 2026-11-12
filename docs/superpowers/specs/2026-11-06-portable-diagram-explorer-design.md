# Portable Diagram Explorer — design (spec Part 2)

**Part 1 (the what and why)** is the owner's specification, kept verbatim in
[`2026-11-06-portable-diagram-explorer-spec.md`](2026-11-06-portable-diagram-explorer-spec.md)
(v0.1, 6 November 2026). Its scope, workflows, interaction contract, data model, file formats,
safety rules, targets and acceptance scenarios A01–A14 are binding and are not restated here.

**Part 2 (this document)** records the engineering decisions that the specification leaves open,
the measurements that constrain them, and the risks.

**Review state:** Part 1 is owner-authored. **Part 2 was reviewed by the owner in dialogue on
2026-11-12** (see the register below). The decisions were made by the implementing session on
2026-11-06 under the owner's instruction "build the app". At review, 21 were approved as built and two
were amended (D11, D12). Where Part 2 and Part 1 disagree, Part 1 wins.

---

## 1. Measured rules carried as requirements

**MR-1: the file:// portability model works in all three engines.** This was measured on 2026-11-06 by
`spike/build-spike.mjs` and `spike/spike.spec.mjs` using Playwright 1.64.1: Chromium, Firefox and
WebKit on Linux, 3 of 3 passing. A page opened from `file://`, under a Content-Security-Policy whose
only script and style sources are SHA-256 hashes, can:

- host one `sandbox="allow-scripts"` `srcdoc` iframe;
- exchange postMessage traffic with it, with the channel checked and a foreign channel rejected;
- render a `data:` image inside it;
- receive Escape forwarded from inside it;
- block outbound image requests in both documents;
- round-trip `deflate-raw` through `CompressionStream`/`DecompressionStream`;
- render a `blob:` image in the parent;
- support `inert`;
- download a Blob.

Observed origins: the parent is `file://` in Chromium and WebKit and `null` in Firefox, and the frame
is `null` everywhere. **Requirement:** origin is never used for authentication. Authentication
rests on `event.source` identity plus the per-frame channel (spec §8).

**MR-2: an embedded string containing `</script>` ends the host script early.** The spike's first run
failed in every engine for this reason. **Requirement:** every string or JSON embedded in an inline
script or a JSON data block escapes `<` as `<`, and U+2028/U+2029 as ` `/` `. A unit
test asserts that no generated document contains a premature closing tag.

**MR-3: what was NOT measured.** These remain open gates in the acceptance report and are not
claimed:

- Branded Safari on macOS. Playwright WebKit is the engine, not the product.
- Microsoft Edge.
- Windows and macOS file handling.
- Real-hardware performance.

## 2. Decisions register (owner-reviewed in dialogue 2026-11-12)

**Rulings, 2026-11-12.** Approved individually as built: D3, D10, D13, D18, D19, D20, D21, and the
A07 focus rule (the window heading takes focus on open, and Close returns focus to the component that
opened the window). Approved as a batch of internal engineering choices: D1, D2, D4–D9, D14–D17, D22, D23.
**Amended:**

- **D11:** keep the size and count limits. Known operating-system clutter entries (`__MACOSX/…`,
  `.DS_Store`, `Thumbs.db`, `desktop.ini`) are **skipped, and the author is told which ones were
  skipped**. Any other unknown entry is still rejected by name. Why: re-zipping a package in macOS
  Finder adds these entries, and the strict rule would refuse the package.
- **D12:** the owner wants **SVG images accepted** as well. SVG can carry scripts and external
  references, so this is a feature with its own design and security review, not a change of limit.
  It is carried into the next feature epic. Until that ships, the PNG/JPEG/WebP rule stands.

| # | Decision | Alternatives | Why |
|---|---|---|---|
| D1 | Vanilla ES2022 modules, no framework, **no runtime third-party code** (including no ZIP library) | Bundle JSZip or fflate | The browser already provides deflate (MR-1). A small, owned ZIP codec has a smaller supply-chain and review surface than a vendored library. Spec §1 permits a library but does not require one. |
| D2 | A zero-dependency Node build script (`build/build.mjs`) bundles the modules into single HTML files | esbuild/rollup | Avoids a toolchain dependency. The bundler is about 150 lines, enforces named imports only, and fails on duplicate top-level names. |
| D3 | Generated documents carry a **hash-only CSP**: `default-src 'none'`, script/style hashes, `img-src data: blob:`, `base-uri 'none'`, `form-action 'none'` | `'unsafe-inline'` | Enforces the spec's zero-network rule (§11) in the browser rather than relying on convention. The srcdoc frame inherits the policy, so the frame's own script and style hashes are included. Proven by MR-1. |
| D4 | Core modules (schema, validation, ZIP, geometry, navigation, protocol, packaging) are **DOM-free and isomorphic**. Node's built-in test runner unit-tests them, and the build reuses them to generate the sample package | Browser-only core | Fast, deterministic tests. The sample package is produced by the same code the editor runs. |
| D5 | `schema/project.schema.json` is the **single source** of structural rules, interpreted by a small JSON-Schema-subset validator; semantic checks live beside it | A hand-written validator plus a separate schema file | One source of truth, so the shipped schema and the enforced rules cannot drift. |
| D6 | The editor reproduces its **own exact bytes** to put `editor.html` into saved ZIPs. The build embeds a JSON copy of the document minus that copy, and the runtime reassembles it | Serialising `document.outerHTML`; fetching itself | `fetch` of `file://` is blocked, and `outerHTML` is not byte-faithful. A unit test asserts that the reconstruction equals the built file byte for byte. |
| D7 | Presentation data is one `<script type="application/json" id="pde-data">` block: `{format:"pde-presentation", formatVersion:1, appVersion, project, assets:{<assetId>:{mimeType, base64}}}` | One block per asset; JS data | Declarative, parseable without execution, so Import Presentation uses `DOMParser` and executes nothing (spec §10, §11). |
| D8 | ZIP asset names are `assets/<assetId>-<slug>.<ext>`: the slug is `[a-z0-9-]`, at most 40 characters, from the original filename, and the extension is taken from the sniffed type | Original filenames | Deterministic, unique by construction, portable, and keeps recognisable names (spec §10A). |
| D9 | IDs are `<prefix>-<12 base32 random>` from `crypto.getRandomValues`, with the pattern `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` | UUIDs; counters | Opaque and stable, never derived from parentage (spec §9). |
| D10 | Undo/redo stores **snapshots of the JSON model**, bounded to 100 entries, with one entry per completed gesture. Asset bytes are immutable and held by id, outside history | Command pattern | The model is small, so this is simpler and correct by construction. A deleted diagram's asset stays restorable by undo. |
| D11 | **ZIP import limits:** at most 2,000 entries, 100 MiB per entry, 512 MiB in total, and a deflate ratio of at most 100:1 for entries over 1 MiB. Only `store` and `deflate` methods are accepted. Encryption, ZIP64 and multi-disk archives are rejected. The allowed entry set is `project.json`, `assets/*`, `editor.html` (ignored) and `README.txt`; **any other entry is rejected with its name** | Ignore unknown entries | Spec §11 requires rejecting traversal paths, duplicates, executables and excessive sizes. Rejecting unknown entries keeps the boundary closed, and the error names the entry. |
| D12 | **Image limits:** the type is sniffed from magic bytes (PNG, JPEG, WebP) and the declared extension or type is never trusted. Images over 4096 pixels on either side produce a warning. Images over 100 MP after decode are refused. Dimensions are the decoded, orientation-applied size | Trust the extension | Spec §7, §10, §12. |
| D13 | Export envelope warnings at the spec §12 numbers: more than 50 diagrams, 1,000 hotspots, 100 hotspots per scene, or 50 MiB of image bytes | Hard limits | Spec §12 says "warn" and adjust limits from measurement. |
| D14 | The renderer is one absolutely positioned **image-space container** transformed by `translate(tx,ty) scale(s)` with origin 0 0. It holds the `<img>` at its natural size, the `<svg viewBox="0 0 W H">` hotspot layer and the HTML annotations, all in image pixels. Tooltip and menu-button overlays sit in viewport space | Positioning overlays against the viewport | Spec §7 requires one coordinate system. |
| D15 | Viewport state is `{cx, cy, zoom}`: the centre as normalised image coordinates and zoom relative to fit, clamped to 0.25–16. Resizing preserves `cx/cy/zoom` | Pixel offsets | Spec §6 and §7. |
| D16 | Frame protocol v1 messages are `{pde:1, channel, seq, type, …}`. Each direction's `seq` must strictly increase. Each RENDER_SCENE carries a fresh random `sceneToken`, and any child message with a stale token is dropped. Every type has an exact field whitelist. The frame receives only the subset of the diagram it renders, never action targets | Trusting child data | Spec §8, and acceptance scenarios A08 and A10. |
| D17 | Component menus, details, breadcrumbs, history and the hotspot list all live in the **parent**. The frame only renders, hit-tests, shows tooltips and forwards keys | Menus inside the frame | Spec §8: the parent is authoritative. |
| D18 | Escape order: tooltip in the frame, then menu, then details panel, then modal (closes). Backspace or Alt+Left means Back. Both are forwarded from the frame as `KEY` messages | — | Spec §5 and §11. |
| D19 | **No `innerHTML`, `outerHTML=`, `insertAdjacentHTML`, `document.write` or `eval` anywhere in `src/`**. A unit test greps for them. User text reaches the DOM only through `textContent` | Sanitisation | Spec §11: text stays inert. |
| D20 | Replacing an image with different dimensions sets `diagram.alignmentReviewRequired = true` (an optional schema field). Export is blocked until the author marks it reviewed | Warning only | Spec §5 and A11: "requires reviewing alignment before export". |
| D21 | History cap: pushing visit 65 is refused and a dialog offers to return to an earlier visit or reset to Overview | Silently dropping the oldest | Spec §6. |
| D22 | Browser tests run in a pinned Playwright container (`scripts/e2e.sh`), never on the host; there is no hosted CI | GitHub Actions | House rules: no host installs; never pay for GitHub Actions. |
| D23 | Sample diagram images are rendered once, from SVG source, by a Playwright script into committed PNGs | Hand-drawn assets | Reproducible, and they need no image library. |

## 3. Architecture

```
src/core/      DOM-free (Node + browser)
  ids.js           D9 id generation
  schema.js        JSON-Schema-subset interpreter (D5)
  validate.js      structural + semantic validation, issue objects, migration
  geometry.js      fit/transform/inverse/clamp (spec §7)
  navigation.js    visit stack, cap, breadcrumbs (spec §6)
  protocol.js      frame message builders + validators (D16)
  crc32.js, zip.js ZIP read/write with limits (D11)
  sniff.js         magic-byte image typing (D12)
  embed.js         safe JSON-in-HTML embedding/extraction (MR-2, D7)
  package.js       project ZIP <-> model+assets; presentation build/extract (D6–D8, D13)
  envelope.js      export envelope measurement (D13)
src/ui/        browser
  dom.js           element builder (no innerHTML, D19)
  assets.js        AssetManager: decode, dims, object URLs, release
  renderer.js      SceneRenderer (D14, D15): pan/zoom/pinch, hotspots, annotations, tooltip, keys
  frame-main.js    child runtime entry (inside the sandboxed iframe)
  bridge.js        FrameBridge: srcdoc creation, channel, seq, sceneToken (D16)
  viewer.js        presentation shell: modal, nav, menus, details, list, toolbar (D17, D18, D21)
  editor/*.js      store + history, sidebar, canvas tools, inspector, dialogs, file I/O
  editor-main.js   editor entry; presentation-main.js viewer entry
src/styles/    app.css, frame.css
build/build.mjs  bundler + CSP hashing + self-copy (D2, D3, D6)
schema/project.schema.json
samples/       sample project source (project.json + PNG assets)
test/unit/     node --test
test/e2e/      Playwright, file:// only
```

Build outputs:

- `dist/editor.html`: the editor, with the viewer embedded for preview and export.
- `dist/presentation-template.html`: only for inspection; the editor embeds it.
- `dist/sample/customer-platform.diagram.zip` and `dist/sample/customer-platform.presentation.html`.

## 4. Error handling

Every import or validation problem is an **issue**: `{code, severity: error|warning, path, received,
expected, why, fix}`. Paths are JSON-pointer-like (`diagrams[1].hotspots[0].rect.width`). The editor
lists issues with a "Go to" link. Errors block export; warnings do not. Import failures show the full
issue list and leave the currently open project untouched (spec A09: no silent loss).

## 5. Testing

- Unit tests (`node --test test/unit/`) cover:
  - schema and semantics, including every issue code;
  - ZIP round trips and hostile archives (traversal, absolute paths, duplicates, bombs, ZIP64, encryption, unknown entries);
  - geometry and inverse transforms with letterboxing;
  - navigation, including cycles, the cap and breadcrumbs;
  - protocol rejection cases;
  - embedding escapes;
  - presentation round trips and the editor's byte-identical self-copy;
  - the D19 grep.
- Browser tests (`scripts/e2e.sh`) open built files via `file://` in all three engines and implement
  A01–A13. They fail on **any** non-`file:`/`data:`/`blob:`/`about:` request. A14 is a measured run
  recorded in `docs/acceptance-report.md`, not a pass/fail gate.

## 6. Risks

| Risk | Mitigation |
|---|---|
| WebKit in Playwright differs from shipping Safari | The report states this plainly; branded Safari stays an open gate (MR-3). |
| Large base64 presentations exhaust memory | Envelope warnings (D13); scenes decode lazily; object URLs are released on replacement; A14 records peak memory. |
| Focus moving across the iframe boundary behaves differently per engine | Sentinel focus wrappers in the parent, keys forwarded from the frame, and A07 run in all three engines. |
| An in-house ZIP codec has bugs | Round-trip and hostile-archive unit tests, and a byte-exact asset preservation check (A02). |
