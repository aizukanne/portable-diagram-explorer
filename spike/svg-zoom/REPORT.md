# SP-1 — SVG in `<img>` under the renderer's CSS transform (issue #22)

Throwaway measurement. Page structure and CSS copy `src/ui/renderer.js` / `src/styles/renderer.css`
(`img.pde-image` at natural size in `div.pde-scene`, `translate() scale()`, `transform-origin: 0 0`,
`will-change: transform`). Viewport 800x600, **device scale factor forced to 1** in all engines.
Engines: Playwright 1.64.1 Chromium, Firefox, WebKit, headless, in the pinned Docker container
(software rendering, no GPU). Run: `PW_CONFIG=spike/svg-zoom/playwright.config.mjs scripts/e2e.sh`.
Generated SVGs are gitignored; `gen.mjs` and the spec regenerate them.
Sharpness/naturalWidth: add `-g sharpness`; pan: `-g "pan cost"` (the pan tables were produced before the spec was split in two; the pan code is unchanged).

## (a) Sharpness at rest (300 ms after the transform settles)

Metric: crop of 120x60 px around a hard vertical edge, luminance along the middle row. `step` =
largest luminance jump between adjacent pixels (255 = a perfectly crisp black/white edge); `ramp` =
pixels strictly between 10% and 90% luminance (0 = crisp; a single anti-aliased pixel at a sub-pixel
edge position gives ramp 1 and step below 255, which is the ideal vector result). Raster reference =
the same drawing screenshotted at 1x as a PNG (for the 2000x1600 drawing, the 400x300 region around the
edge), shown at the same scale/translate. Drawings: `edge.svg` (400x300) and `edge-big.svg` (2000x1600,
hard 500x400 black rectangle, left edge at x=1000), so 1600% is an effective 32,000 x 25,600 px raster.
The sub-pixel row is scale 3.7 with the edge placed at x = 200.37 px. Cells are `step / ramp`, SVG | PNG.
Conditions: DPR 1, headless software rendering, at rest, one run (`sharp-*.json`, final run).

| Cell | Chromium SVG \| PNG | Firefox SVG \| PNG | WebKit SVG \| PNG |
|---|---|---|---|
| edge 400x300 @25% | 255/0 \| 255/0 | 255/2 \| 223/2 | 255/1 \| 255/0 |
| edge 400x300 @100% | 255/0 \| 255/0 | 255/0 \| 255/0 | 255/0 \| 255/0 |
| edge 400x300 @400% | 255/0 \| 64/4 | 255/0 \| 64/4 | 255/0 \| 64/4 |
| edge 400x300 @1600% | 255/0 \| 16/13 | 255/0 \| 16/13 | 255/0 \| 16/12 |
| edge 400x300 @370% +0.37px | 122/1 \| 75/3 | 255/0 \| 80/3 | 161/1 \| 69/3 |
| big 2000x1600 @100% | 255/0 \| 255/0 | 255/0 \| 255/0 | 255/0 \| 255/0 |
| big 2000x1600 @400% | 255/0 \| 64/4 | 255/0 \| 64/4 | 255/0 \| 64/4 |
| big 2000x1600 @1600% | 255/0 \| 16/13 | 255/0 \| 16/13 | 255/0 \| 16/12 |
| big 2000x1600 @370% +0.37px | 122/1 \| 75/3 | 255/0 \| 80/3 | 161/1 \| 69/3 |

Reading: at every measured cell the SVG is crisp in all three engines, including the 2000x1600 drawing
at 1600% (no sign of a raster/texture-size cap at the edge in view). At the non-integer scale with a
sub-pixel edge, SVG shows a ramp of 1 px (one anti-aliased pixel; Firefox snaps the edge to a whole pixel,
ramp 0) against 3 px for the PNG. The only SVG ramp above 1 is Firefox at 25% (2 px; the PNG is also 2).
The PNG blurs from 400% upward (ramp 4, then 12-13 px). Not measured: other non-integer scales, the
grid drawings' text, fractional DPR, GPU rasterisation.

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

**Re-raster-at-rest needed: Chromium no, Firefox no, WebKit no, for the conditions measured only:**
DPR 1, headless software rendering, at rest (300 ms after the transform), a hard black/white edge, scales
25%, 100%, 370% (+0.37 px sub-pixel), 400% and 1600%, on a 400x300 and a 2000x1600 drawing. Every one of
those cells was crisp in all three engines (step 255 or a single anti-aliased pixel; ramp 0-1, 2 for
Firefox at 25% only), while the PNG reference blurred. Not covered: DPR 2, GPU rasterisation, mid-gesture
sharpness, huge drawings other than this one.

**Element-count warning threshold: not derivable from this data; the brief's rule is triggered but the
cause is not element count.** The brief says keep 200,000 unless p95 exceeds 50 ms below that count.
Strictly, that is the case: Chromium exceeds 50 ms p95 at every count measured, down to 501 elements
(p95 330 ms, median 106 ms), and Firefox/WebKit exceed it in some cells from 501 elements up (all with
large run-to-run variance). In Chromium the cost at 100% does not rise with element count across the counts measured (501: 106 ms
median; 5,001: 79 ms; 100,001: 248 ms), and the same drawings pan at 16-23 ms median at 400%, where fewer
elements are visible and less area is re-rasterised. That is consistent with a cost driven by re-rasterised
area, but this run does not isolate it: area and visible-element count change together between 100% and
400%, and no run varied one while holding the other fixed. Firefox and WebKit stay near 17-25 ms median up
to 100,001 elements. This run therefore does **not** support lowering the V11 warning to any specific
count, nor does it show that 200,000 is safe in Chromium without a GPU. Recommendation: keep 200,000 as the nominal warning for now, and re-measure Chromium
with GPU rasterisation (a real browser, not headless software) before relying on it. Decision for the controller.

## Caveats

- Headless, software-rendered, shared Docker host: frame times are not representative of a user's GPU.
- DPR forced to 1 (WebKit's default profile is 2, not measured).
- Sharpness measured on two hard-edge drawings (`edge.svg`, `edge-big.svg`), not on the grid drawings' text.
- Not measured: mid-gesture sharpness (only at rest), SVG with `<image>`/filters, transform on zoom (only
  translate during panning), memory.
