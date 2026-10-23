/**
 * #2513 on the page: uploaded skin packs in the Office view, an office's layout overrides and the layout editor, and
 * crowds in a zones style.
 * - Overrides (fleet-office-pack.js): checked, put on a pack (never changing it), and back again (overridesBetween).
 * - The editor's pure part (fleet-office-layout.js): a seat stays in its area, anything else on the 1280×720 canvas;
 *   waypoints added and removed with their corridors; corridors joined and unjoined.
 * - Crowds (fleet-office-zones.js): an area over capacity packs the rest tighter before "+N"; the "+N" chip is clear of
 *   the area's name; a crowded area's bubbles are thinned (calls, then work; no idle or asleep chatter; a few at most);
 *   no bubble covers a name tag.
 * - The page: the style picker lists the host's packs; an office on a pack is drawn with it once loaded; a pack it cannot
 *   load (unknown, or no manifest) is drawn as Desks and says so; Edit layout for an admin only, saved as overrides with
 *   the rev read, Reset back to the pack's; "Hide paused and stopped" kept per browser.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { page, settle, h, type AppPage } from "./helpers/app-harness.js";
import { fire } from "./helpers/mini-dom.js";

const FIXTURE = join(process.cwd(), "tests", "fixtures", "office-skin-clinic");
const MANIFEST = () => JSON.parse(readFileSync(join(FIXTURE, "manifest.json"), "utf8"));
const FILES = { "office_bg.png": "a".repeat(32), "fox_idle.png": "b".repeat(32) };

const INSTANCES = [
  { name: "atlas", display_name: "Atlas", status: "running", backend: "claude-code" },
  { name: "quill", status: "running", backend: "kiro-cli" },
  { name: "sage", status: "paused", backend: "grok" },
  { name: "nova", status: "stopped", backend: "codex" },
];
const ORG = { general: ["atlas"], teams: [{ name: "Web", members: ["quill", "sage", "nova"] }], instances: {} };
const STORE = { ready: true, instances: INSTANCES, exec: { quill: "working" }, awaiting: {}, needs: [] };

let p: AppPage;
let PK: any, Z: any, K: any, LY: any, app: any, nav: any, fleet: any;
let offices: any = { rev: 0, offices: [] }, skins: any = { rev: "", packs: [] }, manifestAnswer: any = null;
const puts: any[] = [];
beforeAll(async () => {
  p = page({ url: "http://127.0.0.1:19280/ui/fleet/org" });
  (globalThis as any).fetch = async (url: string, o: any = {}) => {
    if (url === "/ui/offices" && o.method === "PUT") { const b = JSON.parse(o.body); puts.push(b); offices = { rev: b.rev + 1, offices: b.offices }; return { ok: true, status: 200, json: async () => offices }; }
    if (url.startsWith("/ui/office-skins/")) return manifestAnswer ? { ok: true, status: 200, json: async () => manifestAnswer } : { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => (url === "/ui/org" ? ORG : url === "/ui/offices" ? offices : url === "/ui/office-skins" ? skins : {}) };
  };
  app = await import("/assets/app-store.js");
  nav = await import("/assets/app-nav.js");
  nav.startRouter(p.window);
  fleet = await import("/ui/js/panel-fleet.js");
  PK = await import("/ui/js/fleet-office-pack.js");
  Z = await import("/ui/js/fleet-office-zones.js");
  K = await import("/ui/js/fleet-office-skin.js");
  LY = await import("/ui/js/fleet-office-layout.js");
});
afterAll(() => { p.restore(); delete (globalThis as any).fetch; });
beforeEach(async () => {
  await p.unmount();
  p.storage.clear();
  offices = { rev: 0, offices: [] }; skins = { rev: "", packs: [] }; manifestAnswer = null; puts.length = 0;
  nav.navigate("/ui/fleet/org");
  app.appStore.set(STORE);
});

const pack = () => PK.skinPackOk(MANIFEST());

describe("layout overrides: on a pack, never changing it", () => {
  it("applyOverrides moves seats, furniture, the door and replaces the graph; overridesBetween gives them back; another pack's change nothing", () => {
    const base = pack();
    const ov = { pack: "clinic-sample", seats: { desks: [[220, 250], [430, 240], [208, 360], [428, 360]] }, door: [600, 700], waypoints: [{ id: "a", x: 1, y: 2 }], edges: [] };
    expect(PK.checkLayoutOverrides(ov)).toEqual({ ok: true, overrides: ov });
    const r = PK.applyOverrides(base, ov);
    expect(r.ok).toBe(true);
    expect([r.pack.areas.desks.seats[0], r.pack.door, r.pack.waypoints, r.pack.edges]).toEqual([{ x: 220, y: 250 }, { x: 600, y: 700 }, [{ id: "a", x: 1, y: 2 }], []]);
    expect(base.areas.desks.seats[0]).toEqual({ x: 212, y: 240 });                       // the pack as it was
    expect(base.door).toEqual({ x: 640, y: 690 });
    expect(PK.overridesBetween(base, r.pack)).toEqual({ pack: "clinic-sample", seats: { desks: ov.seats.desks }, door: [600, 700], waypoints: ov.waypoints, edges: [] });
    expect(PK.overridesBetween(base, base)).toBeNull();
    expect(PK.applyOverrides(base, { ...ov, pack: "other" })).toEqual({ ok: true, pack: base });
    expect(PK.applyOverrides(base, { pack: "clinic-sample", seats: { desks: [[0, 0], [430, 240], [208, 360], [428, 360]] } })).toEqual({ ok: false, error: "overrides.seats.desks[0]: outside its area's rect" });
    expect(PK.checkLayoutOverrides({ pack: "clinic-sample", seats: { desks: [[1300, 0]] } })).toEqual({ ok: false, error: "overrides.seats.desks[0][0]: a number from 0 to 1280" });
  });
  it("officesOk keeps a stored office's overrides when they check, and drops them when they do not", async () => {
    const M = await import("/ui/js/fleet-office-model.js");
    const ov = { pack: "clinic-sample", door: [10, 10] };
    expect(M.officesOk([{ id: "c", name: "C", skin: "clinic-sample", overrides: ov }])[0].overrides).toEqual(ov);
    expect(M.officesOk([{ id: "c", name: "C", skin: "clinic-sample", overrides: { pack: "x", door: [9999, 0] } }])[0]).not.toHaveProperty("overrides");
  });
});

describe("the layout editor's pure part", () => {
  it("handles for every seat, item, the door and waypoint; a seat stays inside its area, the rest on the canvas, rounded", () => {
    const base = pack();
    const keys = LY.handlesOf(base).map((x: any) => x.key);
    expect(keys.filter((k: string) => k.startsWith("seat:"))).toHaveLength(13);
    expect(keys).toContain("door");
    expect(keys).toContain("wp:hall_c");
    const moved = LY.moveHandle(base, "seat:desks:0", 5, 5.4);
    expect(moved.areas.desks.seats[0]).toEqual({ x: 124, y: 140 });                     // clamped to the desks' rect
    expect(LY.moveHandle(base, "door", -40, 9999).door).toEqual({ x: 0, y: 720 });
    expect(LY.moveHandle(base, "wp:hall_c", 100.6, 200.2).waypoints.find((w: any) => w.id === "hall_c")).toEqual({ id: "hall_c", x: 101, y: 200 });
    expect(LY.moveHandle(base, "seat:nope:0", 1, 1)).toBe(base);
  });
  it("waypoints: added with a free name, removed with their corridors; corridors joined, then unjoined either way round", () => {
    const base = pack();
    const { pack: a, id } = LY.addWaypoint(base, 100, 100);
    expect(id).toBe("wp-8");
    const joined = LY.toggleEdge(a, id, "hall_c");
    expect(joined.edges.at(-1)).toEqual([id, "hall_c"]);
    expect(LY.toggleEdge(joined, "hall_c", id).edges).toEqual(base.edges);
    const gone = LY.removeWaypoint(joined, "hall_c");
    expect(gone.edges.some((e: string[]) => e.includes("hall_c"))).toBe(false);
    const ov = LY.layoutOverrides(base, gone);
    expect(PK.checkLayoutOverrides(ov).ok).toBe(true);
    expect(PK.applyOverrides(base, ov).ok).toBe(true);
  });
});

describe("crowds in a zones style", () => {
  const node = (name: string, state: string) => ({ name, state, i: { name } });
  it("an area over capacity packs the rest into a tighter grid before counting who is left; all inside its rect, clear of its name", () => {
    const lounge = K.STUDIO_PACK.areas.lounge;
    const loose = Z.overflowSpots(lounge), tight = Z.overflowSpots(lounge, 60);
    expect(tight.length).toBeGreaterThan(loose.length);
    const r = lounge.rect;
    expect(tight.every((q: any) => q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y + Z.OVERFLOW.TITLE && q.y <= r.y + r.h)).toBe(true);
    // The maintainer's fleet: 70 instances, 42 idle, 26 asleep, 2 working.
    const nodes = [...Array.from({ length: 42 }, (_, i) => node(`i${i}`, "idle")), ...Array.from({ length: 26 }, (_, i) => node(`z${i}`, "paused")), node("w0", "working"), node("w1", "working")];
    const L = Z.zonesLayout(K.STUDIO_PACK, nodes);
    expect(L.crowd.get("lounge") || 0).toBe(0);                                           // the lounge holds all 42
    expect([...L.over].sort()).toEqual(["lounge", "nap"]);
    const spots = [...L.seats.values()].map((s: any) => `${s.x},${s.y}`);
    expect(new Set(spots).size).toBe(spots.length);                                       // still no two share a spot
    expect(spots.length + [...L.crowd.values()].reduce((a: number, b: number) => a + b, 0)).toBe(70);
  });
  it("the +N chip sits in the area's bottom-right corner: never on the band its name is written in", () => {
    const ctx = { save() {}, restore() {}, measureText: (s: string) => ({ width: s.length * 7 }), font: "" };
    for (const a of Object.values(K.STUDIO_PACK.areas) as any[]) {
      const b = K.crowdChip(ctx, a, 42);
      expect(b.y).toBeGreaterThan(a.rect.y + Z.OVERFLOW.TITLE);
      expect(b.x + b.w).toBeLessThanOrEqual(a.rect.x + a.rect.w);
      expect(b.y + b.h).toBeLessThanOrEqual(a.rect.y + a.rect.h);
    }
  });
  it("bubbles: in a crowded area calls first, then work, at most a few; no idle or asleep chatter; an uncrowded area keeps all", () => {
    const it = (key: string, state: string, area = "lounge", shown = 1) => ({ key, state, area, shown });
    const items = [it("a", "idle"), it("b", "working"), it("c", "paused"), it("d", "crashed"), it("e", "needs"), it("f", "working"), it("g", "stuck"), it("h", "idle", "desks")];
    const out = Z.thinBubbles(items, new Set(["lounge"])).map((x: any) => x.key);
    expect(out).toEqual(["h", "d", "e", "g"]);                                             // three calls fill the budget: no work, no chatter
    expect(Z.thinBubbles([it("a", "idle"), it("b", "working"), it("d", "needs")], new Set(["lounge"])).map((x: any) => x.key)).toEqual(["d", "b"]);
    expect(Z.thinBubbles(items, new Set()).length).toBe(items.length);
    expect(Z.thinBubbles(items, null).length).toBe(items.length);
    expect([Z.bubbleRank("crashed"), Z.bubbleRank("working"), Z.bubbleRank("idle")]).toEqual([0, 1, 2]);
  });
  it("placeBubbles: a rank orders them (work before chatter); a blocked box (a name tag) is never covered", () => {
    const box = (x: number, y: number) => ({ x, y, w: 40, h: 19 });
    const chat = { key: "a", calling: false, rank: 2, shown: 9, box: box(0, 0) }, work = { key: "b", calling: false, rank: 1, shown: 1, box: box(10, 0) };
    expect(Z.placeBubbles([chat, work], 22).map((x: any) => [x.key, x.dy])).toEqual([["b", 0], ["a", -22]]);
    const tag = { x: 0, y: 0, w: 60, h: 14 };
    expect(Z.placeBubbles([{ ...chat, box: box(0, 0) }], 22, [tag]).map((x: any) => x.dy)).toEqual([-22]);
    expect(Z.placeBubbles([{ ...chat, box: box(0, 0) }], 22, [tag, { x: 0, y: -30, w: 60, h: 14 }])).toEqual([]);
  });
});

describe("loadPackSkin: an uploaded pack as a skin", () => {
  it("its manifest checked, its pictures by content id; one that is not a pack is null (and tried again next time)", async () => {
    const asked: string[] = [];
    const get = async (url: string) => { asked.push(url); return { ok: true, json: async () => ({ manifest: MANIFEST(), files: FILES }) }; };
    const images: string[] = [];
    const sk = await K.loadPackSkin("clinic-sample", "1".repeat(32), { fetch: get, image: async (u: string) => { images.push(u); return { width: 1 }; } });
    expect([sk.id, !!sk.pack.stateZones]).toEqual(["clinic-sample", true]);
    expect(asked).toEqual([`/ui/office-skins/clinic-sample?v=${"1".repeat(32)}`]);
    expect(images.sort()).toEqual([`/ui/office-skins/clinic-sample/img/${"a".repeat(32)}.png`, `/ui/office-skins/clinic-sample/img/${"b".repeat(32)}.png`]);
    await K.loadPackSkin("clinic-sample", "1".repeat(32), { fetch: get });
    expect(asked).toHaveLength(1);                                                          // fetched once
    const broken = async () => ({ ok: true, json: async () => ({ manifest: { ...MANIFEST(), format: 3 }, files: FILES }) });
    expect(await K.loadPackSkin("clinic-sample", "2".repeat(32), { fetch: broken })).toBeNull();
    expect(await K.loadPackSkin("other-id", "1".repeat(32), { fetch: get })).toBeNull();     // a manifest for another id
    expect(await K.loadPackSkin("clinic-sample", "2".repeat(32), { fetch: get })).not.toBeNull();
  });
});

describe("the Office view with packs", () => {
  const mount = async () => { await p.mount(h(fleet.FleetPanel, { route: { panel: "fleet", tab: "org" }, navKey: `fleet:org|${Math.random()}|en` })); await settle(6); };
  const office = async () => { await mount(); p.root.querySelectorAll(".oc-tools .seg-inline button")[2].click(); await settle(6); };
  const desks = () => p.root.querySelectorAll(".oo-desk").map((b: any) => b.getAttribute("data-name"));
  const auth = (canWrite: boolean) => { (globalThis as any).AgendAuth = { canWrite: async () => canWrite }; (p.window as any).AgendAuth = (globalThis as any).AgendAuth; };
  afterEach(() => { delete (globalThis as any).AgendAuth; delete (p.window as any).AgendAuth; delete document.body.dataset.tier; delete document.body.dataset.publicLink; });
  let sha = 100;
  const withPack = () => { const s = (sha++).toString(16).padStart(32, "0"); skins = { rev: "r", packs: [{ id: "clinic-sample", name: "Clinic", sha: s }] }; manifestAnswer = { manifest: MANIFEST(), files: FILES }; };

  it("the style picker lists the host's packs; the whole fleet in a pack's style", async () => {
    withPack();
    await office();
    const style = p.root.querySelectorAll(".oo-bar select")[1];
    expect(style.querySelectorAll("option").map((o: any) => o.textContent.trim())).toEqual(["Desks", "Studio", "Clinic"]);
    style.value = "clinic-sample"; fire(style, "change"); await settle(8);
    expect(localStorage.getItem("agend_org_office_skin")).toBe("clinic-sample");
    expect(p.root.querySelector(".oo-note")).toBeNull();
    expect(desks()).toEqual(["atlas", "quill", "sage", "nova"]);
  });
  it("an office on an uploaded pack: drawn with it, no note; a pack the page cannot load or the host no longer has: Desks, said so", async () => {
    withPack();
    offices = { rev: 3, offices: [{ id: "clinic", name: "Clinic", skin: "clinic-sample", members: [] }] };
    localStorage.setItem("agend_org_office", "clinic");
    await office();
    expect(p.root.querySelector(".oo-note")).toBeNull();
    await p.unmount();
    withPack(); manifestAnswer = null;                                                       // its manifest does not load
    await office();
    expect(p.root.querySelector(".oo-note")?.textContent).toBe("Its style “Clinic” is not available here: drawn as Desks.");
    await p.unmount();
    skins = { rev: "", packs: [] };                                                          // deleted on the host
    await office();
    expect(p.root.querySelector(".oo-note")?.textContent).toBe("Its style “clinic-sample” is not available here: drawn as Desks.");
  });
  it("Edit layout: an admin only, a stored office on a zones style; hidden for a read-only session, a guest page and the public link", async () => {
    withPack();
    offices = { rev: 3, offices: [{ id: "clinic", name: "Clinic", skin: "clinic-sample", members: [] }, { id: "desk", name: "Desk", skin: "pixel", members: [] }] };
    localStorage.setItem("agend_org_office", "clinic");
    const btn = () => p.root.querySelector(".oo-layout");
    auth(false); await office(); expect(btn()).toBeNull();
    await p.unmount(); auth(true); document.body.dataset.tier = "guest"; await office(); expect(btn()).toBeNull();
    await p.unmount(); delete document.body.dataset.tier; document.body.dataset.publicLink = "1"; await office(); expect(btn()).toBeNull();
    await p.unmount(); delete document.body.dataset.publicLink; await office();
    expect(btn()?.textContent.trim()).toBe("Edit layout");
    const sw = p.root.querySelector(".oo-bar select");
    sw.value = "desk"; fire(sw, "change"); await settle(4);
    expect(btn()).toBeNull();                                                                // Desks: nothing to place
  });
  it("move a seat with the keyboard, add a waypoint and join it: Save sends the office's overrides with the rev read; Reset sends none", async () => {
    withPack();
    offices = { rev: 3, offices: [{ id: "clinic", name: "Clinic", skin: "clinic-sample", members: ["quill"] }] };
    localStorage.setItem("agend_org_office", "clinic");
    auth(true); await office();
    p.root.querySelector(".oo-layout").click(); await settle(4);
    expect(p.root.querySelectorAll(".ol-grid").length).toBeGreaterThan(10);                // show coordinates: on
    const seat = p.root.querySelector('[data-handle="seat:desks:0"]');
    expect(seat.getAttribute("aria-label")).toBe("Seat 1 in desks at 212, 240");
    fire(seat, "keydown", { key: "ArrowRight", shiftKey: true }); await settle(2);
    fire(p.root.querySelector('[data-handle="seat:desks:0"]'), "keydown", { key: "ArrowDown" }); await settle(2);
    expect(p.root.querySelector('[data-handle="seat:desks:0"]').getAttribute("aria-label")).toBe("Seat 1 in desks at 222, 241");
    p.root.querySelector(".ol-add").click(); await settle(2);
    const to = p.root.querySelector(".ol-join-to"); to.value = "hall_c"; fire(to, "change"); await settle(1);
    p.root.querySelector(".ol-join").click(); await settle(2);
    expect(p.root.querySelectorAll(".ol-unjoin").map((b: any) => b.getAttribute("data-other"))).toEqual(["hall_c"]);
    p.root.querySelector(".ol-save").click(); await settle(6);
    expect(puts).toHaveLength(1);
    expect(puts[0].rev).toBe(3);
    const ov = puts[0].offices[0].overrides;
    expect(ov.pack).toBe("clinic-sample");
    expect(ov.seats).toEqual({ desks: [[222, 241], [430, 240], [208, 360], [428, 360]] });
    expect(ov.waypoints.at(-1).id).toBe("wp-8");
    expect(ov.edges.at(-1)).toEqual(["wp-8", "hall_c"]);
    expect(PK.applyOverrides(PK.skinPackOk(MANIFEST()), ov).ok).toBe(true);
    expect(puts[0].offices[0].members).toEqual(["quill"]);                                  // the rest of the office as it was
    expect(p.root.querySelector(".ol")).toBeNull();                                          // closed once saved
    // Reopened, it starts from the saved layout; Reset → the pack's own; Save sends no overrides.
    p.root.querySelector(".oo-layout").click(); await settle(4);
    expect(p.root.querySelector('[data-handle="seat:desks:0"]').getAttribute("aria-label")).toBe("Seat 1 in desks at 222, 241");
    p.root.querySelector(".ol-reset").click(); await settle(2);
    p.root.querySelector(".ol-save").click(); await settle(6);
    expect(puts).toHaveLength(2);
    expect(puts[1].rev).toBe(4);
    expect(puts[1].offices[0]).not.toHaveProperty("overrides");
  });
  it("the offices' editor keeps an office's overrides, lists the packs as styles, and offers the packs' upload and delete", async () => {
    withPack();
    const ov = { pack: "clinic-sample", door: [600, 700] };
    offices = { rev: 3, offices: [{ id: "clinic", name: "Clinic", skin: "clinic-sample", members: [], overrides: ov }] };
    auth(true); await office();
    p.root.querySelector(".oo-edit").click(); await settle(4);
    const style = p.root.querySelector(".oe-style");
    expect(style.querySelectorAll("option").map((o: any) => o.textContent.trim())).toEqual(["Desks", "Studio", "Clinic"]);
    expect(p.root.querySelectorAll(".oe-pack").map((li: any) => li.getAttribute("data-pack"))).toEqual(["clinic-sample"]);
    expect(p.root.querySelectorAll(".oe-upload input").length).toBe(2);
    p.root.querySelector("#oeSave").click(); await settle(6);
    expect(puts[0].offices[0].overrides).toEqual(ov);
  });
  it("Hide paused and stopped: off by default, kept per browser; the sleepers leave the office", async () => {
    await office();
    expect(desks()).toEqual(["atlas", "quill", "sage", "nova"]);
    const box = p.root.querySelector(".oo-hide-asleep input");
    expect(box.checked).toBe(false);
    fire(box, "change"); await settle(4);
    expect(desks()).toEqual(["atlas", "quill"]);
    expect(localStorage.getItem("agend_org_office_hide_asleep")).toBe("1");
    await p.unmount(); await office();
    expect(desks()).toEqual(["atlas", "quill"]);
  });
});

describe("packUpload: what the upload sends from the picked files", () => {
  it("manifest.json parsed, the PNGs as base64 by their name (a folder's path inside it kept); none: said so", async () => {
    const E = await import("/ui/js/fleet-office-editor.js");
    const file = (name: string, bytes: Uint8Array | string, rel = "") => ({ name, webkitRelativePath: rel, text: async () => String(bytes), arrayBuffer: async () => (typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes).buffer });
    const r = await E.packUpload([file("manifest.json", JSON.stringify({ id: "x" }), "pack/manifest.json"), file("idle.png", new Uint8Array([1, 2, 3]), "pack/sprites/idle.png"), file("notes.txt", "hi", "pack/notes.txt")]);
    expect(r).toEqual({ body: { manifest: { id: "x" }, files: { "sprites/idle.png": "AQID" } } });
    expect((await E.packUpload([file("idle.png", "x")])).error).toBe("no manifest.json among the files");
    expect((await E.packUpload([file("manifest.json", "{ nope")])).error).toBe("manifest.json is not JSON");
  });
});
