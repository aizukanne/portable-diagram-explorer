# SP-1 — SVG in `<img>` under the renderer's CSS transform (issue #22)

Throwaway measurement. Page structure and CSS copy `src/ui/renderer.js` / `src/styles/renderer.css`
(`img.pde-image` at natural size in `div.pde-scene`, `translate() scale()`, `transform-origin: 0 0`,
`will-change: transform`). Viewport 800x600, **device scale factor forced to 1** in all engines.
Engines: Playwright 1.64.1 Chromium, Firefox, WebKit, headless, in the pinned Docker container
(software rendering, no GPU). Run: `PW_CONFIG=spike/svg-zoom/playwright.config.mjs scripts/e2e.sh`.
Generated SVGs are gitignored; `gen.mjs` and the spec regenerate them.

## (a) Sharpness at rest (300 ms after the transform settles)

Drawing: `edge.svg` (400x300, a black 100x100 square on white). Metric: crop of 120x60 px around the
square's left edge, luminance along the middle row. `step` = largest luminance jump between adjacent
pixels (255 = a perfectly crisp black/white edge); `ramp` = pixels strictly between 10% and 90%
luminance (0 = crisp). The raster reference is the same SVG screenshotted at 1x as a PNG, shown the same way.

| Engine | SVG 400% step/ramp | SVG 1600% step/ramp | PNG 400% step/ramp | PNG 1600% step/ramp | SVG blurred? |
|---|---|---|---|---|---|
| Chromium | 255 / 0 | 255 / 0 | 64 / 4 | 16 / 13 | **no** |
| Firefox | 255 / 0 | 255 / 0 | 64 / 4 | 16 / 13 | **no** |
| WebKit | 255 / 0 | 255 / 0 | 64 / 4 | 16 / 12 | **no** |

In every engine the SVG stays perfectly crisp at 400% and 1600% (the browser re-rasterises the
vector at the new scale), while the 1x PNG is visibly blurred (ramp 4 px, then 12-13 px). Sub-100% scales
(25%) were also crisp (ramp 0-2 px). Values identical across all runs.

## (c) `naturalWidth` / `naturalHeight`

| Engine | SVG with `width`/`height` (2000x1600) | SVG with `viewBox` only (0 0 2000 1600) | `<svg width=400 height=300>` |
|---|---|---|---|
| Chromium | 2000 x 1600 | **188 x 150** | 400 x 300 |
| Firefox | 2000 x 1600 | **300 x 240** | 400 x 300 |
| WebKit | 2000 x 1600 | **187 x 150** | 400 x 300 |

Findings: with `width`/`height`, `naturalWidth` is the true size in all three engines. Never 0 and
never the 150 fallback as a width. With `viewBox` only, `naturalWidth` is *not* the drawing's size and
**differs per engine**: Chromium and WebKit pick a height of 150 and derive the width from the aspect
ratio (188 / 187, the two disagree by 1 px); Firefox picks width 300 and derives the height (240).
Also, an `<img>` with only a `viewBox` SVG and no CSS size has a laid-out box of **0x0** in all three
engines (`img.width`/`img.height` were 0 in this renderer CSS). So for a viewBox-only SVG the app must
not trust `naturalWidth`; it must read the `viewBox` (or the `width`/`height`) from the SVG text and set the
image size explicitly.

## (b) Panning cost: 60 rAF frames of translate changes (frame deltas, ms)

Each cell is median / p95 from the final run (run 3). Pan = 61 rAF timestamps -> 60 deltas, after one
warm-up pan, with the drawing 2000x1600 px natural size in an 800x600 viewport. 16.7 ms is the floor
(60 Hz).

| Drawing (elements) @ scale | Chromium | Firefox | WebKit |
|---|---|---|---|
| 501 @100% | 105.6 / 329.9 | 18 / 61 | 18 / 40 |
| 1,001 @100% | 90.7 / 245.1 | 18 / 95 | 24 / 51 |
| 2,001 @100% | 128.2 / 540.7 | 17 / 29 | 38 / 303 |
| 5,001 @100% | 79 / 144.4 | 17 / 37 | 23 / 40 |
| 5,001 @400% | 16.4 / 25 | 22 / 132 | 16 / 18 |
| 20,001 @100% | 95.5 / 293.4 | 25 / 165 | 25 / 42 |
| 100,001 @100% | 248.3 / 1780.7 | 17 / 23 | 23 / 56 |
| 100,001 @400% | 22.8 / 88 | 17 / 31 | 18 / 48 |

Earlier runs of the 5k and 100k rows, p95 in ms as run 1 / run 2:

| Row | Chromium | Firefox | WebKit |
|---|---|---|---|
| 5k @100% | 179 / 426 | 59 / 30 | 153 / 28 |
| 5k @400% | 59 / 135 | 26 / 40 | 222 / 41 |
| 100k @100% | 1431 / 1574 | 49 / 28 | 358 / 59 |
| 100k @400% | 46 / 51 | 41 / 28 | 137 / 73 |

Load time of the 100,001-element SVG (8.4 MB) into the `<img>`: Chromium 6.7-13.9 s, Firefox 6.7-7.4 s,
WebKit 8.1-17.2 s.

Noise is large: single 60-frame runs on a shared host, software rendering; the same cell varied up to
about 3x between runs (e.g. WebKit 100k@100% p95 358 -> 59 ms). Treat p95 as indicative to within a factor of
about 3, not as a benchmark.

## Decisions

**Re-raster-at-rest needed: Chromium no, Firefox no, WebKit no.** At rest all three re-rasterise the
SVG sharply at 400% and 1600% under `will-change: transform`; the app does not need its own
re-raster-at-rest step for SVG images (rasters, by contrast, blur, which is expected).

**Element-count warning threshold: not derivable from this data; the brief's rule is triggered but the
cause is not element count.** The brief says keep 200,000 unless p95 exceeds 50 ms below that count.
Strictly, that is the case: Chromium exceeds 50 ms p95 at every count measured, down to 501 elements
(p95 330 ms, median 106 ms), and Firefox/WebKit exceed it in some cells from 501 elements up (all with
large run-to-run variance). But Chromium's cost at 100% does not grow with element count (501: 106 ms
median; 5,001: 79 ms; 100,001: 248 ms) while the same drawings pan at 16-25 ms at 400%, so the driver in
this setup is the size of the area being re-rasterised in software, not the number of elements.
Firefox and WebKit stay near 17-25 ms median up to 100,001 elements. This run therefore does **not**
support lowering the V11 warning to any specific count, nor does it show that 200,000 is safe in Chromium
without a GPU. Recommendation: keep 200,000 as the nominal warning for now, and re-measure Chromium
with GPU rasterisation (a real browser, not headless software) before relying on it. Decision for the controller.

## Caveats

- Headless, software-rendered, shared Docker host: frame times are not representative of a user's GPU.
- DPR forced to 1 (WebKit's default profile is 2, not measured).
- Sharpness measured on a small high-contrast drawing (`edge.svg`), not on the grid drawings.
- Not measured: mid-gesture sharpness (only at rest), SVG with `<image>`/filters, transform on zoom (only
  translate during panning), memory.
