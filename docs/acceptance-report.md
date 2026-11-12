# Acceptance report: Portable Diagram Explorer

Version 1 (build 0.1.0, 6 November 2026) is reported first and unchanged. **Version 1.1 (build 0.2.0,
12 November 2026) is reported in the section "Version 1.1 (build 0.2.0)" after it**, which also holds
the A14 re-run and what is still unproven.

## Version 1 (build 0.1.0)

Date: 6 November 2026 · Build: 0.1.0 · Specification: v0.1 (`docs/superpowers/specs/`)

## Summary

- **Proven:** every acceptance scenario A01–A13 passes as an automated browser test, opened from
  `file://` in the browser engines listed below. The last full run passed 135 of 135 tests, plus
  112 of 112 unit tests.
- **Measured:** A14 (performance at the maximum project size) was recorded twice; the numbers are
  below.
- **Not tested:** branded Safari, Microsoft Edge, Windows, macOS, real laptop hardware, mobile
  devices and screen readers. Read "What was not tested" before promising any of them.

## Test environment

| Item | Value |
|---|---|
| Host | Linux 6.8 server, 8 vCPU, shared with other workloads, no GPU |
| Runner | Playwright 1.64.1 in `mcr.microsoft.com/playwright:v1.64.1-noble` (headless) |
| Chromium | 156.0.8078.80 |
| Firefox | 157.0 |
| WebKit | 27.2 (Playwright's build of the engine Safari uses; **not** Safari itself) |
| Node.js | 24.11 (host build and unit tests), 26.13 (inside the container) |
| How files are opened | Always `file://`, as a recipient double-clicking a file would. No server is used. |
| Network | Every browser test records requests and fails on any that are not `file:`, `data:`, `blob:` or `about:` |

## Acceptance scenarios

Every row passed in all three engines in the final full run.

| ID | What the specification requires | Test | Result |
|---|---|---|---|
| A01 | Presentation opened from a different folder; everything works with no server, install or network | `viewer.spec` "A01", `sample.spec` | Pass. Zero external requests. |
| A02 | Open the editor via `file://`, import a package, edit a hotspot, save, reopen. IDs, text, targets, coordinates and original image bytes are preserved. | `editor.spec` "A02" ×2 | Pass. Only the edited coordinate changed. Image bytes are SHA-256 identical. The saved `editor.html` is byte-identical to the build, and it reopens the package. |
| A03 | Overview → HLD → LLD → detail, then Back twice. Each earlier image centre, zoom, selection and details state is restored. | `viewer.spec` "A03" | Pass. Positions are restored to the pixel. The open description and the overview state also return after Close. |
| A04 | A shared diagram reached from two components; breadcrumbs and Back reflect the actual route | `viewer.spec` "A04" | Pass |
| A05 | Resize, zoom and pan; hotspots stay aligned, including letterboxed layouts | `a05-renderer.spec` (3 sizes × 4 zooms + rotation) | Pass. Within 1 px. |
| A06 | Right-click, the menu button and Shift+F10 give the same actions; the native menu works elsewhere | `viewer.spec` "A06" ×2, `a05-renderer.spec` | Pass |
| A07 | Keyboard only: explore, read descriptions, close; focus visible, trapped, returned | `viewer.spec` "A07" | Pass. See the focus note below. |
| A08 | Activation racing navigation and resize; stale frame messages cannot change the new scene; Back and Close still work | `a08-a10-bridge.spec`, `viewer.spec` "A08" | Pass |
| A09 | Missing asset, dangling target, corrupt ZIP, future schema: an actionable error and no silent loss | `editor.spec` "A09" ×6 | Pass. The open project is untouched. A dangling target opens with the error listed, a **Go to** link, and export blocked until it is fixed. |
| A10 | HTML-like text and crafted frame messages stay inert or are rejected | `a08-a10-bridge.spec`, `viewer.spec` "A10" | Pass. Forged, foreign-channel, replayed, unknown-type and stale-token messages are all rejected and counted. |
| A11 | Replacing an image with a new aspect ratio warns and requires an alignment review | `editor.spec` "A11" | Pass. Export is blocked until it is marked reviewed, and undo restores the requirement. |
| A12 | Cross-link cycle: navigation stays responsive, the history limit is enforced, Overview always exits | `viewer.spec` "A12" | Pass. 64 visits, then the 65th is refused with a choice. |
| A13 | Hints hidden: no editing handles; tooltips, menus and keyboard still work | `viewer.spec` "A13" | Pass |
| A14 | Maximum-envelope project on a reference machine: record load, navigation, pan/zoom and memory | `a14-envelope.spec` (run with `PDE_A14=1`) | Measured; see below. Two runs. |

The suite also covers:

- the complete authoring flow: import images, draw, label, set actions, add a note, duplicate,
  delete, undo/redo, preview, export, open the export as a recipient, re-import it;
- the unsaved-changes guard;
- deleting a linked diagram, with undo;
- the shipped three-level sample.

**Focus note (A07).** WebKit will not move keyboard focus into a newly created sandboxed frame by
script. So the same rule now applies in every engine: opening a drill-down focuses the window's
heading, which is announced, and Tab moves on into the diagram. Back and the breadcrumbs keep focus
on the control pressed. Navigation started from the keyboard inside the diagram keeps focus there.
Close returns focus to the component that opened the window. This was measured, not assumed:
before the change, Firefox lost focus on Close and WebKit never entered the frame.

## A14: measurements at the maximum envelope

Generated project, at spec §12's size:

- 50 diagrams with 20 hotspots each (1,000 hotspots);
- 49.4 MiB of images, made of random pixels so they cannot compress;
- a 66.3 MiB presentation file, because embedded images grow by about a third.

| Measure | Target (spec §12) | Chromium 156 | Firefox 157 | WebKit 27.2 |
|---|---|---|---|---|
| Initial open, until the overview image is shown | under 5 s | 3.0 s / 2.1 s | 6.5 s / 3.4 s | 8.9 s / 15.6 s |
| Navigation to a recently seen diagram, median (max) | under 300 ms | 79 (262) / 74 (213) ms | 54 (166) / 104 (273) ms | 47 (142) / 100 (387) ms |
| Navigation to a diagram not seen yet, median (max) | — | 144 (241) / 145 (192) ms | 100 (185) / 230 (601) ms | 66 (82) / 126 (316) ms |
| Zoom frame time, median / 95th percentile | smooth | 19/44 → 17/37 ms | 36/109 → 39/149 ms | 209/454 → 128/496 ms |
| JavaScript heap | — | 242 MiB used | not exposed | not exposed |

Each cell shows run 1 / run 2. Before run 2 the scene was given its own compositing layer
(`will-change: transform`), which is what the arrow marks in the frame-time row.

**What these numbers mean, and do not mean**

- There is no reference laptop available, so these are **not** the measurements spec A14 asks
  for. They come from a shared, headless server with no graphics hardware, which makes rendering
  slower than on an ordinary laptop. The two runs differ by up to 2× with no relevant change
  (Firefox's initial open went from 6.5 s to 3.4 s). That variation is the server's load, and it
  makes single runs unreliable.
- **Navigation meets its target in every engine:** typically 50–150 ms to show the next diagram,
  with the worst case 601 ms.
- **Initial open meets 5 s in Chromium only.** Firefox and WebKit took 3.4–15.6 s for a 66 MiB file.
- **Zooming is smooth in Chromium, acceptable in Firefox, and not smooth in headless WebKit**
  (about 8 frames per second). Whether real Safari on a Mac shares WebKit's figure is unknown.

**Limits after measurement:** the tested envelope stays at 50 diagrams, 1,000 hotspots and 50 MiB
of images. The editor warns beyond it. Nothing was measured that justifies raising the limits, and
nothing on real hardware yet justifies lowering them. Measuring on a reference laptop is tracked
as an open item.

## What was not tested

These gaps mean the corresponding claims are **unproven**, not failed.

- **Branded Safari on macOS and Microsoft Edge on Windows** were not run. WebKit and Chromium are
  their engines, but `file://` handling, downloads and focus can differ in the shipping browsers.
  The specification requires running in every claimed browser.
- **Windows and macOS file handling** (double-click to open, download locations).
- **A01's second computer.** The test copies the file to another folder on the same machine. Being
  offline is enforced by the content policy and checked by recording requests.
- **Screen readers** (NVDA, JAWS, VoiceOver). Roles, names, live announcements and focus order were
  built to the accessibility pattern and checked through the browser's accessibility tree, but no
  screen reader was used.
- **Mobile and tablet.** Touch pinch and pan are implemented. Opening files on mobile is outside
  the version 1 promise (spec §12).
- **High-contrast and forced-colours mode.** A style rule is included but was not verified
  visually.

---

# Version 1.1 (build 0.2.0)

Date: 12 November 2026 · Build: 0.2.0 · Specification: `docs/superpowers/specs/2026-11-12-pde-v1.1-design.md`
(approved by the owner 2026-11-12; changes made during the build are in its "Amendments during build" section)

## Summary

- **Proven (automated, in Chromium, Firefox and WebKit, opened from `file://`):** acceptance scenarios A15 to
  A29 pass, except that **A25 and A26 are proven only against a model of SharePoint's rules that we built**, not
  against SharePoint (see "LG-1" below). The full browser run passed 306 tests (102 tests in each of the
  three engines), plus 184 of 184 unit tests. Version 1's scenarios A01 to A13 are in the same run and still pass.
- **Measured:** A14 (performance at the maximum project size) was re-run. It is **within version 1's run-to-run
  spread in all three engines, and in most cells better**. Numbers below.
- **Not yet verified:** the real SharePoint preview (live gate LG-1, the owner's check, card in
  `docs/lg1-sharepoint-check.md`; **nothing has been learned from SharePoint itself yet**); branded Safari and
  Microsoft Edge on real hardware (open item #12); SVG sharpness on a high-density or GPU-drawn screen; real
  touch hardware for swipe (the test sends synthetic touch pointer events); screen readers.

## Test environment (changes from version 1)

Same host, runner, browsers and file handling as version 1 (see above): Playwright 1.64.1 in the pinned
container, Chromium 156.0.8078.80, Firefox 157.0, WebKit 27.2, every page opened from `file://`, every test
failing on any network request. Host Node.js is the one used to build and run the unit tests.

## Acceptance scenarios A15 to A29

Each row names the test that checks it (all in `test/e2e/` unless stated otherwise) and passed in all three engines.

| ID | What the specification requires | Test | Result |
|---|---|---|---|
| A15 | In the editor, add, remove and reorder the running order by drag and by keyboard; each change is one undo step; save and reopen keeps the order | `running-order.spec` "A15: build, reorder (drag and keyboard), undo, save, reopen: order kept", "keyboard Remove keeps focus…", "first save of a v1 file says it is now in the v1.1 format" | Pass. |
| A16 | Next and Previous (buttons and keys) step through the order; the counter reads "N of M"; the ends stop and say so | `slides.spec` "A16: buttons and keys step through; ends stop and say so", "R4: at an end, Next/Previous inside a drill-down do nothing…" | Pass. |
| A17 | From three levels deep in a drill-down, Next closes the window and continues the order; focus moves to the new slide's heading and it is announced | `slides.spec` "A17: Next from three levels deep resumes the sequence; focus and announcement", "Review focus 2…" | Pass. See the focus caveat below. |
| A18 | The jump list names every slide, marks the current one, and works from the keyboard | `slides.spec` "A18: jump list names every slide, marks the current, keyboard operable", "Home shows the overview; "Back to slide"…" | Pass. |
| A19 | On a touch screen a horizontal swipe at fit zoom changes slide; zoomed in, the same gesture pans | `slides.spec` "S5: touch swipe › A19: swipe left at fit zoom = Next; zoomed in, the same gesture pans" | Pass, with **synthetic** touch pointer events in an emulated touch browser, not a physical screen. |
| A20 | A project with no running order behaves as in version 1: no slide controls and version 1's suite unchanged | `slides.spec` "A20: no sequence, no slide controls", plus every version 1 test in the same run | Pass. |
| A21 | Deleting a diagram that is in the order removes it from the order, says so, and undo restores both | `running-order.spec` "A21: deleting a slide diagram says so; undo restores its place" | Pass. |
| A22 | An SVG imports and is listed as SVG, sized from `width`/`height` or `viewBox`; one with neither is refused with a message naming the fix | `svg.spec` "A22…", "A22b: a viewBox-only SVG is sized from its viewBox…"; `svg-inspect.spec` (sizes, refusals, "E_SVG_NO_SIZE names the attributes present and a runnable fix") | Pass. |
| A23 | An SVG with a script, event handler, embedded page or external reference imports with a warning; nothing in it runs or fetches in the editor, preview or export | `svg.spec` "A23: risky SVG warns, nothing runs or loads in editor, preview or export" and its control "A23-control: the detector CAN fail…" | Pass. The control loads the same file through deliberately unsafe paths and shows that it then does run and fetch, so the check can fail. |
| A24 | Hotspots line up on an SVG at 25%, 100% and 1600% zoom | `svg.spec` "A24: hotspots line up on an SVG at 25%, 100% and 1600%" | Pass. |
| A25 | In a host page that stamps scripts with a nonce (the H1 model), drill-downs render in the sealed frame | `hosted.spec` "A25 (H1 model): host nonce is passed on; drill-down renders in the sealed frame", "Review focus 4: a malformed nonce is ignored…" | Pass against our model of the host. **Not SharePoint.** |
| A26 | When the frame cannot start, drill-downs render in the page within the deadline and the notice says so | `hosted.spec` "A26: frame cannot start… in-page fallback within the deadline, notice says so", "A26b…", "A26c: a notice dismissed earlier comes back…", "bridge: a healthy frame does not trigger onStartFailed" | Pass against our model of the host. **Not SharePoint.** |
| A27 | The notice appears whenever the presentation is inside another page, can be dismissed, and does not appear on `file://` or in the editor preview (the reduced-isolation sentence would still appear if the in-page fallback ever ran there) | `hosted.spec` "A27: no notice on file:// or in the editor preview; Dismiss hides it", "Dismiss inside the open drill-down (keyboard) keeps focus in the dialog" | Pass. |
| A28 | A package re-zipped on macOS or Windows opens; every skipped file is named in a warning; other unexpected entries are still refused | `editor.spec` "finder-rezip.diagram.zip opens, with the skipped operating-system files named" and the Windows equivalent, "A09: unexpected-entry…"; `test/unit/package.test.mjs` "OS clutter is skipped and named… (A28)" | Pass. |
| A29 | A version 1 file opens in 1.1 unchanged; a 1.1 file opened in the version 1 editor gets version 1's own "newer version" error, no crash and no loss | First half: `editor.spec` "A02" (a version 1 fixture opens and saves with only the version changed) and `test/unit/package.test.mjs` (version 1 packages and presentations read as version 2). Second half: the check below, against the real version 1 editor. | Pass. |
| LG-1 | In the owner's SharePoint preview, drill-downs show their diagrams and the notice appears; the console capture and the path taken (H1 or fallback) are recorded | `docs/lg1-sharepoint-check.md` (owner's step card) | **Not run. Awaiting the owner.** Issue #16 stays open until the capture is posted. |

The suite also covers things the specification did not list as scenarios: an empty running order is refused when a
file is opened (`E_SCHEMA_COUNT`); a dismissed notice, a malformed nonce, Previous/Back and focus behaviour in the
in-page fallback; and the "Opened, with notes" dialog for open-time warnings.

**Focus caveat.** One test helper (Playwright's `toBeFocused`) was seen to pass while the page's
`document.activeElement` was the page body, inside the hosted (nested-frame) test page. The focus fix made
for that page was checked against `document.activeElement` directly. Whether the same weakness exists in the
older top-level focus assertions (A07 and the editor's) has **not been checked yet**; it is on the final review's list.

## A29 against the real version 1 editor

How it was run: `007c71c`, the last version 1 commit, was checked out in a temporary worktree and built (it reports
v0.1.0). That `editor.html` was opened by Playwright through a throwaway spec (`spike/a29/check.spec.mjs`, run
through `scripts/e2e.sh` with its own config) in Chromium, Firefox and WebKit. The 0.2.0 editor first saved a
package and exported a presentation with a one-slide running order (the package was checked to have
`schemaVersion` 2 and the right `sequence`). The version 1 editor first opened a version 1 package, then was given
each of the two version 1.1 files.

Result, identical in all three engines: both files were refused with a dialog headed "This could not be opened",
the message "Nothing was changed: the project you were editing is still open", and the code **`E_FUTURE_SCHEMA`**
(for the package: `schemaVersion` received 2, expected 1 or lower, "Open it with the editor.html that was saved
alongside it, or with a newer version"; for the presentation: format 2 received, format 1 expected). After closing the
dialog the earlier project was still open with the same title and diagram count and still marked "Saved", and the
version 1.1 files on disk were unchanged. Three of three tests passed. The temporary worktree was removed afterwards.
The throwaway spec is committed under `spike/a29/` for repeatability; the copy of the old editor it needs is not
(it is rebuilt from `007c71c`).

## A14 re-run, version 0.2.0 against version 1

Same generated project as version 1 (50 diagrams, 1,000 hotspots, 49.4 MiB of images, a 66.3 MiB presentation file),
same host, run once with the three engines one after another. Version 1's two runs are shown as "run 1 / run 2".

| Measure | Target (spec §12) | Chromium 156 | Firefox 157 | WebKit 27.2 |
|---|---|---|---|---|
| Initial open, until the overview image is shown | under 5 s | **2.7 s** (v1: 3.0 / 2.1) | **2.8 s** (v1: 6.5 / 3.4) | **6.5 s** (v1: 8.9 / 15.6) |
| Navigation to a recently seen diagram, median (max) | under 300 ms | **48 (156) ms** (v1: 79 (262) / 74 (213)) | **47 (201) ms** (v1: 54 (166) / 104 (273)) | **46 (171) ms** (v1: 47 (142) / 100 (387)) |
| Navigation to a diagram not seen yet, median (max) | none | **103 (231) ms** (v1: 144 (241) / 145 (192)) | **46 (97) ms** (v1: 100 (185) / 230 (601)) | **42 (57) ms** (v1: 66 (82) / 126 (316)) |
| Zoom frame time, median / 95th percentile | smooth | **16 / 40 ms** (v1: 17 / 37) | **22 / 80 ms** (v1: 39 / 149) | **63 / 195 ms** (v1: 128 / 496) |
| JavaScript heap | none | 242 MiB used (v1: 242) | not exposed | not exposed |

An earlier attempt ran the three engines in parallel and is not used for the table above, for two reasons. Its
Chromium and Firefox numbers agreed with this table (Chromium open 2.6 s, navigation median 55 ms; Firefox open 1.8 s,
navigation median 37 ms), but its WebKit run failed: all three workers race to build the same 66 MiB file, and WebKit
opened it before it was complete and showed nothing for five minutes. That is a defect in the test's setup, not in the
product; running the test with `--workers=1`, as above, avoids it, and the README command now says so. It was not
fixed in the test in this release.

**Verdict: no slowdown.** Every 0.2.0 figure sits inside the range version 1 recorded between its own two runs,
or is better than both. Nothing is worse than version 1's worse run. Version 1 recorded differences of up to 2x
between two runs with no relevant change, so the improvements (for example Firefox's initial open and WebKit's zoom
time) cannot be credited to the 0.2.0 code. The conclusions drawn for version 1 stand: navigation meets its target
in every engine; initial open meets 5 s in Chromium and Firefox in this run and not in WebKit (6.5 s); zooming is smooth
in Chromium, acceptable in Firefox and not smooth in headless WebKit (a 63 ms median frame is about 16 frames per
second, against about 8 before). These are still shared-server, no-graphics figures, not reference-laptop figures.
The tested envelope is unchanged.

## What was not tested (additions for 1.1)

- **The real SharePoint or OneDrive preview.** The presentation's own content policy deliberately refuses any script it did not ship, so scripts a host such as SharePoint injects into the page are blocked by design; the "blocked" lines the owner will see in the console capture are this, not a defect. Everything about hosted viewers is proven against a model of the host
  that we wrote from a guess about its rules. Whether the host stamps our scripts with a nonce, and what its image
  policy allows, is exactly what LG-1 will show.
- **Other hosts** (Teams tabs, email previews, other document systems).
- **SVG on a high-density or GPU-drawn screen.** Sharpness was measured at device pixel ratio 1 with software rendering,
  at rest, up to 1600% zoom. The decision not to re-render SVG at rest rests on that, and the real-hardware item (#12)
  must confirm it. How fast a very large SVG pans on a real GPU is also unmeasured; the 200,000-element warning level
  comes from the same measurements.
- **Real touch hardware** for swipe, and screen readers for the new slide announcements. Both are checked only through
  the browser's tests and accessibility tree.
- **Branded Safari and Microsoft Edge**, Windows and macOS file handling, as for version 1 (issue #12).
- **Re-zipped packages from the real Finder or Windows Explorer.** The test files imitate their contents.
