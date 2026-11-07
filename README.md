# Portable Diagram Explorer

Turn existing architecture diagram images into an interactive, drill-down presentation
that anyone can open **offline, by double-clicking one file**. No installation, server, account,
internet connection or browser setting is needed.

You import your PNG, JPEG or WebP diagrams, draw clickable regions over components, and say
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

## Limits (version 1)

| | Limit |
|---|---|
| Image formats | PNG, JPEG, WebP. SVG and PDF are not imported. |
| Image size | Warning above 4096 px on a side; refused above 100 million pixels |
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
- Imported packages are treated as untrusted:
  - unexpected files, path traversal, duplicate names, oversized and over-compressed archives are
    refused by name;
  - image types are checked from the bytes;
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
PDE_A14=1 scripts/e2e.sh test/e2e/a14   # the A14 envelope measurement (slow)
scripts/render-sample.sh                # re-render the sample images from samples/customer-platform/layout.mjs
```

Layout: `src/core/` (DOM-free: schema, validation, ZIP, packaging, geometry, navigation, frame
protocol), `src/ui/` (renderer, frame, viewer, editor), `schema/project.schema.json` (generated
from `src/core/project-schema.js`), `docs/` (specification, design, plan, acceptance report).

The project format is documented by `schema/project.schema.json` and section 9 of the
specification.
