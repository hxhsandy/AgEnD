// #2554: the Office view's "All offices" — every stored office as a tile on one canvas, side by side, each drawn exactly
// as its own view would be (its style, its members, seats, poses, bubbles, walking), scaled into its tile. This module
// is the pure part (fleet-office.js draws it): who is in no office (the lobby tile), where the tiles go, what a point
// on the overview hits, which tiles are on screen, and the traffic that crosses between tiles.
//
// - Shown when at least two offices are stored (overviewOk); an id no stored office can have (ALL_ID: '*' is not an
//   office id's character), kept per device as any office pick is.
// - The tiles: a cell per tile, CELL_W × CELL_H logical units (a zones scene's 1280×720) under a LABEL band, GAP apart,
//   M from the edge. A tile keeps its scene's aspect: a zones scene fills its cell (scale 1); a desks layout (its own
//   computed size) is scaled down to fit the cell when it is larger, never up. Rows are as tall as their tallest tile.
//   The columns: whichever count (1…n) lets the whole overview show largest in the panel (Fit's contain); a tie keeps
//   the fewer columns. The order is the stored order, the lobby last — the same input always gives the same picture.
// - Traffic between people in different tiles is a straight flight between their seats in overview coordinates
//   (createCrossFlights); between two people in the same tile it is that tile's own (createFlights, along its corridors).
import { FLIGHT, along, desksOf, membersOf, pathLength } from "./fleet-office-model.js";
import { hue } from "./fleet-traffic.js";

/** The switcher's "All offices" value: '*' is never in a stored office's id (fleet-office-model.js officeOk). */
export const ALL_ID = "*all";
/** The lobby tile's key: never an office's id. */
export const LOBBY_TILE = "\u0000lobby";
/** The overview's geometry, in logical units. */
export const OV = { CELL_W: 1280, CELL_H: 720, LABEL: 56, GAP: 48, M: 48 };

/** Whether "All offices" is offered: at least two stored offices. */
export const overviewOk = (stored) => Array.isArray(stored) && stored.length >= 2;

/**
 * The people in no stored office, in the org chart's order (General, the teams, the rest): the lobby tile's. An office
 * with no members holds everyone (fleet-office-model.js membersOf), so then nobody is left for the lobby.
 */
export function lobbyNodes(stored, view) {
  const placed = new Set((stored || []).flatMap((o) => membersOf(o, view).map((n) => n.name)));
  const out = new Map();
  for (const n of [...view.top, ...view.teams.flatMap((tm) => tm.nodes), ...view.rest.nodes]) if (!placed.has(n.name) && !out.has(n.name)) out.set(n.name, n);
  return [...out.values()];
}

/** A scene's scale in its tile: as large as fits the cell, never larger than its own size. */
export const tileScale = (w, h) => Math.min(1, OV.CELL_W / Math.max(1, w), OV.CELL_H / Math.max(1, h));

/**
 * The tiles of `scenes` ([{ key, w, h }], in order) in `cols` columns: each { key, x, y, w, h, s (its scale), label:
 * { x, y, w, h } (the band above it) }, and the overview's size. A tile is centred across its cell, at the top of its row.
 */
export function arrangeTiles(scenes, cols) {
  const { CELL_W, CELL_H, LABEL, GAP, M } = OV;
  const n = scenes.length, c = Math.max(1, Math.min(n || 1, Math.floor(cols) || 1));
  const tiles = [];
  let y = M;
  for (let r = 0; r * c < n; r++) {
    const row = scenes.slice(r * c, r * c + c).map((sc) => { const s = tileScale(sc.w, sc.h); return { sc, s, w: Math.max(1, sc.w) * s, h: Math.max(1, sc.h) * s }; });
    const rowH = Math.min(CELL_H, Math.max(...row.map((t) => t.h)));
    row.forEach((t, i) => {
      const x = M + i * (CELL_W + GAP) + (CELL_W - t.w) / 2;
      tiles.push({ key: t.sc.key, x, y: y + LABEL, w: t.w, h: t.h, s: t.s, label: { x, y, w: t.w, h: LABEL } });
    });
    y += LABEL + rowH + GAP;
  }
  const across = Math.min(c, n);
  return { cols: c, tiles, width: 2 * M + across * CELL_W + Math.max(0, across - 1) * GAP, height: n ? y - GAP + M : 2 * M };
}

/** The tiles packed for a `size` panel: the column count whose overview shows largest there (a tie: fewer columns). */
export function tileLayout(scenes, size) {
  let best = arrangeTiles(scenes, 1), bestK = -1;
  for (let c = 1; c <= Math.max(1, scenes.length); c++) {
    const a = arrangeTiles(scenes, c), k = Math.min(size.w / a.width, size.h / a.height);
    if (k > bestK + 1e-9) { best = a; bestK = k; }
  }
  return best;
}

/** The tile whose scene holds the overview point (x, y), or null. */
export const tileAt = (lay, x, y) => lay.tiles.find((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h) || null;
/** The tile whose label band holds the overview point, or null. */
export const labelAt = (lay, x, y) => lay.tiles.find((t) => x >= t.label.x && x < t.label.x + t.label.w && y >= t.label.y && y < t.label.y + t.label.h) || null;
/** Overview → the tile's own scene units, and back; a box in the scene → the overview. */
export const inTile = (t, x, y) => ({ x: (x - t.x) / t.s, y: (y - t.y) / t.s });
export const fromTile = (t, p) => ({ x: t.x + p.x * t.s, y: t.y + p.y * t.s });
export const tileBox = (t, b) => ({ x: t.x + b.x * t.s, y: t.y + b.y * t.s, w: b.w * t.s, h: b.h * t.s });
/** The tiles a view ({ k, x, y }) shows any of in a `size` viewport: the rest are not drawn. */
export function visibleTiles(lay, v, size) {
  return lay.tiles.filter((t) => {
    const x = v.x + t.x * v.k, y = v.y + t.y * v.k;
    return x < size.w && x + t.w * v.k > 0 && y < size.h && y + t.h * v.k > 0;
  });
}

/**
 * A straight flight between two people in different tiles: [the sender's seat, the receiver's] in overview units (the
 * first tile each is in), or null — when either is drawn nowhere, or some tile holds both (that tile carries it along
 * its corridors). `parts`: [{ tile, L }] in the tiles' order.
 */
export function crossPath(parts, from, to) {
  let a = null, z = null;
  for (const p of parts) {
    const ds = desksOf(p.L), da = ds.find((d) => d.node.name === from), dz = ds.find((d) => d.node.name === to);
    if (da && dz) return null;
    if (da && !a) a = fromTile(p.tile, da.seat);
    if (dz && !z) z = fromTile(p.tile, dz.seat);
  }
  return a && z ? [a, z] : null;
}

const MAX_SEEN = 2000;
/**
 * The items in the air between tiles — fleet-office-model.js createFlights's lifecycle (each new item once; none for a
 * stale delegation or with reduced motion), on crossPath's straight line: `frame(now, parts)` → { id, hue, kind, x, y,
 * t } in overview units; a trip with no crossing (both in one tile, or either gone) is dropped.
 */
export function createCrossFlights({ max = FLIGHT.MAX } = {}) {
  const seen = new Set();
  let trips = [];
  return {
    sync(items, now, still = false) {
      let k = 0, started = 0;
      for (const it of items || []) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value);
        if (still || it.phase === "stale") continue;
        trips.push({ id: it.id, from: it.from, to: it.to, kind: it.kind, hue: hue(it.kind), start: now + k++ * FLIGHT.STAGGER_MS, parts: null, pts: null, ms: 0 });
        started++;
      }
      if (trips.length > max) trips = trips.slice(trips.length - max);
      return started;
    },
    frame(now, parts) {
      const out = [];
      trips = trips.filter((f) => {
        if (f.parts !== parts) { f.parts = parts; f.pts = crossPath(parts, f.from, f.to); f.ms = f.pts ? Math.min(FLIGHT.MAX_MS, Math.max(FLIGHT.MIN_MS, pathLength(f.pts) / FLIGHT.SPEED)) : 0; }
        if (!f.pts) return false;
        const t = (now - f.start) / f.ms;
        if (t >= 1) return false;
        if (t >= 0) { const p = along(f.pts, t); out.push({ id: f.id, hue: f.hue, kind: f.kind, x: p.x, y: p.y, t }); }
        return true;
      });
      return out;
    },
    size: () => trips.length,
  };
}
