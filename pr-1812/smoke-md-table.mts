// Markdown table smoke (web .md preview + chat bubble). NOT part of the test suite.
//   cd ~/.cache/agend-smoke/pw && PW_DIR=$PWD REPO=<checkout> OUT=<dir> TAG=before|after FONTCONFIG_FILE=/etc/fonts/fonts.conf \
//     [SCROLLBARS=classic|overlay] npx --prefix <checkout> tsx smoke-md-table.mts
// Runs the real /ui from an in-process FleetManager in a scratch AGEND_HOME (no fleet, no CLI, no tmux; delivery stubbed),
// uploads a .md with a wide CJK + code-chip table through the real composer, opens its preview, sends the same table as
// a chat message, and measures + screenshots both at desktop and phone width.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_DIR + "/");
const { chromium } = require("playwright-core");
const OUT = process.env.OUT!, TAG = process.env.TAG ?? "run", BARS = process.env.SCROLLBARS === "overlay" ? "overlay" : "classic";
mkdirSync(OUT, { recursive: true });
const HP = 47420 + (BARS === "overlay" ? 2 : 0);
const dir = mkdtempSync(join(tmpdir(), "smd-"));
process.env.AGEND_HOME = dir;
writeFileSync(join(dir, "fleet.yaml"), `health_port: ${HP}\ninstances:\n  w:\n    working_directory: ${dir}\n    backend: claude-code\nweb:\n  preview_port: ${HP + 1}\n`);
const { FleetManager } = await import(process.env.REPO + "/src/fleet-manager.ts");
const fm: any = new FleetManager(dir);
const q = () => {}; fm.logger = { info: q, warn: q, error: q, debug: q, trace: q, fatal: q, child: () => fm.logger };
fm.notifyFleetError = () => true;
fm.loadConfig(join(dir, "fleet.yaml"));
fm.lifecycle = { isPaused: () => false, hasWorkLease: () => false, daemons: new Map() };
fm.deliverToInstance = async () => true;
fm.initializeWebAuthTokens(); fm.startHealthServer(HP);
await new Promise(r => setTimeout(r, 500));

const TABLE = [
  "| 項目 | 位置 | 處理 |",
  "|---|---|---|",
  "| 第三方 analytics | 讀 `inventory-2026-10-07.md`（見盤點） | `codeName:\"Analytics\"`，沒設時預設 `SR4` |",
  "| 灌設定工具 | `app/sr4_go_server/configDBSetting/update.go:22` | 同上 |",
  "| 新玩家預設暱稱 | `game/player/model/model.go:154,484` 寫死 `\"SR4\"` | 改用機種代號 |",
  "| director 不要動 | `match_director/.../director.go:96` 讀 `SR4Config` | director 是共用的，繼續讀 SR4 的設定 DB |",
].join("\n");
const MD = ["# sr4u plan A deploy", "", "## 二、要改的地方", "", TABLE, "", ...Array.from({ length: 30 }, (_, i) => `- 後續步驟 ${i + 1}：確認設定與部署順序。`)].join("\n");
const mdPath = join(mkdtempSync(join(tmpdir(), "smd-files-")), "sr4u-plan-a-deploy-2026-10-14.md");   // outside AGEND_HOME (state files are refused)
writeFileSync(mdPath, MD);

const EXE = process.env.CHROME ?? process.env.HOME + "/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
// Headless hides scrollbars by default (--hide-scrollbars): drop it, so a classic scrollbar takes its real width.
const browser = await chromium.launch({ executablePath: EXE, ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--no-sandbox", ...(BARS === "overlay" ? ["--enable-features=OverlayScrollbar"] : [])] });
const results: Record<string, unknown> = { tag: TAG, scrollbars: BARS, browser: browser.version() };
const base = `http://127.0.0.1:${HP}`;

/** Lines a word is laid out on: >1 means it was broken. Runs in the page. */
const MEASURE = `(() => {
  const r = (e) => e.getBoundingClientRect();
  const lineBreaks = (node) => {
    // Per character tops inside one text node; a change of top between two characters is a break there.
    const out = [];
    const t = node.textContent; const range = document.createRange();
    let prevTop = null;
    for (let i = 0; i < t.length; i++) {
      range.setStart(node, i); range.setEnd(node, i + 1);
      const rects = range.getClientRects(); if (!rects.length) continue;
      const top = Math.round(rects[0].top);
      if (prevTop !== null && top > prevTop + 2) out.push(i);
      prevTop = top;
    }
    return out;
  };
  const midWord = (root) => {
    const bad = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent; const inCode = !!n.parentElement.closest("code");
      for (const i of lineBreaks(n)) {
        const a = t[i - 1] || "", b = t[i] || "";
        const latin = /[A-Za-z0-9_]/;
        // A break between two word characters is mid-word; in code, a break not right after / . : , is mid-token.
        if (latin.test(a) && latin.test(b)) bad.push((inCode ? "code " : "text ") + JSON.stringify(t.slice(Math.max(0, i - 8), i) + "|" + t.slice(i, i + 8)));
      }
    }
    return bad;
  };
  const one = (root) => {
    if (!root) return null;
    const tbl = root.querySelector(".tbl"), table = root.querySelector("table");
    return { tbl: tbl && r(tbl), table: table && r(table), tblScrolls: tbl ? tbl.scrollWidth > tbl.clientWidth : null,
      tblScrollbarH: tbl ? tbl.offsetHeight - tbl.clientHeight : null, midWord: table ? midWord(table) : [],
      colWidths: table ? [...table.rows[0].cells].map(c => Math.round(r(c).width)) : [] };
  };
  const card = document.querySelector(".text-card");
  const body = card && card.querySelector(".tc-body");
  const cb = card && r(card), bb = body && r(body);
  const cs = card && getComputedStyle(card);
  const t = body && body.querySelector(".tbl");
  const tr = t && r(t);
  const preview = card && {
    card: cb, body: bb, scrollbarW: body.offsetWidth - body.clientWidth,
    // Content box of the scroller: its left edge, and the right edge where the scrollbar (or the edge) begins.
    leftInsetFromCardBorder: tr && Math.round(tr.left - cb.left - parseFloat(cs.borderLeftWidth)),
    rightInsetToScrollbarOrEdge: tr && Math.round((bb.left + body.clientLeft + body.clientWidth) - tr.right),
    rightInsetFromCardBorder: tr && Math.round(cb.right - parseFloat(cs.borderRightWidth) - tr.right),
    ...one(body),
  };
  const bubbles = [...document.querySelectorAll(".msg .body > .md")].filter(m => m.querySelector("table"));
  const bubble = bubbles.length ? one(bubbles.at(-1)) : null;
  const bm = bubbles.length ? r(bubbles.at(-1)) : null;
  return { preview, bubble, bubbleMd: bm };
})()`;

for (const [label, viewport] of [["desktop", { width: 1366, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const violations: string[] = [];
  page.on("console", (m: any) => { if (/Content Security Policy|CSP/.test(m.text())) violations.push(m.text().slice(0, 160)); });
  await page.goto(`${base}/signin`); await page.waitForSelector("#code");
  await page.fill("#code", fm.issueDashboardLogin().display); await page.click("#go"); await page.waitForURL(`${base}/ui`);
  await page.waitForTimeout(600);
  await page.goto(`${base}/ui/chat/w`);
  await page.waitForSelector("#msgIn");
  // The first-run tour covers part of the thread: skip it (its own button) so the screenshots show the table only.
  await page.waitForTimeout(500);
  await page.evaluate(`(() => { const b = [...document.querySelectorAll("button")].find(x => /^(Skip|略過|跳過)$/.test(x.textContent.trim())); if (b) b.click(); })()`);
  // The .md as an agent's reply file, through the fleet's own reply-file path (#1770 snapshot + ledger).
  const atts = await fm.webReplyAttachments("w", [mdPath]);
  if (!atts.length) throw new Error("the reply file was not registered");
  fm.emitSseEvent("message", { instance: "w", sender: "w", role: "agent", text: "plan", attachments: atts, ts: new Date().toISOString() });
  try { await page.waitForSelector(".text-card .tc-show", { timeout: 10000 }); }
  catch (e) {
    await page.screenshot({ path: join(OUT, `debug-${label}.png`) });
    console.log("DEBUG msgs:", await page.evaluate(`[...document.querySelectorAll(".msg")].slice(-3).map(m => m.outerHTML.slice(0, 600)).join("\\n---\\n")`));
    console.log("DEBUG send:", await page.evaluate(`JSON.stringify({ disabled: document.querySelector("#sendBtn")?.disabled, composer: document.querySelector(".composer")?.innerText.slice(0, 300), main: document.querySelector("main, .main")?.innerText.slice(0, 600), value: document.querySelector("#msgIn")?.value })`));
    throw e;
  }
  await page.click(".text-card .tc-show");
  await page.waitForSelector(".text-card .tc-body .md table", { timeout: 10000 });
  // The same table as a chat bubble (an agent message).
  fm.emitSseEvent("message", { instance: "w", sender: "w", role: "agent", text: "## 二、要改的地方\n\n" + TABLE, ts: new Date().toISOString() });
  for (let i = 0; i < 50 && !(await page.evaluate(`[...document.querySelectorAll(".msg .body > .md")].some(m => m.querySelector("table"))`)); i++) await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  // Scroll the preview so the table sits mid-body (as in the report), then measure and shoot.
  await page.evaluate(`(() => { const b = document.querySelector(".text-card .tc-body"); const t = b.querySelector("table"); b.scrollTop = Math.max(0, t.offsetTop - 40); })()`);
  await page.evaluate(`document.querySelector(".text-card").scrollIntoView({ block: "start" })`);
  await page.waitForTimeout(200);
  results[label] = { ...(await page.evaluate(MEASURE)), cspViolations: violations };
  await (await page.$(".text-card"))!.screenshot({ path: join(OUT, `${TAG}-${BARS}-${label}-preview.png`) });
  // The bubble is the newest message: scroll the thread to its end, so the "Latest" pill is gone.
  await page.evaluate(`(() => { const s = document.querySelector(".p-chat .scroller") || document.querySelector(".scroller"); if (s) s.scrollTop = s.scrollHeight; })()`);
  await page.waitForTimeout(300);
  const bubble = await page.evaluateHandle(`[...document.querySelectorAll(".msg .body > .md")].filter(m => m.querySelector("table")).at(-1)`);
  await (bubble as any).screenshot({ path: join(OUT, `${TAG}-${BARS}-${label}-bubble.png`) });
  await ctx.close();
}
writeFileSync(join(OUT, `${TAG}-${BARS}.json`), JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
await browser.close();
fm.healthServer?.close?.();
process.exit(0);
