# Portable Diagram Explorer — Project Log

Offline, no-install interactive diagram explorer: existing architecture images get
clickable regions, drill-down opens in one sandboxed modal iframe, and the result
exports as one HTML file that runs by double-clicking. Per-session detail lives in
[`project-logs/`](project-logs/README.md).

## Key references

- Repository: https://github.com/aizukanne/portable-diagram-explorer (private, branch `main`)
- Specification (owner, v0.1): `docs/superpowers/specs/2026-11-06-portable-diagram-explorer-spec.md`
- Design, spec Part 2 (23 decisions, **not owner-reviewed**): `docs/superpowers/specs/2026-11-06-portable-diagram-explorer-design.md`
- Plan: `docs/superpowers/plans/2026-11-06-pde-v1.md` · Guide + workplan: `design/pde-v1-guide/`
- Acceptance report: `docs/acceptance-report.md`
- Epic milestone: "PDE v1 — portable diagram explorer" (stories #1–#11)

## Sessions

| Date | Topic | Log |
|---|---|---|
| 2026-11-06 | v1 built end to end: spike, design, plan, 11 stories, sample, acceptance report | [`2026-11-06_v1-build.md`](project-logs/2026-11-06_v1-build.md) |
| 2026-11-12 | v1.1 built on feat/v1.1 — 11 tasks, 186 unit / 306 browser tests, 0.2.0 | [`2026-11-12_v1.1-build.md`](project-logs/2026-11-12_v1.1-build.md) |
| 2026-11-12 | Owner reviewed the design decisions (21 approved, D11/D12 amended); note bug #15 reproduced | [`2026-11-12_decision-review-and-v1.1.md`](project-logs/2026-11-12_decision-review-and-v1.1.md) |

## Next Session Should Start With

Version 0.2.0 (v1.1) is merged, pushed and released:
https://github.com/aizukanne/portable-diagram-explorer/releases/tag/v0.2.0 (detail:
[`2026-11-12_v1.1-build.md`](project-logs/2026-11-12_v1.1-build.md)).

1. **LG-1: the owner's SharePoint check.** Use the release's `customer-platform.presentation.html` and
   follow `docs/lg1-sharepoint-check.md`. Attach the console capture to #16, which then closes. Do this
   before anything else: it is the only proof the hosted-viewer fix works on the real host.
2. **Owner hardware checks:** #12 (Safari, Edge, laptop A14, SVG sharpness at DPR 2), #13 (initial-open
   time in Firefox and WebKit), #14 (screen readers and forced colours).
3. **If LG-1 fails,** read the notice text it recorded:
   - "reduced isolation" present means the fallback ran;
   - absent with an empty window means neither path worked.

   Then start from the console capture in #16 and `spike/frame-ready/REPORT.md`.
