// The Office view's art (fleet-office.js draws with it on a <canvas>). A skin draws a layout that fleet-office-model.js
// made; the built-in one ("pixel") draws everything procedurally — little pixel people, desks, lamps — so no art ships.
// Every drawing call goes through the OfficeSkin interface below, so a skin pack (pictures from an artist) can replace
// any part of it; a part a pack does not supply falls back to the built-in drawing. v1 has no way to add a pack (no
// upload): spriteSkin() and skinPackOk() are the seam a later step plugs into.
//
// ── The interface ──
//
// @typedef {"working"|"idle"|"paused"|"needs"|"walk"} OfficePose   (fleet-office-model.js POSES; "away" draws no one)
// @typedef {{ pal: OfficePalette, mode: "dark"|"light", labels: { lobby: string, closed: string } }} OfficeEnv
// @typedef {{ name: string, label: string, pose: OfficePose|"away", light: "warn"|"danger"|null, lamp: boolean,
//   sign: "closed"|null, coat: string, work: number, dim: boolean, match: boolean }} OfficeLook   (one desk's occupant)
// @typedef {object} OfficeSkin
// @property {string} id
// @property {{ seats, waypoints, edges }} [layout]  a default layout for an office that has none of its own
// @property {(ctx, L, env) => void} drawFloor            under everything: the stage and the corridors (L.edges)
// @property {(ctx, room, env) => void} drawRoom          a room's floor, wall and name (room: autoLayout's)
// @property {(ctx, desk, look, env) => void} drawDeskBack    behind the character: chair, desk top, screen, lamp
// @property {(ctx, desk, look, ms, env) => void} drawCharacter   the occupant in its pose at time `ms` (0: still)
// @property {(ctx, desk, look, env) => void} drawDeskFront   in front: the desk's front, its sign, folders, name tag
// @property {(ctx, prop, ms, env) => void} drawProp      a traffic item in the air: { kind, hue, x, y, t }
// The back and front layers change only when the fleet does; the renderer keeps them as pictures and draws only the
// characters and the props each frame.
//
// ── A skin pack: what an artist supplies (skinPackOk checks it) ──
//
// A JSON manifest plus PNG images (pixel art: drawn unsmoothed at an integer `scale`, default 2):
//   {
//     "id": "cozy",                                   letters, digits, - and _ (≤ 40)
//     "scale": 2,                                     1–8: one image pixel is this many CSS px
//     "room":  { "floor": "floor.png", "wall": "wall.png" },    floor: a tile repeated over each room; wall: stretched
//                                                     over the room's header band (26 CSS px tall)
//     "desk":  { "back": "desk-back.png", "front": "desk-front.png", "lit": "desk-back-lit.png" },
//                                                     each the size of a desk cell (96×104 CSS px: 48×52 at scale 2),
//                                                     drawn at the cell's top-left; back behind the character, front
//                                                     over it; lit replaces back while the instance works (lamp on)
//     "characters": {                                 character sets; "default" is required
//       "default": { "working": STRIP, "idle": STRIP, "paused": STRIP, "needs": STRIP, "walk": STRIP },
//       "fox": { … } },
//     "byInstance": { "atlas": "fox" },               optional: an instance name → its character set
//     "props": { "task": STRIP, "send": STRIP, "report": STRIP, "broadcast": STRIP },   traffic items by kind
//     "layout": { "seats": [{ "id", "x", "y" }], "waypoints": [{ "id", "x", "y" }], "edges": [["a", "b"]] }  optional
//   }
// A STRIP is { "src": "idle.png", "frames": 4, "w": 24, "h": 32, "fps": 4, "ax": 12, "ay": 13 }: `frames` frames of w×h
// image px side by side, left to right, no gaps (the image is frames·w × h); played at `fps` (0: the first frame only,
// as with reduced motion); (ax, ay) is the image point placed on the seat (a character) or on the item's position (a
// prop). A pose a set lacks uses its "idle"; a part the pack lacks is drawn by the built-in skin.
import { frameAt } from "./fleet-office-model.js";

// ── The palette: the dashboard's tokens, read by the renderer; furniture keeps its own wood and metal ──

/** @typedef {{ bg, surface, surface2, border, text, text2, text3, ok, warn, danger, focus, fx: { task, send, report, broadcast } }} OfficePalette */
export const DEFAULT_PAL = {
  bg: "#212121", surface: "#2f2f2f", surface2: "#3a3a3a", border: "#3d3d3d", text: "#ececec", text2: "#b4b4b4", text3: "#a3a3a3",
  ok: "#4cc38a", warn: "#e3b341", danger: "#ff8a80", focus: "#7ab7ff", fx: { task: "#b794f6", send: "#2dd4bf", report: "#f472b6", broadcast: "#fb923c" },
};
/** Light or dark, from the page's own background token (whatever chose it: the person, the system, a theme). */
export function modeOf(pal) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(pal && pal.bg).trim());
  if (!m) return "dark";
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? "light" : "dark";
}
const ROOM = {
  dark: { floorA: "#2b313b", floorB: "#272c35", wall: "#363d49", wallLine: "#454e5d", lobbyA: "#2f3330", lobbyB: "#2b2f2c", corridor: "#2a2a2a" },
  light: { floorA: "#efe7d8", floorB: "#e8dfcd", wall: "#ddd0b8", wallLine: "#cdbd9f", lobbyA: "#e6eadf", lobbyB: "#dfe4d7", corridor: "#ececec" },
};
const WOOD = { top: "#b07a45", edge: "#8a5a30", front: "#7a4f2a", leg: "#5c3b1f" };
const METAL = { frame: "#2b2f36", screenOff: "#3d4752", screenOn: "#9fe3ff", code: "#2d6f8f", pole: "#6b6f76", shade: "#d9b13b", chair: "#454b57", chairTop: "#545b69" };
const SKIN_TONES = ["#f2c9a0", "#e5b48a", "#c98e62", "#9a6440"];
const HAIR = ["#3b2a20", "#6b4423", "#c48a3a", "#1f1f24", "#7a4f8f", "#b9b9c2", "#a8452f"];
/** A small stable number from a name: the same instance always gets the same hair and skin. */
export const nameHash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

const P = 3;                                             // one art pixel of a character, in CSS px
const CX = 44, TOP = 14;                                 // the character's centre and head top in its desk cell
const px = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
/** An art-pixel block of the character at desk `d`: column c, row r (0, 0 is the head's top-left), w×h art px. */
const art = (ctx, d, c, r, w, h, color, dy = 0) => px(ctx, d.x + CX - 5 * P + c * P, d.y + TOP + dy + r * P, w * P, h * P, color);

/** Text shortened to `max` px with an ellipsis (canvas measures; a grapheme cluster is not split). */
export function fitText(ctx, s, max) {
  const str = String(s);
  if (!ctx.measureText || ctx.measureText(str).width <= max) return str;
  const chars = Array.from(str);
  while (chars.length && ctx.measureText(`${chars.join("")}…`).width > max) chars.pop();
  return `${chars.join("")}…`;
}

// ── The built-in pixel skin ──

function drawFloor(ctx, L, env) {
  const r = ROOM[env.mode];
  ctx.save();
  ctx.strokeStyle = r.corridor;
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  const at = new Map(L.waypoints.map((w) => [w.id, w]));
  ctx.beginPath();
  for (const [a, b] of L.edges) { const p = at.get(a), q = at.get(b); if (p && q) { ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); } }
  ctx.stroke();
  ctx.restore();
}

function drawRoom(ctx, room, env) {
  const r = ROOM[env.mode], { pal } = env, T = 16;
  const [a, b] = room.lobby ? [r.lobbyA, r.lobbyB] : [r.floorA, r.floorB];
  px(ctx, room.x, room.y, room.w, room.h, a);
  for (let y = room.y + 26; y < room.y + room.h; y += T) for (let x = room.x + (((y - room.y) / T) % 2) * T; x < room.x + room.w; x += 2 * T) {
    px(ctx, x, y, Math.min(T, room.x + room.w - x), Math.min(T, room.y + room.h - y), b);
  }
  px(ctx, room.x, room.y, room.w, 26, r.wall);
  px(ctx, room.x, room.y + 24, room.w, 2, r.wallLine);
  if (room.lobby) {                                      // a plant by the lobby's wall
    const x = room.x + room.w - 22, y = room.y + 4;
    px(ctx, x + 3, y + 12, 10, 8, "#b5653a"); px(ctx, x, y + 4, 6, 8, "#3f8f4f"); px(ctx, x + 6, y, 5, 12, "#4fa65d"); px(ctx, x + 10, y + 5, 6, 7, "#3f8f4f");
  }
  ctx.save();
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(room.x + 1, room.y + 1, room.w - 2, room.h - 2);
  ctx.fillStyle = pal.text;
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  const name = room.lobby ? env.labels.lobby : room.name;
  ctx.fillText(fitText(ctx, name, room.w - (room.lobby ? 48 : 52)), room.x + 10, room.y + 13);
  if (!room.lobby) {
    ctx.fillStyle = pal.text3;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(String(room.desks.filter((d) => d.node).length), room.x + room.w - 10, room.y + 13);
  }
  ctx.restore();
}

function drawDeskBack(ctx, d, look) {
  ctx.save();
  if (look.dim) ctx.globalAlpha = 0.35;
  // The chair (behind the character), the desk top, the screen, the lamp — and its light while it works.
  px(ctx, d.x + 30, d.y + 26, 30, 26, METAL.chair); px(ctx, d.x + 30, d.y + 26, 30, 4, METAL.chairTop);
  px(ctx, d.x + 8, d.y + 48, 80, 6, WOOD.top); px(ctx, d.x + 8, d.y + 53, 80, 1, WOOD.edge);
  if (look.lamp) {                                       // its light, from the shade down onto the desk
    ctx.fillStyle = "rgba(255, 214, 102, 0.5)";
    ctx.beginPath(); ctx.moveTo(d.x + 11, d.y + 31); ctx.lineTo(d.x + 19, d.y + 31); ctx.lineTo(d.x + 30, d.y + 49); ctx.lineTo(d.x + 8, d.y + 49); ctx.closePath(); ctx.fill();
  }
  px(ctx, d.x + 62, d.y + 28, 24, 18, METAL.frame); px(ctx, d.x + 64, d.y + 30, 20, 13, look.lamp ? METAL.screenOn : METAL.screenOff);
  px(ctx, d.x + 72, d.y + 46, 4, 2, METAL.frame);
  px(ctx, d.x + 11, d.y + 46, 8, 2, METAL.pole); px(ctx, d.x + 14, d.y + 31, 2, 15, METAL.pole);
  px(ctx, d.x + 9, d.y + 26, 12, 5, look.lamp ? "#ffd86b" : METAL.shade);
  ctx.restore();
}

function drawCharacter(ctx, d, look, ms, env) {
  if (look.pose === "away") return;
  const h = nameHash(look.name), skin = SKIN_TONES[h % SKIN_TONES.length], hair = HAIR[(h >>> 3) % HAIR.length];
  const coat = look.coat, shirt = "#f4f1ea", eye = "#1d1d22";
  const f = frameAt(ms, FRAMES[look.pose] || 1, FPS);
  ctx.save();
  if (look.dim) ctx.globalAlpha = 0.35;
  const head = (dy, closed) => {
    art(ctx, d, 2, 0, 6, 2, hair, dy); art(ctx, d, 2, 2, 6, 4, skin, dy); art(ctx, d, 2, 2, 1, 2, hair, dy); art(ctx, d, 7, 2, 1, 2, hair, dy);
    if (closed) { art(ctx, d, 3, 4, 1, 0.34, eye, dy); art(ctx, d, 6, 4, 1, 0.34, eye, dy); }
    else { art(ctx, d, 3, 3, 1, 1, eye, dy); art(ctx, d, 6, 3, 1, 1, eye, dy); }
    art(ctx, d, 2.6, 4.6, 0.7, 0.5, "rgba(255, 120, 120, 0.45)", dy); art(ctx, d, 6.7, 4.6, 0.7, 0.5, "rgba(255, 120, 120, 0.45)", dy);
  };
  const body = (dy) => { art(ctx, d, 1, 6, 8, 5, coat, dy); art(ctx, d, 4, 6, 2, 2, shirt, dy); };
  if (look.pose === "working") {
    head(0, false); body(0);
    // Typing: the hands take turns on the keyboard; the screen's lines change.
    art(ctx, d, 0, 8, 1, 3, coat); art(ctx, d, 9, 8, 1, 3, coat);
    art(ctx, d, 1, f % 2 ? 10.4 : 11, 2, 0.8, skin); art(ctx, d, 7, f % 2 ? 11 : 10.4, 2, 0.8, skin);
    px(ctx, d.x + 30, d.y + 47, 28, 3, "#d8d8dc");
    for (let i = 0; i < 3; i++) px(ctx, d.x + 66, d.y + 32 + i * 4, 4 + ((f + i * 3) % 4) * 3, 2, METAL.code);
  } else if (look.pose === "idle") {
    head(0, false); body(0);
    // Tea: the cup comes up to sip on the second half of the loop; steam rises while it is down.
    const up = f >= 2;
    art(ctx, d, 0, 8, 1, 3, coat);
    if (up) { art(ctx, d, 7, 6, 2, 2, coat); art(ctx, d, 6, 4.7, 2, 1.6, "#ffffff"); art(ctx, d, 6, 4.7, 2, 0.4, "#8a5a30"); }
    else {
      art(ctx, d, 9, 8, 1, 2, coat); art(ctx, d, 8.6, 9.6, 2, 1.8, "#ffffff"); art(ctx, d, 8.6, 9.6, 2, 0.4, "#8a5a30");
      art(ctx, d, 9 + (f % 2) * 0.7, 7.6 - f * 0.5, 0.5, 0.8, "rgba(220, 220, 230, 0.7)");
    }
  } else if (look.pose === "paused") {
    // Asleep: head down on the desk, arms folded under it; Zzz rising.
    body(3); art(ctx, d, 1, 9.2, 8, 1.5, coat); head(4, true);
    ctx.fillStyle = env.pal.text2;
    ctx.font = "700 11px system-ui, sans-serif";
    const zs = ms > 0 ? f + 1 : 3;
    for (let i = 0; i < zs; i++) ctx.fillText(i ? "z" : "Z", d.x + CX + 12 + i * 7, d.y + TOP + 6 - i * 6);
  } else if (look.pose === "needs") {
    head(0, false); body(0);
    // A hand up, waving; the call light over the head blinks (warn, or danger when it crashed).
    art(ctx, d, 0, 8, 1, 3, coat); art(ctx, d, 9, 2 + f, 1, 6 - f, coat); art(ctx, d, 9 - f * 0.4, 1 + f, 1.4, 1.2, skin);
    const on = ms <= 0 || f === 0, c = look.light === "danger" ? env.pal.danger : env.pal.warn;
    ctx.globalAlpha = (look.dim ? 0.35 : 1) * (on ? 1 : 0.35);
    if (on) { ctx.fillStyle = c; ctx.globalAlpha *= 0.25; ctx.beginPath(); ctx.arc(d.x + CX, d.y + 6, 9, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = look.dim ? 0.35 : 1; }
    px(ctx, d.x + CX - 4, d.y + 2, 8, 7, c); px(ctx, d.x + CX - 3, d.y + 9, 6, 2, METAL.pole);
  } else {
    // Walking (a skin pack's strip; drawn here only as a standing step).
    head(f ? -1 : 0, false); body(f ? -1 : 0); art(ctx, d, 0, 7, 1, 3, coat); art(ctx, d, 9, 7, 1, 3, coat);
  }
  ctx.restore();
}

function drawDeskFront(ctx, d, look, env) {
  const { pal } = env;
  ctx.save();
  if (look.dim) ctx.globalAlpha = 0.35;
  if (!look.frontless) {                                 // (a skin pack's desk front drew it already)
    px(ctx, d.x + 10, d.y + 54, 76, 16, WOOD.front); px(ctx, d.x + 10, d.y + 54, 76, 2, WOOD.edge);
    px(ctx, d.x + 12, d.y + 70, 4, 6, WOOD.leg); px(ctx, d.x + 80, d.y + 70, 4, 6, WOOD.leg);
  }
  // The work it was given (a delegation in progress): a folder each, up to three.
  for (let i = 0; i < Math.min(3, look.work); i++) { px(ctx, d.x + 20 - i, d.y + 45 - i * 2, 12, 3, pal.fx.task); px(ctx, d.x + 20 - i, d.y + 44 - i * 2, 5, 1, pal.fx.task); }
  if (look.sign === "closed") {
    px(ctx, d.x + 30, d.y + 57, 36, 11, pal.surface2);
    ctx.strokeStyle = pal.text3; ctx.lineWidth = 1; ctx.strokeRect(d.x + 30.5, d.y + 57.5, 35, 10);
    ctx.fillStyle = pal.text2; ctx.font = "600 8px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(fitText(ctx, env.labels.closed, 32), d.x + 48, d.y + 63);
  }
  // The name tag.
  ctx.fillStyle = pal.surface;
  ctx.fillRect(d.x + 6, d.y + 78, d.w - 12, 16);
  ctx.strokeStyle = look.match ? pal.focus : pal.border;
  ctx.lineWidth = look.match ? 2 : 1;
  ctx.strokeRect(d.x + 6.5, d.y + 78.5, d.w - 13, 15);
  ctx.fillStyle = pal.text; ctx.font = "600 11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(fitText(ctx, look.label, d.w - 18), d.x + d.w / 2, d.y + 86.5);
  ctx.restore();
  if (look.match) { ctx.save(); ctx.strokeStyle = pal.focus; ctx.lineWidth = 2; ctx.strokeRect(d.x + 2, d.y + 2, d.w - 4, d.h - 6); ctx.restore(); }
}

const Q = 2;                                             // a prop's art pixel
function drawProp(ctx, it, ms, env) {
  const c = env.pal.fx[it.hue] || env.pal.fx.send, x0 = it.x - 8, y0 = it.y - 8 - Math.sin(Math.PI * it.t) * 10;
  const b = (c2, r, w, h, col) => px(ctx, x0 + c2 * Q, y0 + r * Q, w * Q, h * Q, col);
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
  ctx.beginPath(); ctx.ellipse(it.x, it.y + 4, 7, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  if (it.hue === "task") { b(0, 0, 4, 2, c); b(0, 1, 8, 6, c); b(0, 2, 8, 1, "rgba(255, 255, 255, 0.35)"); }
  else if (it.hue === "report") { b(1, 0, 6, 8, "#fbfbfb"); b(1, 0, 6, 1, c); b(2, 4, 1, 1, c); b(3, 5, 1, 1, c); b(4, 4, 1, 1, c); b(5, 3, 1, 1, c); }
  else if (it.hue === "broadcast") { b(0, 3, 2, 2, c); b(2, 2, 2, 4, c); b(4, 1, 2, 6, c); if (frameAt(ms, 2, 6)) { b(7, 1, 1, 2, c); b(7, 5, 1, 2, c); } else b(7, 3, 1, 2, c); }
  else { b(0, 1, 8, 6, c); for (const [cc, r] of [[0, 1], [1, 2], [2, 3], [3, 4], [4, 4], [5, 3], [6, 2], [7, 1]]) b(cc, r, 1, 1, "#ffffff"); }
  ctx.restore();
}

/** Frames per pose and the loop's speed (the built-in strips). */
export const FRAMES = { working: 4, idle: 4, paused: 3, needs: 2, walk: 2 };
export const FPS = 4;

/** @type {OfficeSkin} */
export const pixelSkin = { id: "pixel", drawFloor, drawRoom, drawDeskBack, drawCharacter, drawDeskFront, drawProp };

// ── Skin packs (the seam; nothing registers one in v1) ──

const PACK_ID = /^[A-Za-z0-9_-]{1,40}$/;
const SRC = /^[A-Za-z0-9._/-]{1,200}$/;
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const num = (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 4096;
/** A frame strip, checked; null for anything else. */
export function stripOk(x) {
  if (!x || typeof x !== "object" || typeof x.src !== "string" || !SRC.test(x.src) || x.src.includes("..")) return null;
  if (!int(x.frames, 1, 32) || !int(x.w, 1, 512) || !int(x.h, 1, 512)) return null;
  const fps = typeof x.fps === "number" && x.fps >= 0 && x.fps <= 30 ? x.fps : 4;
  return { src: x.src, frames: x.frames, w: x.w, h: x.h, fps, ax: num(x.ax) ? x.ax : x.w / 2, ay: num(x.ay) ? x.ay : x.h / 2 };
}
const srcOk = (s) => (typeof s === "string" && SRC.test(s) && !s.includes("..") ? s : undefined);
const POSE_KEYS = ["working", "idle", "paused", "needs", "walk"], PROP_KEYS = ["task", "send", "report", "broadcast"];
const stripsOf = (o, keys) => Object.fromEntries(keys.map((k) => [k, stripOk(o && o[k])]).filter(([, v]) => v));
/** A skin pack's manifest (format above), checked: unknown keys dropped; null without an id or a default character set. */
export function skinPackOk(x) {
  if (!x || typeof x !== "object" || typeof x.id !== "string" || !PACK_ID.test(x.id) || x.id === "pixel") return null;
  const sets = x.characters && typeof x.characters === "object" ? x.characters : {};
  const characters = {};
  for (const [k, v] of Object.entries(sets).slice(0, 64)) if (PACK_ID.test(k)) { const s = stripsOf(v, POSE_KEYS); if (s.idle) characters[k] = s; }
  if (!characters.default) return null;
  const byInstance = {};
  for (const [k, v] of Object.entries(x.byInstance && typeof x.byInstance === "object" ? x.byInstance : {}).slice(0, 500)) if (typeof v === "string" && characters[v]) byInstance[k] = v;
  const room = x.room || {}, desk = x.desk || {};
  return {
    id: x.id, scale: int(x.scale, 1, 8) ? x.scale : 2, characters, byInstance, props: stripsOf(x.props, PROP_KEYS),
    room: { floor: srcOk(room.floor), wall: srcOk(room.wall) }, desk: { back: srcOk(desk.back), front: srcOk(desk.front), lit: srcOk(desk.lit) },
    layout: x.layout && typeof x.layout === "object" ? x.layout : undefined,
  };
}
/** Every picture a pack names (what a loader fetches before spriteSkin draws). */
export const packImages = (pack) => [...new Set([pack.room.floor, pack.room.wall, pack.desk.back, pack.desk.front, pack.desk.lit,
  ...Object.values(pack.characters).flatMap((s) => Object.values(s).map((st) => st.src)), ...Object.values(pack.props).map((st) => st.src)].filter(Boolean))];

/**
 * An OfficeSkin from a checked pack and its loaded pictures (`images`: src → a drawable image). What it lacks, or a
 * picture not loaded, is drawn by the built-in skin.
 */
export function spriteSkin(pack, images, base = pixelSkin) {
  const img = (src) => (src && images.get(src)) || null;
  const strip = (ctx, st, ms, x, y) => {
    const im = img(st && st.src);
    if (!im) return false;
    const f = frameAt(ms, st.frames, st.fps), s = pack.scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, f * st.w, 0, st.w, st.h, Math.round(x - st.ax * s), Math.round(y - st.ay * s), st.w * s, st.h * s);
    ctx.restore();
    return true;
  };
  return {
    id: pack.id,
    layout: pack.layout,
    drawFloor: base.drawFloor,
    drawRoom(ctx, room, env) {
      const floor = img(pack.room.floor), wall = img(pack.room.wall);
      if (!floor) { base.drawRoom(ctx, room, env); return; }
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      const pat = ctx.createPattern(floor, "repeat");
      if (pat) { ctx.fillStyle = pat; ctx.fillRect(room.x, room.y, room.w, room.h); }
      if (wall) ctx.drawImage(wall, room.x, room.y, room.w, 26);
      ctx.fillStyle = env.pal.text; ctx.font = "600 12px system-ui, sans-serif"; ctx.textBaseline = "middle";
      ctx.fillText(fitText(ctx, room.lobby ? env.labels.lobby : room.name, room.w - 20), room.x + 10, room.y + 13);
      ctx.restore();
    },
    drawDeskBack(ctx, d, look, env) {
      const im = img(look.lamp && pack.desk.lit ? pack.desk.lit : pack.desk.back);
      if (!im) { base.drawDeskBack(ctx, d, look, env); return; }
      ctx.save(); ctx.imageSmoothingEnabled = false; if (look.dim) ctx.globalAlpha = 0.35; ctx.drawImage(im, d.x, d.y, d.w, d.h); ctx.restore();
    },
    drawCharacter(ctx, d, look, ms, env) {
      if (look.pose === "away") return;
      const set = pack.characters[pack.byInstance[look.name]] || pack.characters.default;
      ctx.save();
      if (look.dim) ctx.globalAlpha = 0.35;
      const done = strip(ctx, set[look.pose] || set.idle, ms, d.seat.x, d.seat.y);
      ctx.restore();
      if (!done) base.drawCharacter(ctx, d, look, ms, env);
    },
    drawDeskFront(ctx, d, look, env) {
      const im = img(pack.desk.front);
      if (im) { ctx.save(); ctx.imageSmoothingEnabled = false; if (look.dim) ctx.globalAlpha = 0.35; ctx.drawImage(im, d.x, d.y, d.w, d.h); ctx.restore(); }
      // The name tag, the sign and the folders are words and counts: always drawn here.
      base.drawDeskFront(ctx, d, { ...look, frontless: !!im }, env);
    },
    drawProp(ctx, it, ms, env) { if (!strip(ctx, pack.props[it.hue], ms, it.x, it.y)) base.drawProp(ctx, it, ms, env); },
  };
}

/** The skins this page has: the built-in one (a pack would be added here once loaded). */
export const SKINS = new Map([["pixel", pixelSkin]]);
export const skinFor = (id) => SKINS.get(id) || pixelSkin;
