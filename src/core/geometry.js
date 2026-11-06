// Image-space geometry shared by every renderer (spec §7, design D14, D15).
//
// Viewport state is resolution-independent: { cx, cy } is the image point at the
// centre of the view, as fractions of the image, and zoom is relative to "fit".
// One transform maps image pixels to screen pixels: screen = t + s * image.

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 16;
export const DEFAULT_VIEW = Object.freeze({ cx: 0.5, cy: 0.5, zoom: 1 });

const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function fitScale(W, H, availW, availH) {
  if (!(W > 0 && H > 0 && availW > 0 && availH > 0)) return 1;
  return Math.min(availW / W, availH / H);
}

export function viewTransform(W, H, availW, availH, view = DEFAULT_VIEW) {
  const s = fitScale(W, H, availW, availH) * view.zoom;
  return { s, tx: availW / 2 - view.cx * W * s, ty: availH / 2 - view.cy * H * s };
}

export function screenToImage(t, sx, sy) {
  return { x: (sx - t.tx) / t.s, y: (sy - t.ty) / t.s };
}

export function imageToScreen(t, x, y) {
  return { x: t.tx + x * t.s, y: t.ty + y * t.s };
}

export function normalizeView(view) {
  return {
    cx: clampTo(Number.isFinite(view.cx) ? view.cx : 0.5, 0, 1),
    cy: clampTo(Number.isFinite(view.cy) ? view.cy : 0.5, 0, 1),
    zoom: clampTo(Number.isFinite(view.zoom) ? view.zoom : 1, ZOOM_MIN, ZOOM_MAX),
  };
}

// Zoom by `factor`, keeping the image point under screen point (sx, sy) fixed.
export function zoomAt(view, W, H, availW, availH, factor, sx, sy) {
  const zoom = clampTo(view.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  const p = screenToImage(viewTransform(W, H, availW, availH, view), sx, sy);
  const s2 = fitScale(W, H, availW, availH) * zoom;
  const tx2 = sx - p.x * s2;
  const ty2 = sy - p.y * s2;
  return normalizeView({ cx: (availW / 2 - tx2) / (W * s2), cy: (availH / 2 - ty2) / (H * s2), zoom });
}

export function panBy(view, W, H, availW, availH, dx, dy) {
  const { s } = viewTransform(W, H, availW, availH, view);
  return normalizeView({ cx: view.cx - dx / (W * s), cy: view.cy - dy / (H * s), zoom: view.zoom });
}

// Keep a normalized rectangle inside the image with at least `min` size.
export function clampRect(r, min = 0.002) {
  const width = clampTo(r.width, min, 1);
  const height = clampTo(r.height, min, 1);
  return { x: clampTo(r.x, 0, 1 - width), y: clampTo(r.y, 0, 1 - height), width, height };
}

export function normRectFromPoints(a, b) {
  const x0 = clampTo(Math.min(a.x, b.x), 0, 1);
  const y0 = clampTo(Math.min(a.y, b.y), 0, 1);
  const x1 = clampTo(Math.max(a.x, b.x), 0, 1);
  const y1 = clampTo(Math.max(a.y, b.y), 0, 1);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function rectContainsRect(a, b, eps = 1e-9) {
  return b.x >= a.x - eps && b.y >= a.y - eps && b.x + b.width <= a.x + a.width + eps && b.y + b.height <= a.y + a.height + eps;
}

// Round to 6 decimals for storage: sub-pixel on a 100k-pixel image, and stable.
export function roundRect(r) {
  const q = (v) => Math.round(v * 1e6) / 1e6;
  return { x: q(r.x), y: q(r.y), width: q(r.width), height: q(r.height) };
}
