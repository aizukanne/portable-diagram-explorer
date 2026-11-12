// The clean SVG fixture, shared by the build (dist/test/images/diagram.svg) and the renderer harness.
// Kept apart from the risky fixture because the harness is bundled into an inline script.
// The marker rect sits at the same fractions as the harness hotspot (0.25, 0.25, 0.5, 0.5).
export const DIAGRAM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <rect width="1200" height="800" fill="#f4f7fb"/>
  <rect x="300" y="200" width="600" height="400" fill="#9ec5fe" stroke="#0b3d91" stroke-width="4"/>
  <text x="600" y="410" text-anchor="middle" font-size="40" fill="#0b3d91">Marker</text>
</svg>
`;
