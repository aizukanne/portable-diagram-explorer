# Portable Diagram Explorer v1.1 — workplan

**Epic:** milestone `PDE v1.1` · **Guide:** `01-implementation-guide.md` ·
**Plan:** `docs/superpowers/plans/2026-11-12-pde-v1.1.md` ·
**Spec:** `docs/superpowers/specs/2026-11-12-pde-v1.1-design.md` (approved by the owner 2026-11-12)

## Story × task matrix

| Story | Issue | Pts | Task | Depends on | Gate |
|---|---|---|---|---|---|
| S1 Schema v2, running order field, SVG type, format 2 | #17 | 3 | T1 | — | unit green; v1 browser suite 141/141 unchanged |
| S2 SlideCursor | #18 | 1 | T2 | — | 4 unit tests |
| S3 Editor: running order | #19 | 3 | T3 | S1 | A15, A21, I_SAVED_V2 in 3 engines |
| S4 Viewer: slides, controls, keys, jump list, Home | #20 | 5 | T4 | S1, S2 | A16–A18, A20, Review focus 1–2 in 3 engines |
| S5 Viewer: swipe | #21 | 1 | T5 | S4 | A19 in 3 engines |
| SP-1 Spike: SVG zoom and pan | (refs S6) | 1 | T6 | — | REPORT.md with per-engine decision line |
| S6 SVG import, checks, display, protocol | #22 | 5 | T7 | S1, SP-1 | A22–A24, Review focus 3 |
| SP-2 Spike: frame READY latency | (refs S7) | 1 | T8 | — | REPORT.md with T |
| S7 Hosted viewers: nonce, deadline, fallback, notice | #16 | 5 | T9 | SP-2, S4 | #16 reproduction guard passes first; A25–A27, Review focus 4 |
| S8 ZIP clutter and wrapping folder | #23 | 2 | T10 | — | A28, Review focus 5 |
| S9 Release 0.2.0, docs, acceptance report, LG-1 card | #24 | 2 | T11 | all | full suite green in 3 engines; A14 re-run recorded |

Issue numbers were assigned when the stories were filed on 2026-11-12. S7 is the existing defect #16, used rather than duplicated (sweep rule). The plan carries none.

## Critical path

S1 → S4 → S7 → S9. The order is load-bearing:

- **S1 first.** Every later story reads or writes the v2 shape, and the slides fixtures come from it.
- **S4 before S7.** The fallback (`InPageScene`) must carry the `Next`/`Previous` keys that S4 adds. S7's
  A26 also checks navigation in fallback mode.
- **SP-2 before S7.** The start-up deadline T is a measured number, not a guess.
- **SP-1 before S6.** Whether SVG needs re-rasterising at rest decides part of S6's renderer change.

These can run alongside the critical path: S2 alongside S1; SP-1, SP-2 and S8 at any time; S3 after
S1, alongside S4; S5 after S4; S6 after SP-1.

**Note on concurrency.** Never run two browser runs (`scripts/e2e.sh`) at once: they share
`./node_modules`. Parallel work must serialise its browser runs.

## Live gates (pass conditions stated up front)

- **G1 (`file://`, three engines):**
  - every e2e spec passes in Chromium, Firefox and WebKit;
  - there are no requests outside `file:`, `data:`, `blob:` and `about:`;
  - `window.top.pwned` stays undefined in every hostile-input test.
- **G2 (compatibility):** the v1 fixtures open with no errors; a v1.1 file in the v1 editor gives
  `E_FUTURE_SCHEMA` (A29).
- **G3 (the #16 reproduction):** the `hosted-hash-only.html` guard shows the frame script's own hash
  refused, in every engine, **before** any S7 code is written.
- **G4 (performance):** the A14 timings are no worse than v1 by more than the run-to-run spread
  recorded in the v1 acceptance report.
- **LG-1 (owner, SharePoint):**
  - the drill-down shows its image;
  - the notice shows;
  - the console capture is attached to #16;
  - whether the H1 path or the fallback ran is recorded.

  An agent cannot close LG-1.

## Non-goals (restated from the spec)

- several named tours;
- looping or kiosk mode;
- timed auto-advance;
- repeating a diagram in the order;
- interactive SVG (links, scripts, animation);
- fonts or images loaded from the internet inside an SVG;
- detecting SharePoint by name.

## Risks

| Risk | Mitigation |
|---|---|
| H1 is wrong, so the real host does not stamp its nonce on our scripts | The fallback does not depend on H1. LG-1 records the path. |
| The harness does not model the host in some engine | The G3 guard runs before implementation. Any engine that fails it is reported, not worked around. |
| Changing `rootDiagram()` to `pageDiagram()` misses a call site, so the details panel or crumbs show the overview while a slide is up | A17 and the Home test check the crumb text. The guide lists every call site that means "page". |
| SVG blurs at high zoom | SP-1 runs first; re-raster at rest is designed in. |
| Very complex SVGs are slow | The `W_SVG_COMPLEX` threshold comes from SP-1 data. |
| A slide key collides with an existing key | The Alt+Left Back branch keeps precedence; slide keys are ignored in fields, menus and dialogs (Review focus 1). |
| A parallel browser run corrupts `node_modules` | Browser runs are serialised (see the critical path note). |
