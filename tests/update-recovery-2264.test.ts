import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { beginUpdateProgress, readUpdateProgress, reconcileUpdateProgress, setUpdateProgressStage, updateCanResumeAtStartup } from "../src/update-marker.js";
import { systemdUserEnvironment, systemdUserRecoveryHint } from "../src/systemd-user-environment.js";
import { acquireInstallLock, type InstallLockDeps } from "../src/install-lock.js";
import { targetInstallerCommand } from "../src/target-installer.js";

const require = createRequire(import.meta.url);
const recovery = require("../launcher/install-recovery.cjs") as { heal(prefix: string, options: { noNpmRunning: boolean; now?: number; uid?: number }): string[] };
const admission = require("../launcher/install-admission.cjs") as { admit(pkg: string, deps: Record<string, unknown>): { ok: boolean; warning?: string } };
const note = require("../launcher/old-updater-note.cjs") as { oldUpdaterNote(state: string, env: Record<string, string>): string };
const roots: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function world() {
  const prefix = mkdtempSync(join(tmpdir(), "agend-recovery2264-")); roots.push(prefix);
  const pkg = join(prefix, "lib", "node_modules", "@songsid", "agend");
  mkdirSync(pkg, { recursive: true }); mkdirSync(join(prefix, "bin"));
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@songsid/agend", version: "2.2.5" }));
  writeFileSync(join(pkg, "agend"), "#!/bin/sh\necho 2.2.5\n"); chmodSync(join(pkg, "agend"), 0o755);
  symlinkSync(join(pkg, "agend"), join(prefix, "bin", "agend"));
  return { prefix, pkg };
}
function leftover(prefix: string, name = ".agend-RmEK4vIL", age = 3600_000, manifest = "@songsid/agend") {
  const dir = join(prefix, "lib", "node_modules", "@songsid", name); mkdirSync(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: manifest, version: "2.2.5" }));
  const at = new Date(Date.now() - age); utimesSync(dir, at, at); return dir;
}

describe("#2264 known leftovers preserve the command chain", () => {
  it("hands off to exact target-owned npm code with separate argv, never a moving tag or curl", () => {
    expect(targetInstallerCommand("2.3.0-beta.17", "2.2.5")).toEqual({ command: "npm", args: ["exec", "--yes", "--package", "@songsid/agend@2.3.0-beta.17", "--", "agend-install", "--upgrade", "--version", "2.3.0-beta.17", "--from-version", "2.2.5", "--yes"] });
    expect(() => targetInstallerCommand("beta", "2.2.5")).toThrow();
    expect(() => targetInstallerCommand("2.3.0", "2.2.5; command")).toThrow();
  });
  it("the reported stale sibling plus corrupt lock self-heals without manual rm", () => {
    const w = world(), old = leftover(w.prefix);
    writeFileSync(join(w.prefix, ".agend-install.lock"), "{partial");
    const before = readlinkSync(join(w.prefix, "bin", "agend"));
    const moved = recovery.heal(w.prefix, { noNpmRunning: true });
    expect(moved).toHaveLength(2); expect(existsSync(old)).toBe(false);
    expect(readFileSync(join(moved.find(p => p.includes("RmEK4vIL"))!, "package.json"), "utf8")).toContain("2.2.5");
    expect(readlinkSync(join(w.prefix, "bin", "agend"))).toBe(before);
    expect(existsSync(before)).toBe(true);
    expect(admission.admit(w.pkg, { env: {} }).ok).toBe(true);
  });
  it.each(["npm active", "recent", "foreign owner", "different package", "symlink"])("does not quarantine unknown/live files: %s", kind => {
    const w = world(); let old = leftover(w.prefix, ".agend-foreign", kind === "recent" ? 0 : 3600_000, kind === "different package" ? "another-package" : "@songsid/agend");
    if (kind === "symlink") { rmSync(old, { recursive: true }); symlinkSync(w.pkg, old); }
    const uid = process.getuid?.() ?? 0;
    expect(recovery.heal(w.prefix, { noNpmRunning: kind !== "npm active", uid: kind === "foreign owner" ? uid + 1 : uid })).toEqual([]);
    expect(existsSync(old)).toBe(true); expect(existsSync(join(w.prefix, "bin", "agend"))).toBe(true);
  });
  it("never moves a retired payload that a working command still references", () => {
    const w = world(), old = leftover(w.prefix);
    writeFileSync(join(old, "agend"), "#!/bin/sh\necho 2.2.5\n");
    rmSync(join(w.prefix, "bin", "agend")); symlinkSync(join(old, "agend"), join(w.prefix, "bin", "agend"));
    // The file write updated directory mtime; establish the same stale age.
    utimesSync(old, new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000));
    expect(recovery.heal(w.prefix, { noNpmRunning: true })).toEqual([]);
    expect(existsSync(join(w.prefix, "bin", "agend"))).toBe(true);
  });
  it.each(["corrupt", "dead", "live"])("manual npm never refuses for a %s lock, updater only excludes a live peer", state => {
    const w = world(); const lock = join(w.prefix, ".agend-install.lock");
    const record = { pid: 4242, processStart: "old", prefix: w.prefix, targetSpec: "@songsid/agend@beta", agendHome: "/fixture", token: "a".repeat(32), createdAt: new Date().toISOString() };
    writeFileSync(lock, state === "corrupt" ? "{" : JSON.stringify(record));
    const deps = { env: {}, exists: () => state === "live", processStart: () => state === "live" ? "old" : null };
    const manual = admission.admit(w.pkg, deps); expect(manual.ok).toBe(true);
    if (state === "live") expect(manual.warning).toContain("4242"); else expect(manual.warning).toBeUndefined();
    const updater: InstallLockDeps = { pid: 100, exists: pid => pid === 100 || state === "live", processStart: pid => pid === 100 ? "own" : state === "live" ? "old" : null, newToken: () => "b".repeat(32), now: () => new Date(), log: () => {} };
    expect(acquireInstallLock(w.prefix, { spec: "@songsid/agend@beta", agendHome: w.prefix }, updater).ok).toBe(state !== "live");
    expect(existsSync(join(w.prefix, "bin", "agend"))).toBe(true);
  });
  it("recovery advice keeps the known previous version and never invents a downgrade", () => {
    expect(note.oldUpdaterNote("maybe", { AGEND_PREVIOUS_VERSION: "2.3.0-beta.17" })).toContain("@2.3.0-beta.17");
    expect(note.oldUpdaterNote("maybe", {})).toContain("@latest");
    expect(note.oldUpdaterNote("maybe", {})).not.toContain("2.1.12");
  });
});

describe("#2264 root/non-login systemd environment", () => {
  it.each([0, 1000])("fills missing XDG only for an owned runtime, uid=%s", uid => {
    expect(systemdUserEnvironment({ PATH: "/fixture" }, uid, () => true)).toEqual({ PATH: "/fixture", XDG_RUNTIME_DIR: `/run/user/${uid}` });
    expect(systemdUserEnvironment({}, uid, () => false)).toEqual({});
  });
  it("preserves explicit runtime and gives a concrete linger recovery", () => {
    expect(systemdUserEnvironment({ XDG_RUNTIME_DIR: "/custom" }, 0, () => true)).toEqual({ XDG_RUNTIME_DIR: "/custom" });
    expect(systemdUserRecoveryHint()).toContain("loginctl enable-linger");
    expect(systemdUserRecoveryHint()).toContain(`user@${process.getuid?.() ?? 0}.service`);
  });
});

describe("#2264 interrupted download cannot become an update success", () => {
  it("a dead updater receives a persisted terminal failure on the original receipt", () => {
    const w = world(); beginUpdateProgress(w.prefix, { adapterId: "telegram", chatId: "fixture", messageId: "original" });
    setUpdateProgressStage(w.prefix, "downloading"); reconcileUpdateProgress(w.prefix, Date.now(), () => false);
    expect(readUpdateProgress(w.prefix)?.progress).toMatchObject({ stage: "failed", failedStage: "downloading", target: { messageId: "original" }, error: expect.stringContaining("exited before completion") });
  });
  it("a live updater can finish, a hung one reaches a deadline, and old boot cannot claim success", () => {
    const w = world(); beginUpdateProgress(w.prefix, { adapterId: "telegram", chatId: "fixture", messageId: "original" });
    setUpdateProgressStage(w.prefix, "downloading"); reconcileUpdateProgress(w.prefix, Date.now(), () => true);
    expect(readUpdateProgress(w.prefix)?.progress.stage).toBe("downloading");
    expect(updateCanResumeAtStartup(readUpdateProgress(w.prefix)!, "2.2.5")).toBe(false);
    reconcileUpdateProgress(w.prefix, Date.now() + 36 * 60_000, () => true);
    expect(readUpdateProgress(w.prefix)?.progress.stage).toBe("failed");
  });
  it("only the installed target version or a full restart can adopt startup", () => {
    const w = world(); beginUpdateProgress(w.prefix, { adapterId: "telegram", chatId: "fixture", messageId: "original" });
    setUpdateProgressStage(w.prefix, "installed", { version: "2.3.0-beta.17" });
    expect(updateCanResumeAtStartup(readUpdateProgress(w.prefix)!, "2.2.5")).toBe(false);
    expect(updateCanResumeAtStartup(readUpdateProgress(w.prefix)!, "2.3.0-beta.17")).toBe(true);
  });
});
