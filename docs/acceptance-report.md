# Acceptance report: Portable Diagram Explorer v1

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
