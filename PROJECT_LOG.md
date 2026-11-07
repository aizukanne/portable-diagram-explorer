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

## Next Session Should Start With

1. **Owner review of the design decisions** (spec Part 2). None has been reviewed. The ones that
   most affect users: D18, the Escape order; the focus rule in the acceptance report's A07 note;
   D20, alignment review blocking export; D11, the archive limits.
2. **Run the browser matrix on real hardware:** branded Safari on macOS, Edge on Windows, and A14
   on a reference laptop. These are open items in the issue tracker; until then those browsers are
   unproven, not failed.
3. **Initial-open time for maximum-size presentations in Firefox and WebKit** (3.4–15.6 s on the
   test server, against a 5 s target). Measure on real hardware before changing anything.
