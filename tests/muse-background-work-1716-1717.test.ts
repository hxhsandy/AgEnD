/**
 * #1716 + #1717: muse background-task semantics — one decision: a running
 * background task does NOT count as busy; it counts as "local work still
 * active", with one semantic per consumer.
 *
 * Real live captures (tests/fixtures/muse-1.4.6/, 1.4.6 + 1.4.4 pairs);
 * stubbed backend/tmux for the daemon flows; no CLI, tmux or fleet.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MuseBackend, museBackgroundWorkActive, museLocalWorkQuitActive } from "../src/backend/muse.js";
import type { CliBackend } from "../src/backend/types.js";
import type { TmuxManager } from "../src/tmux-manager.js";
import type { Logger } from "../src/logger.js";
import { Daemon } from "../src/daemon.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const DIR = join(process.cwd(), "tests", "fixtures", "muse-1.4.6");
const pane = (name: string) => readFileSync(join(DIR, `${name}.pane.txt`), "utf8");
const b = new MuseBackend("/tmp/agend-muse-1716-1717");

describe("#1717: a terminals panel with an idle composer is idle", () => {
  it.each(["prod-background-work", "compare-background-work", "compare-1.4.4-background-work"])(
    "%s: idle proof passes, busy stays false, draft is empty", (name) => {
      const p = pane(name);
      expect(b.getBusyPattern().test(p)).toBe(false);
      expect(b.isPeriodicRedrawIdlePane(p)).toBe(true);
      expect(b.inputDraft(p)?.rows).toEqual([]);
      expect(museBackgroundWorkActive(p)).toBe(true);
    });
});

describe("#1717: a busy turn is still busy, panel or not", () => {
  it("a working pane without a panel still fails the idle proof", () => {
    expect(b.isPeriodicRedrawIdlePane(pane("echo-busy"))).toBe(false);
  });

  it("a busy line above the box vetoes even with a panel below it", () => {
    // The turn muse started while a task runs: interrupt hint above the box,
    // terminals panel still drawn under it. Spliced from the live captures.
    const p = pane("prod-background-work").replace(
      "  (↓ to view terminals)\n",
      "  (↓ to view terminals)\n\n◇ Thinking (2s · esc to interrupt)\n",
    );
    expect(b.getBusyPattern().test(p)).toBe(true);
    expect(b.isPeriodicRedrawIdlePane(p)).toBe(false);
  });

  it("a multi-task panel past the plain search depth still passes — but only panel-headed", () => {
    const task = "└ ◆ Wait in the background  running                                                                                  11s\n";
    const multi = pane("prod-background-work").replace(task, task + task + task);
    // Bottom separator is 6 rows deep now (header + 3 tasks + bar): past the
    // plain 4-row cap, accepted only because the row after it is the header.
    expect(b.isPeriodicRedrawIdlePane(multi)).toBe(true);
    expect(museBackgroundWorkActive(multi)).toBe(true);
    // Same depth without the header: still fails closed (the #958 5-row bar cap).
    const noHeader = multi.replace("main · ↓ to select\n", "  mock-model · high · ~/work · Launch overrides\n");
    expect(b.isPeriodicRedrawIdlePane(noHeader)).toBe(false);
  });

  it("ordinary idle panes have no panel and no quit menu", () => {
    for (const name of ["echo-idle", "echo-done", "meta-idle"]) {
      const p = pane(name);
      expect(b.isPeriodicRedrawIdlePane(p), name).toBe(true);
      expect(museBackgroundWorkActive(p), name).toBe(false);
      expect(museLocalWorkQuitActive(p), name).toBe(false);
    }
  });
});

describe("#1717: unknown panel shapes fail closed", () => {
  const bg = () => pane("prod-background-work");
  it("a header with no task row is not a panel", () => {
    const p = bg().replace(/└ ◆ Wait in the background.*\n/, "");
    expect(museBackgroundWorkActive(p)).toBe(false);
    expect(b.isPeriodicRedrawIdlePane(p)).toBe(false);
  });

  it("a task row that is not running is not a running panel", () => {
    const p = bg().replace("  running", "  done   ");
    expect(museBackgroundWorkActive(p)).toBe(false);
    expect(b.isPeriodicRedrawIdlePane(p)).toBe(false);
  });

  it("a quoted panel up in the transcript does not count", () => {
    // Panel text above a later separator with a plain idle screen at the
    // bottom: transcript echo, not the live panel.
    const p = `${bg()}\n${pane("echo-idle")}`;
    expect(p).toContain("↓ to select");
    expect(museBackgroundWorkActive(p)).toBe(false);
  });

  it("the dialog-chrome double arrow is not the panel header", () => {
    const p = bg().replace("main · ↓ to select", "main · ↓↑ to select");
    expect(museBackgroundWorkActive(p)).toBe(false);
    expect(b.isPeriodicRedrawIdlePane(p)).toBe(false);
  });
});

describe("#1716: the 'Local work is still active' quit menu", () => {
  const quit = () => pane("prod-quit-with-local-work");

  it("is recognised whole, on the live capture", () => {
    expect(museLocalWorkQuitActive(quit())).toBe(true);
    expect(b.quitBlockedByDialog(quit())).toBe(true);
  });

  it("is not recognised without its options or its hint", () => {
    expect(museLocalWorkQuitActive(quit().replace("    2. Stay\n", ""))).toBe(false);
    expect(museLocalWorkQuitActive(quit().replace("Exit anyway", "Exit"))).toBe(false);
    expect(museLocalWorkQuitActive(quit().replace("  Enter to confirm · Esc to cancel", ""))).toBe(false);
    expect(museLocalWorkQuitActive(quit().replace("  Local work is still active", "  Something else"))).toBe(false);
  });

  it("is not recognised on ordinary panes", () => {
    for (const name of ["echo-idle", "echo-busy", "prod-background-work", "meta-idle"]) {
      expect(museLocalWorkQuitActive(pane(name)), name).toBe(false);
    }
  });

  it("deliveries hold on it and never answer it: a passive dialog with no keys", () => {
    const dialog = b.getRuntimeDialogs().find(d => d.isActive === museLocalWorkQuitActive);
    expect(dialog).toMatchObject({ keys: [], holdOnly: true, blocksDelivery: true });
    expect(dialog!.pattern.test(quit())).toBe(true);
  });
});

// --- the report: the kill is never silent ---

describe("#1716: the background-work-ended marker is scoped to its own stop", () => {
  let mdir: string;
  beforeEach(() => { mdir = mkdtempSync(join(tmpdir(), "agend-1716-marker-")); });
  afterEach(() => { rmSync(mdir, { recursive: true, force: true }); });

  it("a fresh marker reports, a stale one never does", async () => {
    const { writeBackgroundWorkEndedMarker, readBackgroundWorkEndedMarker } =
      await import("../src/background-work-ended.js");
    expect(readBackgroundWorkEndedMarker(mdir, Date.now())).toBeNull();
    const beganAt = Date.now();
    writeBackgroundWorkEndedMarker(mdir, "stop");
    expect(readBackgroundWorkEndedMarker(mdir, beganAt)?.reason).toBe("stop");
    // An earlier stop's marker is not this stop's news.
    expect(readBackgroundWorkEndedMarker(mdir, beganAt + 10_000)).toBeNull();
  });

  it("an unreadable marker never reports", async () => {
    const { readBackgroundWorkEndedMarker } = await import("../src/background-work-ended.js");
    writeFileSync(join(mdir, "background-work-ended.json"), "not json");
    expect(readBackgroundWorkEndedMarker(mdir, 0)).toBeNull();
  });
});

// --- daemon flows: stubbed backend/tmux, fake timers, no CLI/tmux/fleet ---

const standingIn = <T,>(stub: object): T => stub as unknown as T;
const rootLogger = pino({ level: "silent" }) as Logger;
type AnyDaemon = Daemon & Record<string, any>;
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "agend-1716-")); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); });

function makeDaemon(): AnyDaemon {
  return new Daemon("bg-test", {
    working_directory: dir,
    backend: "muse",
    restart_policy: { max_retries: 0, backoff: "linear", reset_after: 0 },
    context_guardian: { grace_period_ms: 600_000, max_age_hours: 0 },
    log_level: "silent",
  } as any, dir, true, undefined, undefined, rootLogger) as AnyDaemon;
}

const QUIT = () => pane("prod-quit-with-local-work");
const BG = () => pane("prod-background-work");

describe("#1716: the stop flow cancels the menu with Escape — no option chosen, no blind key", () => {
  it("Escape, then SIGTERM, without waiting out the grace", async () => {
    vi.useFakeTimers();
    const d = makeDaemon();
    const keys: string[] = [];
    const killed: string[] = [];
    let alive = true;
    const getPaneStatus = vi.fn(async () => ({ alive }));
    d["backend"] = standingIn<CliBackend>({ binaryName: "muse", quitBlockedByDialog: (p: string) => museLocalWorkQuitActive(p), getQuitCommand: () => "/quit" });
    d["tmux"] = standingIn<TmuxManager>({
      getWindowId: () => "@1",
      capturePane: vi.fn(async () => QUIT()),
      getPaneStatus,
      sendSpecialKey: vi.fn(async (k: string) => { keys.push(k); return true; }),
      sendKeys: vi.fn(async () => true),
      killWindow: vi.fn(async () => {}),
    });
    d["checkpointSessionId"] = vi.fn(async () => {});
    d["sendQuitSequence"] = vi.fn(async () => true);
    d["killProcessTree"] = vi.fn(async (...args: unknown[]) => { killed.push(String(args[0])); alive = false; });
    const stopping = d.stop().catch(() => {});
    await vi.advanceTimersByTimeAsync(5_000);
    await stopping;
    expect(keys).toEqual(["Escape"]);
    expect(killed[0]).toBe("SIGTERM");
    expect(getPaneStatus.mock.calls.length).toBeLessThan(5);
    // #1716: the ended background work is recorded for the stop reply.
    const { readBackgroundWorkEndedMarker } = await import("../src/background-work-ended.js");
    expect(readBackgroundWorkEndedMarker(dir, 0)?.reason).toBe("stop");
  });

  it("no menu, no marker: a clean stop reports nothing", async () => {
    const d = makeDaemon();
    d["backend"] = standingIn<CliBackend>({ binaryName: "muse", quitBlockedByDialog: (p: string) => museLocalWorkQuitActive(p), getQuitCommand: () => "/quit" });
    d["tmux"] = standingIn<TmuxManager>({
      getWindowId: () => "@1",
      capturePane: vi.fn(async () => pane("echo-idle")),
      getPaneStatus: vi.fn(async () => ({ alive: false })),
      sendSpecialKey: vi.fn(async () => true),
      sendKeys: vi.fn(async () => true),
      killWindow: vi.fn(async () => {}),
    });
    d["checkpointSessionId"] = vi.fn(async () => {});
    d["sendQuitSequence"] = vi.fn(async () => true);
    d["killProcessTree"] = vi.fn(async () => {});
    await d.stop().catch(() => {});
    const { readBackgroundWorkEndedMarker } = await import("../src/background-work-ended.js");
    expect(readBackgroundWorkEndedMarker(dir, 0)).toBeNull();
  });
});

describe("#1717: an idle pause defers while background work runs", () => {
  function armPause(paneText: string) {
    const d = makeDaemon();
    const quitSent: boolean[] = [];
    d["backend"] = standingIn<CliBackend>({ binaryName: "muse", backgroundWorkRunning: (p: string) => museBackgroundWorkActive(p) });
    d["tmux"] = standingIn<TmuxManager>({
      getWindowId: () => "@1",
      capturePane: vi.fn(async () => paneText),
      getPaneStatus: vi.fn(async () => ({ alive: true })),
    });
    d["instanceState"] = "idle";
    d["freezeRuntimeMonitors"] = vi.fn();
    d["checkpointSessionId"] = vi.fn(async () => {});
    d["sendQuitSequence"] = vi.fn(async () => { quitSent.push(true); return true; });
    return { d, quitSent };
  }

  it("a running panel holds the pause: no /quit is sent", async () => {
    const { d, quitSent } = armPause(BG());
    await d.pause("idle" as never).catch(() => {});
    expect(quitSent).toEqual([]);
    expect(d["pauseWakeState"]).not.toBe("paused");
  });

  it("an ordinary idle pane pauses as before", async () => {
    vi.useFakeTimers();
    const { d, quitSent } = armPause(pane("echo-idle"));
    d["tmux"] = standingIn<TmuxManager>({
      getWindowId: () => "@1",
      capturePane: vi.fn(async () => pane("echo-idle")),
      getPaneStatus: vi.fn(async () => ({ alive: false })),
    });
    d["killProcessTree"] = vi.fn(async () => {});
    const pausing = d.pause("idle" as never).catch(() => {});
    await vi.advanceTimersByTimeAsync(5_000);
    await pausing;
    expect(quitSent).toEqual([true]);
  });

  it("a failed pane capture pauses as before — never wedged unpaused", async () => {
    vi.useFakeTimers();
    const { d, quitSent } = armPause(BG());
    d["tmux"] = standingIn<TmuxManager>({
      getWindowId: () => "@1",
      capturePane: vi.fn(async () => { throw new Error("tmux gone"); }),
      getPaneStatus: vi.fn(async () => ({ alive: false })),
    });
    d["killProcessTree"] = vi.fn(async () => {});
    const pausing = d.pause("idle" as never).catch(() => {});
    await vi.advanceTimersByTimeAsync(5_000);
    await pausing;
    expect(quitSent).toEqual([true]);
  });
});

describe("#1716: the stop reply and topic notice name the ended background work", () => {
  let fdir: string;
  beforeEach(() => { fdir = mkdtempSync(join(tmpdir(), "agend-1716-fleet-")); });
  afterEach(() => { rmSync(fdir, { recursive: true, force: true }); });

  async function fleetWithMarker(name: string, fresh: boolean) {
    const { FleetManager } = await import("../src/fleet-manager.js");
    const { writeBackgroundWorkEndedMarker } = await import("../src/background-work-ended.js");
    const fleet = new FleetManager(fdir) as any;
    const instDir = join(fdir, "instances", name);
    mkdirSync(instDir, { recursive: true });
    if (!fresh) writeBackgroundWorkEndedMarker(instDir, "stop", Date.now() - 600_000);
    // Like the daemon's stop flow, the marker lands mid-stop — after the
    // stop began, so the stop's own scope accepts it.
    fleet.lifecycle = { stop: vi.fn(async () => {
      if (fresh) writeBackgroundWorkEndedMarker(instDir, "stop");
    }) };
    fleet.notifyInstanceTopic = vi.fn(() => true);
    return fleet;
  }

  it("stopInstance posts the topic notice and reports the flag for a fresh marker", async () => {
    const fleet = await fleetWithMarker("muse-1", true);
    const outcome = await fleet.stopInstance("muse-1");
    expect(outcome).toEqual({ backgroundWorkEnded: true });
    expect(fleet.notifyInstanceTopic).toHaveBeenCalledOnce();
    const [target, text] = fleet.notifyInstanceTopic.mock.calls[0];
    expect(target).toBe("muse-1");
    expect(text).toContain("background work");
  });

  it("stopInstance stays silent on a stale marker or none at all", async () => {
    const stale = await fleetWithMarker("muse-1", false);
    expect(await stale.stopInstance("muse-1")).toEqual({ backgroundWorkEnded: false });
    expect(stale.notifyInstanceTopic).not.toHaveBeenCalled();
    const { FleetManager } = await import("../src/fleet-manager.js");
    const clean = new FleetManager(fdir) as any;
    const instDir = join(fdir, "instances", "muse-2");
    mkdirSync(instDir, { recursive: true });
    clean.lifecycle = { stop: vi.fn(async () => {}) };
    clean.notifyInstanceTopic = vi.fn(() => true);
    expect(await clean.stopInstance("muse-2")).toEqual({ backgroundWorkEnded: false });
    expect(clean.notifyInstanceTopic).not.toHaveBeenCalled();
  });

  it("the Classic /stop reply appends the sentence when work was ended", async () => {
    const fleet = await fleetWithMarker("muse-1", true);
    fleet.fleetConfig = { instances: { "muse-1": {} } };
    fleet.classicChannels = { unregister: () => ({ instanceName: "muse-1" }), getAll: () => [] };
    fleet.reregisterClassicChannels = vi.fn();
    const reply = await fleet.handleClassicStop("chan", "discord");
    expect(reply).toContain("Agent stopped");
    expect(reply).toContain("Background work was running and was ended with it");
  });

  it("the Classic /stop reply survives a stub that resolves nothing (web-favorites-1664 CI)", async () => {
    const fleet = await fleetWithMarker("muse-1", false);
    fleet.fleetConfig = { instances: { "muse-1": {} } };
    fleet.classicChannels = { unregister: () => ({ instanceName: "muse-1" }), getAll: () => [] };
    fleet.reregisterClassicChannels = vi.fn();
    fleet.stopInstance = vi.fn(async () => undefined);
    const reply = await fleet.handleClassicStop("chan", "discord");
    expect(reply).toContain("Agent stopped");
    expect(reply).not.toContain("Background work");
  });

  it("the Classic /stop reply is unchanged when nothing was ended", async () => {
    const fleet = await fleetWithMarker("muse-1", false);
    fleet.fleetConfig = { instances: { "muse-1": {} } };
    fleet.classicChannels = { unregister: () => ({ instanceName: "muse-1" }), getAll: () => [] };
    fleet.reregisterClassicChannels = vi.fn();
    const reply = await fleet.handleClassicStop("chan", "discord");
    expect(reply).not.toContain("Background work");
  });

  it("the fleet restart/update completion names the instances", async () => {
    const { formatRestartProgressCompletion } = await import("../src/restart-progress.js");
    const base = { running: 2, total: 2, version: "9.9", pausedNames: [] as string[] };
    const withNames = formatRestartProgressCompletion("restart",
      { ...base, backgroundWorkEndedNames: ["muse-1", "muse-2"] }, Date.now() - 1000);
    expect(withNames).toContain("Background work was running and was ended: muse-1, muse-2");
    const without = formatRestartProgressCompletion("update", { ...base }, Date.now() - 1000);
    expect(without).not.toContain("Background work");
  });
});
