/**
 * #2072: the published backend availability snapshot and the `/backend` steps that read it. No CLI, no account and no
 * network: the probes are fakes, and the offline sign-in check reads a scratch home.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  availabilityState, BackendAvailabilityStore, parseVersion, probeOfflineAuth, versionBelow, AVAILABILITY_STALE_MS,
  type AvailabilityProbes, type AuthState,
} from "../src/backend-availability.js";
import { backendStep, backendUnusable, type BackendCommandDeps } from "../src/backend-command.js";
import { noteResolvedBinary, resolveBinary } from "../src/backend/types.js";

describe("the state of one backend", () => {
  it("only a definite answer makes a backend unusable; unknown stays selectable", () => {
    const s = (installed: boolean | null, version: string | null, auth: AuthState, minVersion: string | null = null) => availabilityState({ installed, version, auth, minVersion });
    expect(s(false, null, "unknown")).toBe("not_installed");
    expect(s(null, null, "unknown")).toBe("unknown");
    expect(s(true, "2.20.9", "valid", "2.21.0")).toBe("too_old");
    expect(s(true, "2.21.0", "valid", "2.21.0")).toBe("usable");
    expect(s(true, null, "valid", "2.21.0")).toBe("usable");          // no version: no too-old claim
    expect(s(true, "1.0.0", "invalid")).toBe("not_signed_in");
    expect(s(true, "1.0.0", "not_required")).toBe("usable");
    expect(s(true, null, "unknown")).toBe("unknown");
    expect(s(true, "1.0.0", "unknown")).toBe("usable");
  });
  it("reads versions out of CLI output and compares them numerically", () => {
    expect(parseVersion("kiro-cli 2.30.1 (abc)")).toBe("2.30.1");
    expect(parseVersion("codex-cli 0.157")).toBe("0.157.0");
    expect(parseVersion("no version here")).toBeNull();
    expect(versionBelow("2.9.0", "2.21.0")).toBe(true);
    expect(versionBelow("2.21.0", "2.21.0")).toBe(false);
  });
});

function fakes(over: Partial<AvailabilityProbes> = {}): { probes: any; max: () => number } {
  let inFlight = 0, maxInFlight = 0;
  const track = <T>(fn: () => Promise<T>) => async () => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); try { await new Promise(r => setTimeout(r, 2)); return await fn(); } finally { inFlight--; } };
  const probes = {
    resolve: vi.fn((b: string) => track(async () => (b === "grok" ? null : `/bin/${b}`))()),
    version: vi.fn((_b: string, _p: string) => track(async () => "2.30.0")()),
    auth: vi.fn(async (_b: string): Promise<AuthState> => "valid"),
    signature: vi.fn(async (b: string) => `sig-${b}`),
    ...over,
  };
  return { probes, max: () => maxInFlight };
}

describe("the store", () => {
  it("probes one backend at a time, and publishes what each answered", async () => {
    const { probes, max } = fakes();
    const store = new BackendAvailabilityStore(["claude-code", "codex", "grok", "kiro-cli"], probes);
    await Promise.all([store.refresh(), store.refresh(["codex"], { force: true })]);
    expect(max()).toBe(1);
    expect(store.get("grok")!.state).toBe("not_installed");
    expect(store.get("codex")).toMatchObject({ state: "usable", path: "/bin/codex", version: "2.30.0", auth: "valid" });
  });
  it("a pass that finds nothing changed starts no CLI; a change or force does", async () => {
    const { probes } = fakes();
    const store = new BackendAvailabilityStore(["codex"], probes);
    await store.refresh();
    expect(probes.version).toHaveBeenCalledTimes(1);
    await store.refresh();
    expect(probes.version).toHaveBeenCalledTimes(1);            // same binary, same login files: no `--version`
    probes.signature.mockResolvedValue("sig-changed");
    await store.refresh();
    expect(probes.version).toHaveBeenCalledTimes(2);
    await store.refresh(["codex"], { force: true });
    expect(probes.version).toHaveBeenCalledTimes(3);
  });
  it("fails open: a probe that times out or throws keeps the last definite answer", async () => {
    const { probes } = fakes();
    const store = new BackendAvailabilityStore(["codex"], probes);
    await store.refresh();
    expect(store.get("codex")!.state).toBe("usable");
    probes.resolve.mockResolvedValue(undefined);                 // no answer in time
    await store.refresh(["codex"], { force: true });
    expect(store.get("codex")!.state).toBe("usable");
    probes.resolve.mockRejectedValue(new Error("crash"));
    await store.refresh(["codex"], { force: true });
    expect(store.get("codex")!.state).toBe("usable");
    probes.resolve.mockResolvedValue("/bin/codex"); probes.version.mockResolvedValue(null as any);
    await store.refresh(["codex"], { force: true });
    expect(store.get("codex")!.version).toBe("2.30.0");          // the same binary's version is kept
  });
  it("kiro-cli older than the supported minimum is too old, with the minimum named", async () => {
    const { probes } = fakes({ version: vi.fn(async () => "2.9.0") });
    const store = new BackendAvailabilityStore(["kiro-cli"], probes);
    await store.refresh();
    expect(store.get("kiro-cli")).toMatchObject({ state: "too_old", minVersion: "2.21.0" });
  });
  it("a read never probes, not even in the background (a handler must not fork); staleness is the owner's to act on", async () => {
    let now = 0;
    const { probes } = fakes();
    const store = new BackendAvailabilityStore(["codex"], probes, { now: () => now });
    expect(store.snapshot()[0]!.state).toBe("unknown");
    expect(store.get("codex")!.state).toBe("unknown");
    await new Promise(r => setTimeout(r, 20));
    expect(probes.resolve).not.toHaveBeenCalled();
    expect(store.stale()).toBe(true);
    await store.refresh();
    expect(store.stale()).toBe(false);
    now += AVAILABILITY_STALE_MS + 1;
    store.snapshot(); await new Promise(r => setTimeout(r, 20));
    expect(probes.resolve).toHaveBeenCalledTimes(1);
    expect(store.stale()).toBe(true);
  });
});

describe("sign-in, read offline", () => {
  const home = () => mkdtempSync(join(tmpdir(), "avail-home-"));
  const put = (dir: string, rel: string, body = "{\"x\":1}") => { mkdirSync(join(dir, rel, ".."), { recursive: true }); writeFileSync(join(dir, rel), body); };
  it("a stored login or an API key is signed in; none is not, where that is proof", async () => {
    const h = home();
    expect(await probeOfflineAuth("codex", {}, h)).toBe("invalid");
    put(h, ".codex/auth.json");
    expect(await probeOfflineAuth("codex", {}, h)).toBe("valid");
    expect(await probeOfflineAuth("grok", {}, h)).toBe("invalid");
    expect(await probeOfflineAuth("grok", { XAI_API_KEY: "k" }, h)).toBe("valid");
    expect(await probeOfflineAuth("antigravity", {}, h)).toBe("invalid");
    put(h, ".gemini/antigravity-cli/antigravity-oauth-token");
    expect(await probeOfflineAuth("antigravity", {}, h)).toBe("valid");
  });
  it("codex on its own provider needs no login of ours", async () => {
    const h = home();
    put(h, ".codex/config.toml", 'model_provider = "glm"\n[model_providers.glm]\nname = "GLM"\n');
    expect(await probeOfflineAuth("codex", { CODEX_HOME: join(h, ".codex") }, h)).toBe("not_required");
    put(h, ".codex/config.toml", '[profiles.x]\nmodel_provider = "glm"\n');   // only a profile's, not the default
    expect(await probeOfflineAuth("codex", { CODEX_HOME: join(h, ".codex") }, h)).toBe("invalid");
  });
  it("where the CLI has ways we cannot see offline, no file is unknown, never 'signed in'", async () => {
    const h = home();
    expect(await probeOfflineAuth("opencode", {}, h)).toBe("unknown");
    expect(await probeOfflineAuth("muse", {}, h)).toBe("unknown");
    const claude = await probeOfflineAuth("claude-code", {}, h);
    expect(claude).toBe(process.platform === "darwin" ? "unknown" : "invalid");   // macOS keeps it in the Keychain
    put(h, ".claude/.credentials.json");
    expect(await probeOfflineAuth("claude-code", {}, h)).toBe("valid");
  });
});

describe("the /backend steps read the snapshot", () => {
  const tk = (key: string, ...args: string[]) => [key, ...args].join("|");
  const deps = (rows: Array<{ backend: string; state: any; minVersion?: string }>, current = "claude-code"): BackendCommandDeps => ({
    currentBackend: () => current, currentDisplay: () => current, availability: () => rows, models: async () => [], modelKnown: () => false,
    effortLevels: () => [], inherited: () => undefined, modelCompatible: () => true, state: () => ({ running: true, busy: false, status: "running" }), t: tk,
  });
  const rows = [{ backend: "claude-code", state: "usable" }, { backend: "codex", state: "not_signed_in" }, { backend: "kiro-cli", state: "too_old", minVersion: "2.21.0" },
    { backend: "grok", state: "not_installed" }, { backend: "opencode", state: "unknown" }];
  it("every backend is listed; an unusable one says why and is disabled; not checked yet stays selectable", async () => {
    const step = await backendStep(deps(rows), "w", []);
    expect(step.kind === "choose" && step.choices).toEqual([
      { token: "claude-code", label: "✓ claude-code" },
      { token: "codex", label: "codex — backend.reason_not_signed_in", disabled: "backend.reason_not_signed_in" },
      { token: "kiro-cli", label: "kiro-cli — backend.reason_too_old|2.21.0", disabled: "backend.reason_too_old|2.21.0" },
      { token: "grok", label: "grok — backend.reason_not_installed", disabled: "backend.reason_not_installed" },
      { token: "opencode", label: "opencode — backend.reason_unchecked" },
    ]);
  });
  it("choosing an unusable one is refused with its reason (a surface that cannot disable an option)", async () => {
    expect(await backendStep(deps(rows), "w", ["codex"])).toEqual({ kind: "refuse", text: "backend.unusable|codex|backend.reason_not_signed_in" });
    expect(await backendStep(deps(rows), "w", ["kiro-cli"])).toEqual({ kind: "refuse", text: "backend.unusable|kiro-cli|backend.reason_too_old|2.21.0" });
    expect((await backendStep(deps(rows), "w", ["opencode"])).kind).toBe("choose");
  });
  it("fails open: the instance's own backend is never disabled, whatever a probe said", async () => {
    const step = await backendStep(deps(rows, "grok"), "w", []);
    expect(step.kind === "choose" && step.choices.find(c => c.token === "grok")).toEqual({ token: "grok", label: "✓ grok" });
    expect(backendUnusable(tk, { backend: "grok", state: "not_installed" })).toBe("backend.reason_not_installed");
  });
});

describe("a launch on the loop uses the snapshot's path", () => {
  it("resolveBinary answers from a resolved path without looking it up; null forgets it", () => {
    noteResolvedBinary("agend-test-cli-2072", "/opt/x/agend-test-cli-2072");
    expect(resolveBinary("agend-test-cli-2072")).toBe("/opt/x/agend-test-cli-2072");
    expect(resolveBinary("agend-test-cli-2072", ["/nowhere"])).toBe("agend-test-cli-2072");   // explicit dirs: no hint
    noteResolvedBinary("agend-test-cli-2072", null);
    expect(resolveBinary("agend-test-cli-2072", ["/nowhere"])).toBe("agend-test-cli-2072");
  });
});
