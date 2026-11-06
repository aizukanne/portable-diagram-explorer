# Portable Diagram Explorer v1 — workplan

**Epic:** milestone `PDE v1 — portable diagram explorer` · **Guide:** `01-implementation-guide.md` ·
**Plan:** `docs/superpowers/plans/2026-11-06-pde-v1.md`

## Story × task matrix

| Story | Issue | Pts | Tasks (plan task #) | Depends on | Gate |
|---|---|---|---|---|---|
| S01 Build pipeline, CSP hashing, self-copy | #1 | 3 | T1 | spike (done) | build.test passes; spike still 3/3 |
| S02 Schema + validation + migration | #2 | 3 | T2 | S01 | every issue code has a failing-then-passing test |
| S03 ZIP codec with import limits | #3 | 3 | T3 | S01 | round-trip + 13 hostile cases |
| S04 Packaging: project ZIP, loose files, presentation, envelope | #4 | 3 | T4 | S02, S03 | byte-exact asset round trip; embed escapes |
| S05 Geometry + navigation + protocol cores | #5 | 2 | T5 | S01 | unit tests incl. cycle + cap + stale token |
| S06 Scene renderer | #6 | 5 | T6 | S05 | A05 alignment e2e in 3 engines |
| S07 Frame runtime + bridge | #7 | 3 | T7 | S06 | A08, A10 e2e |
| S08 Viewer shell (modal, nav, menus, details, list, toolbar) | #8 | 5 | T8 | S07, S04 | A01, A03, A04, A06, A07, A12, A13 e2e |
| S09 Editor store, ops, undo/redo, diagram management | #9 | 3 | T9 | S02 | ops unit tests; delete-with-retarget undoable |
| S10 Editor UI: canvas tools, inspector, sidebar, file I/O, preview | #10 | 5 | T10 | S06, S08, S09, S04 | A02, A09, A11 e2e |
| S11 Sample project, README, acceptance report, A14 measurement | #11 | 3 | T11 | S10 | all e2e green in 3 engines; report written |

The issue numbers are those GitHub assigned when the stories were filed. This plan carries none.

## Critical path

S01 → S05 → S06 → S07 → S08 → S10 → S11. The order is load-bearing:

- The renderer (S06) is shared by the root view, the frame and the editor, so it must exist before
  any of them.
- The bridge (S07) has to be proven before the viewer builds navigation on top of it, because spec
  §8 says to verify the iframe design before building the editor.
- The editor UI (S10) uses the viewer for preview and packaging for save and export.

S02 → S04 and S03 → S04 run alongside S05 and S06. S09 needs only S02.

## Live gates (pass conditions stated up front)

- **G1 (file://, three engines):** every e2e spec passes in Chromium, Firefox and WebKit with zero
  requests outside `file:`, `data:`, `blob:` and `about:`.
- **G2 (byte preservation):** asset bytes after Save, then Open, then Save are SHA-256-identical to
  the original input files (A02).
- **G3 (self-copy):** `editor.html` inside a saved ZIP is byte-identical to `dist/editor.html`.
- **G4 (A14):** the maximum-envelope run is recorded with load time, warm navigation, pan/zoom frame
  time and peak JS heap where the engine exposes it. This is a recorded measurement, not a pass/fail
  gate. Advertised limits are adjusted to what was measured.

## Non-goals (restated from spec §3)

Collaboration, authentication, cloud sync, AI image editing, connectors, third-party embedding, SVG
import, polygon hotspots, PDF, Markdown, audio and video, direct folder save, autosave, and mobile
file-opening promises.

## Risks

| Risk | Mitigation |
|---|---|
| Focus traversal across the iframe differs by engine | Sentinels plus forwarded keys; A07 in all engines |
| Tests prove Playwright WebKit, not Safari | Acceptance report states MR-3 plainly |
| In-house ZIP bugs | Hostile-case suite; G2 |
| Memory with large presentations | Lazy URLs, a 3-entry data-URL cache, revocation; G4 |
