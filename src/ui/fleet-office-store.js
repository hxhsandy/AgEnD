// The Office view's data, behind one small seam (fleet-office.js uses only these calls):
// - the offices people made: the host's (GET / PUT /ui/offices, src/web-office-store.ts — one list for every viewer);
//   what comes back is checked again here (fleet-office-model.js officesOk), never trusted;
// - this browser's own choices (localStorage; blocked storage: this page only, as the canvas's Canvas/List): which
//   office is shown, the auto office's member filter, and its style (skin).
// - the skin packs an admin uploaded (#2513: GET /ui/office-skins, POST to upload one, DELETE to remove one;
//   src/web-office-skins.ts). The office editor and the layout editor call saveOffices() with the whole list and the rev
//   they read (a change in between answers 409).
import { AUTO_ID, filterOk, officesOk } from "./fleet-office-model.js";

const CHOICE_KEY = "agend_org_office", FILTER_KEY = "agend_org_office_filter", SKIN_KEY = "agend_org_office_skin", ASLEEP_KEY = "agend_org_office_hide_asleep";
const PACK_ID = /^[A-Za-z0-9_-]{1,40}$/;
/** The host's list of skin packs, checked: [{ id, name, sha }] (anything odd dropped). */
export function skinListOk(d) {
  const out = [], ids = new Set();
  for (const p of Array.isArray(d && d.packs) ? d.packs.slice(0, 64) : []) {
    if (!p || typeof p.id !== "string" || !PACK_ID.test(p.id) || ids.has(p.id) || typeof p.sha !== "string" || !/^[0-9a-f]{32}$/.test(p.sha)) continue;
    ids.add(p.id);
    out.push({ id: p.id, name: typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 60) : p.id, sha: p.sha });
  }
  return out;
}

/** `fetch`: the caller's (a lease's, so an answer after the person moved on is dropped); `storage`: default localStorage. */
export function createOfficeStore({ fetch: get = globalThis.fetch, storage } = {}) {
  const st = () => { try { return storage || globalThis.localStorage || null; } catch { return null; } };
  const read = (k) => { try { const s = st(); return s ? s.getItem(k) : null; } catch { return null; } };
  const write = (k, v) => { try { const s = st(); if (s) s.setItem(k, v); } catch { /* this page only */ } };
  const headers = { "Content-Type": "application/json" };
  return {
    /** { rev, offices } from the host; null when it could not be read (no offices shown but the auto one). */
    async offices() {
      try {
        const r = await get("/ui/offices", { method: "GET", headers });
        if (!r || !r.ok) return null;
        const d = await r.json();
        return { rev: Number.isSafeInteger(d && d.rev) ? d.rev : 0, offices: officesOk(d && d.offices) };
      } catch { return null; }
    },
    /**
     * Replace the host's list (an admin session; `rev`: the one read — required: the host refuses a save without it,
     * so two editors never overwrite each other unseen). { ok, rev, offices } or { ok: false, status, error }.
     */
    async saveOffices(list, rev) {
      if (!Number.isSafeInteger(rev)) return { ok: false, status: 0, error: "offices_rev_required" };
      try {
        const r = await get("/ui/offices", { method: "PUT", headers, body: JSON.stringify({ offices: list, rev }) });
        const d = await r.json().catch(() => ({}));
        return r.ok ? { ok: true, rev: d.rev, offices: officesOk(d.offices) } : { ok: false, status: r.status, error: d.error || "offices_failed" };
      } catch { return { ok: false, status: 0, error: "offices_failed" }; }
    },
    /** The skin packs the host keeps: { rev, packs: [{ id, name, sha }] }; null when they could not be read. */
    async skins() {
      try {
        const r = await get("/ui/office-skins", { method: "GET", headers });
        if (!r || !r.ok) return null;
        const d = await r.json();
        return { rev: typeof (d && d.rev) === "string" ? d.rev : "", packs: skinListOk(d) };
      } catch { return null; }
    },
    /** Upload a pack (an admin session): { manifest, files: { name: base64 }, name? } → { ok, pack } or { ok: false, status, error, detail }. */
    async uploadSkin(body) {
      try {
        const r = await get("/ui/office-skins", { method: "POST", headers, body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        return r.ok ? { ok: true, pack: d.pack, rev: d.rev } : { ok: false, status: r.status, error: d.error || "skin_failed", detail: d.detail || "" };
      } catch { return { ok: false, status: 0, error: "skin_failed", detail: "" }; }
    },
    /** Remove a pack (an admin session). */
    async deleteSkin(id) {
      try {
        const r = await get(`/ui/office-skins/${encodeURIComponent(id)}`, { method: "DELETE", headers });
        const d = await r.json().catch(() => ({}));
        return r.ok ? { ok: true } : { ok: false, status: r.status, error: d.error || "skin_failed" };
      } catch { return { ok: false, status: 0, error: "skin_failed" }; }
    },
    /** The office shown here: an id (one the host no longer has falls back to the auto office where it is used). */
    choice: () => { const v = read(CHOICE_KEY); return typeof v === "string" && v && v.length <= 40 ? v : AUTO_ID; },
    saveChoice: (id) => write(CHOICE_KEY, String(id)),
    filter: () => { const s = read(FILTER_KEY); try { return filterOk(s ? JSON.parse(s) : null); } catch { return filterOk(null); } },
    saveFilter: (f) => write(FILTER_KEY, JSON.stringify(filterOk(f))),
    /** The whole fleet's style here: a skin id ("pixel": desks, "studio": zones); an unknown one is the default where used. */
    skin: () => { const v = read(SKIN_KEY); return typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : "pixel"; },
    saveSkin: (id) => write(SKIN_KEY, String(id)),
    /** Whether paused and stopped people are left out of the Office here (default: shown). */
    hideAsleep: () => read(ASLEEP_KEY) === "1",
    saveHideAsleep: (v) => write(ASLEEP_KEY, v ? "1" : "0"),
  };
}
