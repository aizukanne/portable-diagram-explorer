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

## Key decisions

- The two amendments are behaviour changes, so each gets an issue and a regression test. They are not
  edited in place.

## Stopping point / next

See PROJECT_LOG "Next Session Should Start With".
