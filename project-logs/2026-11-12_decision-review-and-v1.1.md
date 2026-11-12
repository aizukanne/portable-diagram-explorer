# 2026-11-12 — owner decision review, note bug, v1.1 scope

## Work done

- **Owner review of the design decisions (spec Part 2), in dialogue.** 21 approved as built, two
  amended. Recorded in the design doc's register.
  - D11 amended: skip known OS clutter entries in imported ZIPs (`__MACOSX/`, `.DS_Store`,
    `Thumbs.db`, `desktop.ini`) and tell the author which were skipped. Other unknown entries are
    still rejected by name.
  - D12 amended: the owner wants SVG accepted. Carried into the next feature epic, because it needs
    its own security design.
- **Bug, reported by the owner: notes cannot be edited or removed once deselected.** Reproduced in
  Chromium, Firefox and WebKit with `test/e2e/note-reselect.spec.mjs`. Cause: the full-size hotspot
  SVG layer sits above the notes layer and intercepts every click. Notes are also missing from the
  diagram inspector, so no keyboard route exists either. Filed as #15.
- **New feature asked by the owner:** move to a next slide or image that no hotspot links to.
  Design to follow, in the same epic as SVG support.

- **#15 fixed** (commit after the review commit): the hotspot layer no longer takes clicks itself,
  only hotspots and handles do; a hotspot wins over a note beneath it; the diagram inspector lists notes.
  Verification: unit 112/112, browser 141/141 in Chromium, Firefox and WebKit, including two new
  regression tests in `test/e2e/note-reselect.spec.mjs`.
- **New defect #16, reported by the owner:** a presentation viewed inside SharePoint/OneDrive's
  browser preview shows blank drill-down windows. The console capture shows the viewer's own security
  policy blocking our drill-down frame's script (hash `do+AvlM…` matches the v1 build). This is a
  different defect from #15 and not fixed by the review rulings. It goes into the v1.1 spec.

- **v1.1 spec + design drafted:** `docs/superpowers/specs/2026-11-12-pde-v1.1-design.md`. It records
  the owner's rulings R1-R9, and every other choice is marked as an agent call. A builder check by an
  independent agent raised 12 questions; all were settled without an owner ruling (§5.8). One real gap
  was found: the frame protocol's image check rejects SVG.

- **Owner approved the v1.1 design** ("Approved, write the plan").
- **Plan, guide and workplan written and committed together:**
  - plan: `docs/superpowers/plans/2026-11-12-pde-v1.1.md` (11 tasks, two of them spikes);
  - guide and workplan: `design/pde-v1.1-guide/`.
  The self-review fixed four things: a navigation test that would have hung, two tests that could not
  tell right from wrong (now discriminating fixtures), a SharePoint harness built on a wrong assumption
  about how browser security policies combine (replaced by a hash-only host model), and a missing check
  for A29 (now run against the real v1 editor).
- **Milestone "PDE v1.1" created; story issues filed:** S1 #17, S2 #18, S3 #19, S4 #20, S5 #21, S6 #22,
  S8 #23, S9 #24. S7 is the existing #16, retitled and moved to the milestone instead of being filed
  twice. The sweep is recorded in every issue.

## Key decisions

- The two amendments are behaviour changes, so each gets an issue and a regression test. They are not
  edited in place.

## Stopping point / next

See PROJECT_LOG "Next Session Should Start With".
