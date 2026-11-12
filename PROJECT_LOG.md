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
| 2026-11-12 | Owner reviewed the design decisions (21 approved, D11/D12 amended); note bug #15 reproduced | [`2026-11-12_decision-review-and-v1.1.md`](project-logs/2026-11-12_decision-review-and-v1.1.md) |

## Next Session Should Start With

1. ~~Fix the note bug [#15]~~ done 2026-11-12.
2. The D11 amendment (ZIP clutter) is now story S8 of the v1.1 design.
3. **v1.1 epic: build.** The plan is awaiting the owner's review and choice of execution method.
   Order: S1 #17 + S2 #18 → S3 #19 / S4 #20 → S5 #21; spikes SP-1 → S6 #22 and SP-2 → S7 #16; S8 #23
   at any time; S9 #24 last. Browser runs never in parallel.
4. Owner hardware checks, still open: browser matrix and A14 on real hardware [#12], initial-open time
   [#13], screen readers [#14].
