# Portable Diagram Explorer

Turn existing architecture diagram images into an interactive, drill-down presentation
that anyone can open **offline, by double-clicking one file**. No installation, server, account,
internet connection or browser setting is needed.

You import your PNG, JPEG, WebP or SVG diagrams, draw clickable regions over components, and say
what each component does when clicked: open a more detailed diagram, show a description, or
offer a menu (for example *Open HLD*, *Open LLD*, *Read description*). Your images are never
changed. The editor only adds navigation and notes on top of them.

## Quick start

| You want to… | Open | Then |
|---|---|---|
| **Author** a project | `editor.html` (double-click) | **Add images…**, choose **Add hotspot**, drag over a component, then fill in the inspector on the right |
| **Present** | `name.presentation.html` (double-click) | Click a component; **Back**, the breadcrumbs, **Overview** and **Close** navigate |
| **Continue editing** elsewhere | `editor.html` from the project ZIP | **Open…**, then select the `.diagram.zip` |

A ready-made example is in `dist/sample/` after building: `customer-platform.presentation.html`
(present it) and `customer-platform.diagram.zip` (open it in the editor).

**Version 0.2.0** adds a running order (step through diagrams with Next and Previous), SVG images,
a way for presentations to work inside SharePoint-style previews, and tolerance for packages that
were unzipped and zipped again. Each is described below. Files saved by 0.2.0 use a newer format
that the 0.1.0 editor refuses with a clear message; 0.2.0 opens 0.1.0 files unchanged.

## What the files are

| File | Contents | Use it to |
|---|---|---|
| `name.diagram.zip` | `project.json` (readable JSON: diagrams, hotspots, actions, notes), `assets/` (your original image files, byte for byte), `editor.html` (the editor that saved it), `README.txt` | Keep and continue editing. **This is your saved project.** |
| `name.presentation.html` | One self-contained file: the viewer, its styles, the project data and the images | Send to people who only need to look. It can also be re-imported into the editor. |

**Save project** downloads a new `.diagram.zip`. Browsers do not let a page overwrite your files,
so each save is a new download. Your browser decides where it goes, and the editor cannot
confirm the file was kept.

**Export presentation** downloads the single-file presentation. It is blocked while the project
has errors, such as a link to a missing diagram or a replaced image whose hotspots have not been
reviewed. Warnings do not block it.

You can also select `project.json` **together with** its image files in **Open…**. Images are
matched by their path, then by unique file name. Two files with the same name are refused rather
than guessed between.

## Presenting

- **Hover** or **Tab** to a component to see its tooltip. **Click**, or press **Enter**, to run its
  default action. A component without a default shows its menu.
- **Right-click**, the **⋯** button, **Shift+F10** or the context-menu key all show the same
  menu. Right-clicking anywhere else gives the browser's normal menu.
- **Components** lists every clickable region, which helps with small regions and keyboard use.
  **About this diagram** shows the diagram's description.
- Drag or **Space+drag** to pan. Use the mouse wheel, a pinch, **+**/**−** or **Fit** to zoom.
  **0** fits the diagram.
- In the drill-down window:
  - **Back** (or **Backspace**, **Alt+←**) goes up one level, restoring that level's view,
    selection and open description;
  - breadcrumbs jump to an earlier level;
  - **Overview** and **Close** return to the overview exactly as you left it.
- **Escape** closes, in order, the menu, the description panel, then the drill-down window.
  It never discards edits.
- Diagrams can link to each other freely, including in cycles. After 64 drill-downs in a row you
  are asked to go back or reset, so history stays bounded.

## Running order (presenting in sequence)

By default a presentation is a web of links: you start at the overview and click through. A **running
order** adds a second way in: a list of diagrams shown one after another, the way slides are, whether
or not any component links to them. A project with no running order behaves exactly as in version 1.

- **Next** and **Previous** (the buttons at the bottom, **Right Arrow** / **Page Down** and **Left
  Arrow** / **Page Up**) step through the order. The counter reads "3 of 7" and the breadcrumb shows
  the slide's title. On the last slide Next does nothing and a "Last slide" marker is shown; on the first
  slide Previous does nothing.
- The **jump list** names every slide in order, marks the current one, and works from the keyboard.
- **Home** (in the toolbar) shows the overview. Inside a drill-down window the **Overview** button reads
  **Back to slide** when the window was opened from a slide.
- From inside a drill-down window, Next or Previous closes the window and continues from the last slide
  you were on. Focus moves to the new slide's heading, and screen readers announce "Slide N of M: title".
- On a touch screen, swipe left or right to change slide, but only when the diagram is not zoomed in.
  When zoomed in, the same gesture pans.

In the editor, select a diagram and choose **Add to running order**. The running-order panel lists the
slides; reorder them by dragging or with **Move up** / **Move down**, and remove them from the same panel.
Each change is one undo step. Deleting a diagram that is in the order removes it from the order, the
delete confirmation says so, and undo restores both. The overview is not added automatically.

The sample (`customer-platform.presentation.html`) has a three-slide running order.

## SVG diagrams

SVG files import like images and are shown through an image element, so a script, event handler, embedded
page or external link inside an SVG **never runs and never makes a network request**; the file's bytes are
stored unchanged. If an SVG contains such parts, the import shows a warning naming what will not run or
load. The editor reads the displayed size from the SVG's `width` and `height`, or from its `viewBox`. If it
has neither, it is refused with a message naming the missing attributes and how to add them. When one of the
two sides is a percentage (for example `width="100%" height="400"` with a `viewBox`), the absolute side is
kept and the other is worked out from the `viewBox` proportions. A file that looks like an SVG but cannot be
read as one is refused with its own message. SVG files up to 20 MiB are accepted, with a warning above
200,000 drawn elements, because very large drawings pan slowly. Hotspots stay aligned at any zoom. At the
zoom levels tested (up to 1600%), the drawing stayed sharp; sharpness on high-density screens is not yet
verified.

## Presentations inside SharePoint and other host pages

Some sites (SharePoint and OneDrive previews are the known case) show an HTML file inside their own page and
apply their own script rules to it. In version 1 that left drill-down windows empty. Version 0.2.0 does two
things:

1. If the host stamps its scripts with a one-time code (a nonce), the presentation passes that code to the
   sealed frame that draws drill-downs, so the host's rules accept it. Isolation is unchanged.
2. If the frame still has not started after 4 seconds, drill-downs are drawn in the page itself instead, with
   slightly reduced isolation. Author text is still inserted as plain text only, and SVG is still shown as an
   image.

Whenever a presentation runs inside another page, a notice says so and suggests downloading the file and
opening it in a browser. If the in-page fallback is running, the notice adds that drill-downs are shown with
reduced isolation. **Dismiss** hides the notice for that visit (it comes back if the fallback starts later). The notice
does not appear when the file is opened directly. In the editor's own preview the hosting sentence is hidden, but if the
in-page fallback ever ran there the reduced-isolation sentence would still be shown.

**This is tested against a model of SharePoint's rules, not against SharePoint.** The owner's own check is
described in `docs/lg1-sharepoint-check.md` and has not been run yet.

## Re-zipped packages

A `.diagram.zip` that was unpacked and packed again on macOS (with `__MACOSX/` folders and `.DS_Store`) or Windows (with
`Thumbs.db` and `desktop.ini`) opens. A dialog, "Opened, with notes", lists every skipped file by name. A single wrapping
folder around the package's files is removed. Any other unexpected file is still refused.

## Authoring

- **Diagrams** (left): thumbnails, the ★ overview marker, and how many links point to each
  diagram.
- **Canvas** (centre):
  - **Select** (V) moves and resizes hotspots with handles; arrow keys nudge (Shift for 10 px).
  - **Add hotspot** (H) draws a hotspot.
  - **Add note** (N) places visible text on the diagram.
  - **Ctrl+D** duplicates, **Delete** removes, and **Ctrl+Z**/**Ctrl+Shift+Z** undo and redo
    (100 steps).
- **Inspector** (right):
  - **Hotspot:** label (the accessible name), tooltip, exact position in % of the image, stacking
    order, and the ordered action list. Choose which action is the default, or none to make a
    click show the menu.
  - **Diagram:** title, description, replace image, set as overview, delete.
- **Replacing an image** keeps every hotspot. If the new image has different proportions, the
  diagram is flagged and export is blocked until you check the hotspots and choose **Mark
  alignment reviewed**.
- **Deleting a diagram** that other components link to asks whether to point those links at
  another diagram or remove them. It can be undone.
- **Preview** shows the presentation exactly as recipients will see it.
- The **problems** button lists every error and warning. Each one names the field, the value
  found, what is accepted, why it matters, and how to fix it, with a **Go to** link.

## Limits

| | Limit |
|---|---|
| Image formats | PNG, JPEG, WebP, SVG (20 MiB limit for SVG). PDF is not imported. |
| Image size | Warning above 4096 px on a side; refused above 100 million pixels |
| Running order | 1 to 500 slides, each diagram at most once |
| Tested envelope | 50 diagrams, 1,000 hotspots, 100 hotspots per diagram, 50 MiB of images. Larger exports are allowed after a warning. Measurements are in `docs/acceptance-report.md`. |
| Hotspot shape | Rectangles |
| Text | Plain text; line breaks are kept and nothing is interpreted as HTML |
| Browsers | Current Chrome, Edge, Firefox and Safari on desktop. See the acceptance report for what was actually tested. |

## Security and privacy

- Everything stays on your computer. Opening and presenting make **zero network requests**: each
  file carries a Content-Security-Policy that blocks network access, with every script and style
  admitted by hash.
- Drill-down views render in one sandboxed iframe (scripts only: no same-origin access,
  navigation, pop-ups or forms). The parent accepts a message from it only on the correct
  channel, in sequence, for the scene currently shown, and naming a component of that scene.
  The one exception: if a host page stops the frame from starting, drill-downs are drawn in the page
  after 4 seconds, with reduced isolation, and a notice says so.
- Imported packages are treated as untrusted:
  - unexpected files, path traversal, duplicate names, oversized and over-compressed archives are
    refused by name;
  - image types are checked from the bytes (an SVG must really be an SVG with a size);
  - an `editor.html` inside an imported package is never used.
- Hiding the editor (sending only the presentation) is a convenience, **not** protection: the
  presentation contains the full project data and images.

## Building from source

The output is plain HTML with no runtime dependencies. Building needs Node.js and nothing else;
it has been built and tested with Node 24 (host) and Node 26 (inside the Playwright container).

```bash
npm run build      # dist/editor.html, dist/presentation-template.html, dist/sample/*, schema
npm test           # unit tests (Node's built-in runner)
scripts/e2e.sh     # browser tests in Chromium, Firefox and WebKit via the pinned Playwright container
PDE_A14=1 scripts/e2e.sh test/e2e/a14-envelope.spec.mjs   # the A14 envelope measurement (slow; the 66 MiB file is built once, atomically, and shared by the engines)
scripts/render-sample.sh                # re-render the sample images from samples/customer-platform/layout.mjs
```

Layout: `src/core/` (DOM-free: schema, validation, ZIP, packaging, geometry, navigation, frame
protocol), `src/ui/` (renderer, frame, viewer, editor), `schema/project.schema.json` (generated
from `src/core/project-schema.js`), `docs/` (specification, design, plan, acceptance report).

The project format is documented by `schema/project.schema.json` and section 9 of the
specification. Version 0.2.0 writes `schemaVersion` 2 (adds the optional `sequence` and the SVG type) and reads
1 and 2; a version 1 file is saved as version 2 on first save, and the editor says so. Design for 0.2.0:
`docs/superpowers/specs/2026-11-12-pde-v1.1-design.md`.
