// SVG test fixtures for the build (dist/test/images/*.svg).
export { DIAGRAM_SVG } from './svg-diagram.mjs';

// Everything an SVG can carry that must never run or load. Used by the A23 inertness test.
export const RISKY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="800" onload="window.top.pwned=2">
  <style>@import url(https://example.invalid/a.css); rect { fill: #fde68a }</style>
  <script>window.top.pwned=1</script>
  <rect width="1200" height="800" onclick="window.top.pwned=3"/>
  <image href="https://example.invalid/x.png" width="100" height="100"/>
  <foreignObject x="10" y="10" width="300" height="100"><div xmlns="http://www.w3.org/1999/xhtml"><img src="https://example.invalid/y.png"/></div></foreignObject>
  <a href="https://example.invalid/"><text x="600" y="400">Risky</text></a>
</svg>
`;

// No width, height or viewBox: its size cannot be known.
export const NOSIZE_SVG = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>
`;
