// Fleet → Org chart → Office: the fleet as a small pixel office, the third view beside Canvas and List
// (fleet-canvas.js). The same data as theirs: the structure from /ui/org (buildOrgView), the live state from the app
// store, the traffic from fleet-traffic.js's store — nothing new is read but the offices people made (/ui/offices).
//
// - Each team is a room, each member a desk with a name tag; General and the instances in no team share the lobby. The
//   layout (fleet-office-model.js autoLayout) is a grid that wraps at the stage's width.
// - Each occupant is a little pixel person in a pose that loops a few frames: working (typing, the lamp on), idle (tea),
//   paused or stopped (asleep, a closed sign), needs you / crashed / looks stuck (a hand up, a blinking light).
// - Traffic: each new message, delegation or report is an item carried from the sender's desk to the receiver's along
//   the corridors (the layout's waypoint graph), in its kind's colour and shape; a delegation in progress is a folder on
//   the worker's desk.
// - Hover (or a first tap) shows what the canvas's card says; a click (or a second tap) opens the chat, as a card does.
//   The desks are a list for a screen reader and the keyboard too (shown while it has focus).
// - Who is shown: an office switcher (the whole fleet, or an office from the host), and for the whole fleet a team (or
//   the lobby) and pinned people — kept per browser (fleet-office-store.js).
// - One requestAnimationFrame loop, drawing only when a frame changes; it stops while the tab is hidden and when the view
//   goes. Reduced motion: still poses, nothing in the air. Colours are the dashboard's tokens (dark and light).
// - Drawing is the skin's (fleet-office-skin.js): the built-in pixel one now; a skin pack can replace any part later.
import { html, useEffect, useLayoutEffect, useMemo, useRef, useState } from "/assets/app-html.js";
import { appStore } from "/assets/app-store.js";
import { t, register } from "/assets/app-i18n.js";
import { identityOf } from "/assets/identity-color.js";
import { nodeText } from "./fleet-org.js";
import { hits, needle } from "./fleet-canvas-layout.js";
import { AUTO_ID, LOBBY, autoLayout, coatOf, createFlights, customLayout, deskAt, desksOf, filterOk, lampOf, layoutOk, lightOf, membersOf,
  officePose, officeRooms, signOf, workOn } from "./fleet-office-model.js";
import { DEFAULT_PAL, modeOf, skinFor } from "./fleet-office-skin.js";
import { createOfficeStore } from "./fleet-office-store.js";

register("orgo", {
  en: {
    label: "Office: each team is a room and each instance a desk; General and the instances in no team are in the lobby.",
    office: "Office", allOffice: "Whole fleet", show: "Show", allTeams: "All teams", lobby: "Lobby (General, no team)", lobbyRoom: "Lobby",
    people: "People", peopleN: "People ({0})", findPerson: "Find a person", everyone: "Show everyone", nobody: "No one here matches this filter.",
    unseated: "{0} without a seat", closed: "Closed", desks: "Desks", tapAgain: "Tap again to open the chat",
    capWorking: "Typing away", capIdle: "Tea break", capPaused: "Asleep", capNeeds: "Calling for you", capAway: "Desk empty",
  },
  "zh-TW": {
    label: "辦公室：每個 team 是一間房間，每個 instance 一張桌子；General 和未加入 team 的 instance 在大廳。",
    office: "辦公室", allOffice: "整個 fleet", show: "顯示", allTeams: "所有 team", lobby: "大廳（General、未加入 team）", lobbyRoom: "大廳",
    people: "成員", peopleN: "成員（{0}）", findPerson: "尋找成員", everyone: "顯示全部", nobody: "沒有符合這個篩選的成員。",
    unseated: "{0} 位沒有座位", closed: "休息中", desks: "桌子", tapAgain: "再點一下開啟聊天",
    capWorking: "埋頭打字中", capIdle: "喝茶休息", capPaused: "睡著了", capNeeds: "在呼叫你", capAway: "空位",
  },
});
const to = (k, ...v) => t(`orgo.${k}`, ...v);
const CAPTION = { working: "capWorking", idle: "capIdle", paused: "capPaused", needs: "capNeeds", walk: "capIdle", away: "capAway" };
/** What a pose says in words (the tooltip, the desk list). */
export const caption = (pose) => to(CAPTION[pose] || "capIdle");

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const now = () => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now());
const FPS = 4;

/** The dashboard's tokens on `el`, for the canvas (the defaults are the dark theme's). */
function readPal(el) {
  let cs = null;
  try { cs = el && typeof getComputedStyle === "function" ? getComputedStyle(el) : null; } catch { cs = null; }
  const v = (k, d) => { const s = cs && typeof cs.getPropertyValue === "function" ? cs.getPropertyValue(k).trim() : ""; return s || d; };
  const D = DEFAULT_PAL;
  return {
    bg: v("--bg", D.bg), surface: v("--surface", D.surface), surface2: v("--surface-2", D.surface2), border: v("--border", D.border),
    text: v("--text", D.text), text2: v("--text-2", D.text2), text3: v("--text-3", D.text3), ok: v("--ok", D.ok), warn: v("--warn", D.warn),
    danger: v("--danger", D.danger), focus: v("--focus", D.focus),
    fx: { task: v("--fx-task", D.fx.task), send: v("--fx-send", D.fx.send), report: v("--fx-report", D.fx.report), broadcast: v("--fx-broadcast", D.fx.broadcast) },
  };
}

/** The team picker's choices: option values are indexes (a team's name can be anything). */
function teamOptions(view) {
  return [{ value: "all", team: "", label: to("allTeams") }, { value: "lobby", team: LOBBY, label: to("lobby") },
    ...view.teams.map((tm, i) => ({ value: `t${i}`, team: tm.name, label: tm.name }))];
}

function People({ nodes, pinned, onChange }) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const q = needle(find), shown = q ? nodes.filter((n) => hits(n, q)) : nodes;
  const toggle = (name) => onChange(pinned.includes(name) ? pinned.filter((x) => x !== name) : [...pinned, name]);
  return html`<div class="oo-people" ref=${box}>
    <button type="button" class=${`btn btn-sm${pinned.length ? " on" : ""}`} aria-expanded=${open ? "true" : "false"} onClick=${() => setOpen((v) => !v)}>
      ${pinned.length ? to("peopleN", pinned.length) : to("people")}</button>
    ${open ? html`<div class="oo-people-pop" role="group" aria-label=${to("people")}>
      <label class="s-search"><span class="sr-only">${to("findPerson")}</span>
        <input type="search" value=${find} placeholder=${to("findPerson")} autocomplete="off" onInput=${(e) => setFind(e.target.value)} /></label>
      <ul class="oo-people-list">${shown.map((n) => html`<li key=${n.name}><label>
        <input type="checkbox" checked=${pinned.includes(n.name)} onChange=${() => toggle(n.name)} /><span>${nodeText(n).primary}</span></label></li>`)}</ul>
      ${pinned.length ? html`<button type="button" class="btn btn-sm" onClick=${() => onChange([])}>${to("everyone")}</button>` : null}
    </div>` : null}
  </div>`;
}

/**
 * The view: `view` buildOrgView's answer; `traffic` the live items (null: Live is off); `q` the Find box's needle;
 * `lease` the tab's (its reads); `onOpen(name)` what a desk opens (the canvas's: the chat).
 */
export function Office({ view, traffic, q = "", lease, onOpen }) {
  const store = useMemo(() => createOfficeStore(lease ? { fetch: (path, o) => lease.fetch(path, o) } : {}), [lease]);
  const [stored, setStored] = useState([]);
  const [choice, setChoice] = useState(() => store.choice());
  const [filter, setFilter] = useState(() => store.filter());
  const [width, setWidth] = useState(960);
  const [themeRev, setThemeRev] = useState(0);
  const [pal, setPal] = useState(DEFAULT_PAL);                      // the tokens in force (read once the stage is there)
  const [tip, setTip] = useState(null);                               // the desk key the tooltip is for
  const stageRef = useRef(null), canvasRef = useRef(null), tipRef = useRef(null), lastType = useRef("mouse");
  const flights = useMemo(() => createFlights(), []);
  const still = useMemo(reducedMotion, []);

  // The host's offices: on opening, and again whenever the stream says they changed.
  useEffect(() => {
    if (!lease) return undefined;
    const read = async () => { const d = await store.offices(); if (lease.current() && d) setStored(d.offices); };
    void read();
    const sub = appStore.get().streamOn;
    const off = sub ? lease.hold(sub("offices", () => { void read(); })) : null;
    return () => { if (off) off(); };
  }, [lease, store]);
  // The stage's width (the grid wraps at it), and the theme (the tokens the canvas reads).
  useEffect(() => {
    const el = stageRef.current;
    const measure = () => { const w = el && el.clientWidth; if (w > 0) setWidth((cur) => (Math.abs(cur - w) >= 1 ? Math.floor(w) : cur)); };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (ro && el) ro.observe(el); else globalThis.addEventListener?.("resize", measure);
    const bump = () => setThemeRev((n) => n + 1);
    let mq = null;
    try { mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null; } catch { mq = null; }
    mq?.addEventListener?.("change", bump);
    const mo = typeof MutationObserver === "function" ? new MutationObserver(bump) : null;
    if (mo && globalThis.document?.documentElement) mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => { if (ro) ro.disconnect(); else globalThis.removeEventListener?.("resize", measure); mq?.removeEventListener?.("change", bump); mo?.disconnect(); };
  }, []);

  useLayoutEffect(() => {
    const next = readPal(stageRef.current);
    setPal((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
  }, [themeRev]);
  const mode = modeOf(pal);

  const custom = choice !== AUTO_ID ? stored.find((o) => o.id === choice) || null : null;
  const skin = skinFor(custom ? custom.skin : "pixel");
  const L = useMemo(() => {
    if (!custom) return autoLayout(officeRooms(view, filter), { width });
    const nodes = membersOf(custom, view), lay = custom.layout || layoutOk(skin.layout);
    return lay ? customLayout({ ...custom, layout: lay }, nodes) : autoLayout([{ key: custom.id, name: custom.name, lobby: false, nodes }], { width });
  }, [view, filter, custom, width, skin]);
  const looks = useMemo(() => {
    const work = workOn(traffic);
    return new Map(L.rooms.flatMap((r) => r.desks).map((d) => {
      const n = d.node;
      if (!n) return [d.key, { name: "", label: "", pose: "away", light: null, lamp: false, sign: null, coat: "", work: 0, dim: !!q, match: false }];
      const match = !!q && hits(n, q);
      return [d.key, { name: n.name, label: nodeText(n).primary, pose: officePose(n.state), light: lightOf(n.state), lamp: lampOf(n.state), sign: signOf(n.state),
        coat: coatOf(n.i, n.i ? identityOf(n.i) : null, mode), work: work.get(n.name) || 0, dim: !!q && !match, match }];
    }));
  }, [L, traffic, q, mode, themeRev]);
  useEffect(() => { flights.sync(traffic || [], now(), still); }, [traffic]);

  // ── Drawing: the back and front layers are pictures, remade when the office changes; each frame draws the people
  // and the items in the air between them ──
  const scene = useRef(null);
  const loop = useRef(null);
  useLayoutEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv && typeof cv.getContext === "function" ? cv.getContext("2d") : null;
    if (!ctx) { scene.current = null; return; }
    const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
    const W = Math.ceil(L.width), H = Math.max(1, Math.ceil(L.height));
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    cv.style.setProperty("width", `${W}px`);
    cv.style.setProperty("height", `${H}px`);
    const env = { pal, mode, labels: { lobby: to("lobbyRoom"), closed: to("closed") } };
    const layer = (paint) => {
      const c = document.createElement("canvas");
      c.width = W * dpr; c.height = H * dpr;
      const g = c.getContext && c.getContext("2d");
      if (!g) return null;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.imageSmoothingEnabled = false;
      paint(g);
      return c;
    };
    const all = L.rooms.flatMap((r) => r.desks);
    const back = layer((g) => {
      g.fillStyle = env.pal.bg; g.fillRect(0, 0, W, H);
      skin.drawFloor(g, L, env);
      for (const r of L.rooms) skin.drawRoom(g, r, env);
      for (const d of all) skin.drawDeskBack(g, d, looks.get(d.key), env);
    });
    const front = layer((g) => { for (const d of all) skin.drawDeskFront(g, d, looks.get(d.key), env); });
    scene.current = { ctx, dpr, W, H, back, front, env, desks: all.filter((d) => d.node), looks, L, skin, dirty: true };
    if (still) draw(0); else loop.current?.wake();
  }, [L, looks, skin, pal]);

  /** One frame at `ms` (0: still); whether anything is in the air. */
  function draw(ms) {
    const s = scene.current;
    if (!s) return false;
    const { ctx, dpr, W, H, env } = s;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W * dpr, H * dpr);
    if (s.back) ctx.drawImage(s.back, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    for (const d of s.desks) s.skin.drawCharacter(ctx, d, s.looks.get(d.key), ms, env);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (s.front) ctx.drawImage(s.front, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const up = still ? [] : flights.frame(ms, s.L);
    for (const it of up) s.skin.drawProp(ctx, it, ms, env);
    return up.length > 0 || flights.size() > 0;
  }
  // The loop: one requestAnimationFrame at a time, drawing only when the frame (FPS) changed or something is in the air;
  // stopped while the tab is hidden, gone with the view.
  useEffect(() => {
    if (still || typeof requestAnimationFrame !== "function") return undefined;
    let raf = 0, last = -1, air = true, gone = false;
    const tick = () => {
      raf = 0;
      if (gone || globalThis.document?.hidden || !scene.current) return;
      const ms = now(), frame = Math.floor((ms / 1000) * FPS);         // the clock the trips started on
      if (scene.current.dirty || frame !== last || air) { scene.current.dirty = false; last = frame; air = draw(ms); }
      raf = requestAnimationFrame(tick);
    };
    const wake = () => { air = true; if (!raf && !gone && !globalThis.document?.hidden) raf = requestAnimationFrame(tick); };
    loop.current = { wake };
    const vis = () => { if (!globalThis.document?.hidden) wake(); };
    globalThis.document?.addEventListener?.("visibilitychange", vis);
    wake();
    return () => { gone = true; loop.current = null; if (raf) cancelAnimationFrame(raf); globalThis.document?.removeEventListener?.("visibilitychange", vis); };
  }, []);
  useEffect(() => { loop.current?.wake(); }, [traffic]);

  // ── The tooltip: what the canvas's card says, above the desk (below it at the top edge) ──
  const tipDesk = tip ? desksOf(L).find((d) => d.key === tip) || null : null;
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el || !tipDesk || !el.style) return;
    const x = Math.max(4, Math.min(tipDesk.x, L.width - 244)), above = tipDesk.y > 90;
    el.style.setProperty("transform", above ? `translate(${x}px, ${tipDesk.y + 6}px) translateY(-100%)` : `translate(${x}px, ${tipDesk.y + tipDesk.h}px)`);
  });
  const deskOf = (e) => {
    const r = canvasRef.current ? canvasRef.current.getBoundingClientRect() : null;
    return r ? deskAt(L, e.clientX - r.left, e.clientY - r.top) : null;
  };
  const onMove = (e) => { if (e.pointerType === "touch") return; const d = deskOf(e); const k = d ? d.key : null; if (k !== tip) setTip(k); };
  const onClick = (e) => {
    const d = deskOf(e);
    if (!d || !d.node.i) { setTip(null); return; }
    if (lastType.current === "touch" && tip !== d.key) { setTip(d.key); return; }   // a first tap shows; a second opens
    onOpen(d.node.name);
  };

  const auto = !custom;
  const f = filterOk(filter);
  const opts = teamOptions(view);
  const teamValue = (opts.find((o) => o.team === f.team) || opts[0]).value;
  const setF = (next) => { const v = filterOk(next); store.saveFilter(v); setFilter(v); };
  const pick = (id) => { store.saveChoice(id); setChoice(id); setTip(null); };
  const everyone = useMemo(() => { const m = new Map(); for (const n of [...view.top, ...view.teams.flatMap((tm) => tm.nodes), ...view.rest.nodes]) if (!m.has(n.name)) m.set(n.name, n); return [...m.values()]; }, [view]);
  const desks = desksOf(L);
  const tipText = tipDesk ? nodeText(tipDesk.node) : null;
  return html`<div class="oo">
    <div class="oo-bar">
      <label class="oo-pick"><span class="oo-pick-label">${to("office")}</span>
        <select class="tb-select" value=${custom ? custom.id : AUTO_ID} onChange=${(e) => pick(e.target.value)}>
          <option value=${AUTO_ID}>${to("allOffice")}</option>
          ${stored.map((o) => html`<option key=${o.id} value=${o.id}>${o.name}</option>`)}
        </select></label>
      ${auto ? html`<label class="oo-pick"><span class="oo-pick-label">${to("show")}</span>
        <select class="tb-select" value=${teamValue} onChange=${(e) => { const o = opts.find((x) => x.value === e.target.value); setF({ ...f, team: o ? o.team : "" }); }}>
          ${opts.map((o) => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
        </select></label>
        <${People} nodes=${everyone} pinned=${f.pinned} onChange=${(pinned) => setF({ ...f, pinned })} />` : null}
      ${L.unseated ? html`<span class="muted oo-note">${to("unseated", L.unseated)}</span>` : null}
    </div>
    ${desks.length || L.rooms.length ? null : html`<p class="note oo-empty">${to("nobody")} ${auto && (f.team || f.pinned.length) ? html`<button type="button" class="btn btn-sm" onClick=${() => setF({ team: "", pinned: [] })}>${to("everyone")}</button>` : null}</p>`}
    <div class="oo-stage" ref=${stageRef}>
      <canvas ref=${canvasRef} class=${`oo-canvas${tipDesk && tipDesk.node.i ? " hot" : ""}`} role="img" aria-label=${to("label")}
        onPointerMove=${onMove} onPointerLeave=${() => setTip(null)} onPointerDown=${(e) => { lastType.current = e.pointerType || "mouse"; }} onClick=${onClick}></canvas>
      ${tipText ? html`<div ref=${tipRef} class="oo-tip" role="tooltip">
        <strong>${tipText.primary}</strong>${tipText.secondary ? html` <span class="muted mono">${tipText.secondary}</span>` : null}
        <div>${tipText.sub}</div><div class="muted">${caption(officePose(tipDesk.node.state))}</div>
        ${tipDesk.node.i && lastType.current === "touch" ? html`<div class="muted">${to("tapAgain")}</div>` : null}
      </div>` : null}
      <ul class="oo-desks" aria-label=${to("desks")}>${desks.map((d) => {
        const nt = nodeText(d.node), cap = caption(officePose(d.node.state));
        return html`<li key=${d.key}>${d.node.i
          ? html`<button type="button" class="oo-desk" data-name=${d.node.name} aria-label=${`${nt.full} · ${cap}. ${t("orgc.openChat")}`}
              onFocus=${() => setTip(d.key)} onBlur=${() => setTip(null)} onClick=${() => onOpen(d.node.name)}>${nt.primary}</button>`
          : html`<span class="oo-desk" data-name=${d.node.name}>${nt.full}</span>`}</li>`;
      })}</ul>
    </div>
  </div>`;
}
