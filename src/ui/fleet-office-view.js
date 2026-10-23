// #2540: the Office view's canvas controls — the pure part (fleet-office.js applies it). The office fills the Fleet
// panel; its scene (the zones' 1280×720 logical canvas, or the desks layout) is panned and zoomed like the org chart's
// canvas (fleet-canvas-view.js: the same view { k, x, y }, gestures, wheel and keys), with two things of its own:
//
// - Pixel levels. Zoom snaps so that one logical unit is a whole number of device pixels (k·dpr = 1, 2, 3, …), and the
//   canvas draws unsmoothed, so pixel art stays crisp; below one device pixel a unit (zoomed far out) zoom is continuous.
//   + and − step to the next level; the wheel and a pinch move a raw zoom that is snapped as it passes a level.
// - Fit is the largest pixel level at which the whole scene fits. Only when that would be tiny is the exact, non-integer
//   fit used instead: when no level fits at all (under one device pixel a unit: a phone, a panel narrower than the
//   scene), or when the level is under two thirds of the scale that fits exactly (a 2560 px monitor would show the
//   1280×720 scene at 1:1 in the middle of a mostly empty panel) — a crisp scene in under half the panel's area is
//   worse than a slightly uneven one that fills it. At two thirds or more the crisp level wins.
//
// Around the scene is a matte: the pack's `matte` (fleet-office-pack.js), else the colour of the background's edge
// pixels (sampled once per style: edgeMatte), else the skin's own (a built-in skin's, from the dashboard's tokens).
import { clampK, pinchTo, zoomTo } from "./fleet-canvas-view.js";
import { CANVAS_MAX } from "./fleet-office-model.js";

/** The zoom's range, in CSS px per logical unit. */
export const OK_MIN = 0.1, OK_MAX = 8;
/** Fit takes a pixel level unless it is under this share of the exact fit (see the header). */
export const TINY = 2 / 3;
const EPS = 1e-6;
const clampO = (k) => clampK(k, OK_MIN, OK_MAX);
/** The highest pixel level within the range at this ratio (at least 1). */
const topLevel = (dpr) => Math.max(1, Math.floor(OK_MAX * dpr + EPS));

/** `k` on its pixel level: k·dpr rounded to a whole number when it is 1 or more; as it is (in range) below that. */
export function snapK(k, dpr = 1) {
  const c = clampO(k), n = c * dpr;
  if (n < 1 - EPS) return c;
  return Math.min(topLevel(dpr), Math.max(1, Math.round(n))) / dpr;
}
/** Whether `k` is a pixel level (a whole number of device px per logical unit). */
export const isPixelK = (k, dpr = 1) => k * dpr >= 1 - EPS && Math.abs(k * dpr - Math.round(k * dpr)) < 1e-6;
/** One step in (`dir` > 0) or out: the next pixel level; below one device pixel a unit, by 1.25. */
export function stepK(k, dir, dpr = 1) {
  const n = k * dpr;
  if (dir > 0) {
    if (n >= 1 - EPS) return Math.min(topLevel(dpr), Math.floor(n + EPS) + 1) / dpr;
    return n * 1.25 >= 1 - EPS ? 1 / dpr : clampO(k * 1.25);
  }
  if (n > 1 + EPS) return Math.max(1, Math.ceil(n - EPS) - 1) / dpr;
  return clampO(k * 0.8);
}
/** The view at scale `k` (snapped) about the viewport point (cx, cy). */
export const zoomOffice = (v, k, cx, cy, dpr = 1) => zoomTo(v, snapK(k, dpr), cx, cy);
/** A pinch step: `raw` the unsnapped zoom the pinch has reached; the world point under the old midpoint follows. */
export const pinchOffice = (v, from, to, raw, dpr = 1) => pinchTo(v, from, to, snapK(raw, dpr));

/** The scale at which a `w`×`h` scene fits a `size` viewport: the largest pixel level, unless tiny (the header). */
export function fitK(w, h, size, dpr = 1, margin = 0) {
  const exact = clampO(Math.min((size.w - 2 * margin) / Math.max(1, w), (size.h - 2 * margin) / Math.max(1, h)));
  const n = Math.min(topLevel(dpr), Math.floor(exact * dpr + EPS)), level = n / dpr;
  return n >= 1 && level >= exact * TINY - EPS ? level : exact;     // else tiny: the exact fit (the header says why)
}
/** The whole scene, centred, at fitK. */
export function fitScene(w, h, size, dpr = 1, margin = 0) {
  const k = fitK(w, h, size, dpr, margin);
  return { k, x: (size.w - w * k) / 2, y: (size.h - h * k) / 2 };
}
/**
 * The desks layout's scale when it opens: the pixel level nearest one CSS px a unit (1 on an ordinary or a 2× screen,
 * 4/3 at 150 %, 0.8 at 125 %); the layout wraps at the panel's width over it, so it opens as wide as the panel.
 */
export const desksK = (dpr = 1) => Math.max(1, Math.round(dpr)) / dpr;
/** The view a scene opens on with nothing kept: zones whole (Fit), desks from the top left at desksK. */
export const openingView = (w, h, size, dpr, zones) => (zones ? fitScene(w, h, size, dpr) : { k: desksK(dpr), x: 0, y: 0 });
/** The view kept from leaving the scene: at least `keep` px of it (or all of it, when smaller) stays in the viewport. */
export function clampPan(v, w, h, size, keep = 48) {
  const sw = w * v.k, sh = h * v.k, kx = Math.min(keep, sw, size.w), ky = Math.min(keep, sh, size.h);
  return { k: v.k, x: Math.min(size.w - kx, Math.max(kx - sw, v.x)), y: Math.min(size.h - ky, Math.max(ky - sh, v.y)) };
}

// ── Kept per device, per office: the zoom and the logical point in the middle (the viewport's size may differ) ──

/** What is kept of a view: { k, cx, cy }. */
export const savedOf = (v, size) => ({ k: v.k, cx: (size.w / 2 - v.x) / v.k, cy: (size.h / 2 - v.y) / v.k });
/** A kept view, checked: { k, cx, cy } with finite numbers (k in range), else null. */
export function savedOk(x) {
  if (!x || typeof x !== "object") return null;
  const { k, cx, cy } = x;
  if (![k, cx, cy].every((n) => typeof n === "number" && Number.isFinite(n)) || k <= 0) return null;
  if (Math.abs(cx) > 1e6 || Math.abs(cy) > 1e6) return null;
  return { k: clampO(k), cx, cy };
}
/** The view a kept one gives in a `size` viewport on this device (its zoom snapped to this screen's levels). */
export function viewFromSaved(s, size, dpr = 1) {
  const k = snapK(s.k, dpr);
  return { k, x: size.w / 2 - s.cx * k, y: size.h / 2 - s.cy * k };
}

// ── Drawing ──

/** The cached layers' budget (device px): beyond it they are drawn coarser and scaled up by a whole number. */
export const LAYER_MAX = { side: CANVAS_MAX.side, area: 8 * 1024 * 1024 };
/**
 * The layers' resolution (layer px per logical unit) for a view at `a` device px a unit and a `w`×`h` scene: `a`
 * itself (the layer is blitted 1:1), or — over the budget — `a` divided by the smallest whole number that fits it,
 * so the blit is still an integer scale-up (nearest neighbour: crisp).
 */
export function layerScale(a, w, h, max = LAYER_MAX) {
  const cap = Math.min(max.side / Math.max(1, w), max.side / Math.max(1, h), Math.sqrt(max.area / Math.max(1, w * h)));
  if (a <= cap) return a;
  return a / Math.ceil(a / cap - EPS);
}
/**
 * The matte from a background's edge pixels: `strips` are RGBA pixel arrays (the top and bottom rows, the left and
 * right columns); the mean of their opaque pixels as #rrggbb, or null when none is opaque.
 */
export function edgeMatte(strips) {
  let r = 0, g = 0, b = 0, n = 0;
  for (const s of strips) {
    if (!s || typeof s.length !== "number") continue;
    for (let i = 0; i + 3 < s.length; i += 4) { if (s[i + 3] < 128) continue; r += s[i]; g += s[i + 1]; b += s[i + 2]; n++; }
  }
  if (!n) return null;
  const hx = (v) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}
/** The edge strips of a canvas (its 2d context's pixels), for edgeMatte; null when they cannot be read. */
export function edgeStrips(c) {
  try {
    const g = c && typeof c.getContext === "function" ? c.getContext("2d") : null;
    if (!g || typeof g.getImageData !== "function" || !(c.width > 0) || !(c.height > 0)) return null;
    const w = c.width, h = c.height;
    return [g.getImageData(0, 0, w, 1).data, g.getImageData(0, h - 1, w, 1).data, g.getImageData(0, 0, 1, h).data, g.getImageData(w - 1, 0, 1, h).data];
  } catch { return null; }   // a tainted or lost canvas: the skin's matte
}
