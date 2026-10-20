/** #2264: serialize two AgEnD updaters sharing a prefix. This mutex never
 * admits/refuses manual npm installs and never touches package/bin paths.
 * Publish complete records atomically; reclaim corrupt/dead owners with the
 * existing ownership fence. A live competitor is named, not removed. */
import { linkSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "./atomic-write.js";

export const INSTALL_LOCK_FILE = ".agend-install.lock";
export const INSTALL_TOKEN_ENV = "AGEND_INSTALL_TOKEN";

export interface InstallLockRecord {
  pid: number;
  /** The holder's start time as `ps -o lstart=` prints it: with the pid, the process's identity. */
  processStart: string;
  /**
   * #1947 (Linux): the holder's start in clock ticks since boot (/proc/<pid>/stat field 22), immune to a clock step.
   * Absent from every 2.2 beta's lock and on macOS: those are judged by `processStart`, within a tolerance.
   */
  startTicks?: string;
  /** #1947: the boot those ticks count from (/proc/sys/kernel/random/boot_id); present exactly when startTicks is. */
  bootId?: string;
  prefix: string;
  targetSpec: string;
  agendHome: string;
  token: string;
  createdAt: string;
}

export interface InstallLockDeps {
  pid: number;
  /** `ps -o lstart= -p <pid>`, trimmed; null when the process does not exist or cannot be read. */
  processStart(pid: number): string | null;
  /** #1947: /proc/<pid>/stat start ticks (Linux), or null; omitted: none recorded and the lstart text decides. */
  startTicks?(pid: number): string | null;
  /** #1947: this boot's id, or null; omitted with startTicks. */
  bootId?(): string | null;
  /** Does the pid exist (false only for a definite "no such process")? Default: process.kill(pid, 0). */
  exists?(pid: number): boolean;
  /** Test seams (another updater's turn): after a lock was judged stale; after it was moved aside. */
  afterStaleJudged?(): void;
  afterStaleMoved?(): void;
  newToken(): string;
  now(): Date;
  log(message: string): void;
}

export type InstallLock =
  | { ok: true; path: string; token: string; release(): void }
  | { ok: false; path: string; reason: string };

/** The record, or why it is not one (unreadable, unparsable, wrong shape). */
export function parseInstallLock(text: string): InstallLockRecord | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  const r = value as Partial<InstallLockRecord> | null;
  return r && Number.isSafeInteger(r.pid) && (r.pid as number) > 0 && typeof r.processStart === "string" && r.processStart
    && typeof r.prefix === "string" && typeof r.token === "string" && /^[0-9a-f]{32,}$/.test(r.token)
    && typeof r.targetSpec === "string" && typeof r.agendHome === "string" && typeof r.createdAt === "string"
    && ((r.startTicks === undefined && r.bootId === undefined)
      || (typeof r.startTicks === "string" && /^\d+$/.test(r.startTicks) && typeof r.bootId === "string" && /^[0-9a-f-]{36}$/.test(r.bootId)))
    ? r as InstallLockRecord : null;
}

const pidExists = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException).code !== "ESRCH"; }
};

/**
 * The recorded holder: "live" (that very process), "stale" (PROVEN gone: no such pid, or the pid now belongs to a
 * process that started at another time), or "unknown" (it exists, but its start time cannot be read) — which blocks.
 */
export function holderState(record: { pid: number; processStart: string; startTicks?: string; bootId?: string }, deps: Pick<InstallLockDeps, "processStart" | "exists" | "startTicks" | "bootId">): "live" | "stale" | "unknown" {
  if (!(deps.exists ?? pidExists)(record.pid)) return "stale";
  // #1947: a lock with start ticks is judged by them and its boot, never by the wall clock (another boot → stale; the
  // same ticks → live; unreadable → unknown); otherwise the lstart text, within a tolerance. The postinstall's rule
  // (launcher/install-admission.cjs holderState).
  if (record.startTicks !== undefined) {
    const boot = deps.bootId?.() ?? null;
    if (boot === null) return "unknown";
    if (boot !== record.bootId) return "stale";
    const ticks = deps.startTicks?.(record.pid) ?? null;
    if (ticks === null) return "unknown";
    return ticks === record.startTicks ? "live" : "stale";
  }
  const seen = deps.processStart(record.pid);
  if (seen === null) return "unknown";
  return sameStartText(record.processStart, seen) ? "live" : "stale";
}

/** #1947: how far two lstart texts of one process may differ (a clock step between the two reads); 1 s resolution. */
export const START_TOLERANCE_MS = 2_000;

/** The same start, as `ps -o lstart=` printed it (LC_ALL=C, TZ=UTC): identical, or both times at most 2 s apart. */
export function sameStartText(recorded: string, seen: string): boolean {
  if (recorded === seen) return true;
  const a = Date.parse(`${recorded} UTC`), b = Date.parse(`${seen} UTC`);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= START_TOLERANCE_MS;
}

const readOrNull = (path: string): string | null => { try { return readFileSync(path, "utf8"); } catch { return null; } };

export function acquireInstallLock(prefix: string, target: { spec: string; agendHome: string }, deps: InstallLockDeps): InstallLock {
  let canonical: string;
  try { canonical = realpathSync(prefix); } catch { return { ok: false, path: join(prefix, INSTALL_LOCK_FILE), reason: `the npm prefix ${prefix} does not exist` }; }
  const path = join(canonical, INSTALL_LOCK_FILE);
  const ownStart = deps.processStart(deps.pid);
  if (!ownStart) return { ok: false, path, reason: "this process's own start time cannot be read, so its lock could not be told from a stale one" };
  const ownTicks = deps.startTicks?.(deps.pid) ?? null;
  const ownBoot = deps.bootId?.() ?? null;
  const record: InstallLockRecord = {
    pid: deps.pid, processStart: ownStart, ...(ownTicks !== null && ownBoot !== null ? { startTicks: ownTicks, bootId: ownBoot } : {}), prefix: canonical,
    targetSpec: target.spec, agendHome: target.agendHome, token: deps.newToken(), createdAt: deps.now().toISOString(),
  };
  const serialized = JSON.stringify(record) + "\n";
  const claim = (): boolean => {
    const prepared = `${path}.claim-${deps.pid}-${record.token}`;
    try {
      // Complete and fsync the record before publishing it exclusively. A
      // killed writer cannot leave a half-written lock blocking recovery.
      atomicWriteFileSync(prepared, serialized, { mode: 0o600 });
      linkSync(prepared, path);
      return true;
    } catch (err) { if ((err as NodeJS.ErrnoException).code === "EEXIST") return false; throw err; }
    finally { try { unlinkSync(prepared); } catch { /* not published */ } }
  };
  const ours: InstallLock = { ok: true, path, token: record.token, release: () => releaseIfOurs(path, serialized, deps) };

  try {
    if (claim()) return ours;
  } catch (err) {
    return { ok: false, path, reason: `the install lock ${path} could not be created (${(err as Error).message})` };
  }
  const seen = readOrNull(path);
  const holder = parseInstallLock(seen ?? "");
  // #2264 user policy: this is only an updater-vs-updater guard, never
  // admission for manual npm repair. Corrupt records are reclaimable.
  const state = holder ? holderState(holder, deps) : "stale";
  if (state === "live") {
    return { ok: false, path, reason: `another AgEnD install is running on ${canonical} (pid ${holder!.pid}, installing ${holder!.targetSpec} for ${holder!.agendHome}); wait for it to finish` };
  }
  if (state === "unknown") {
    return { ok: false, path, reason: `whether the install that holds ${path} (pid ${holder!.pid}) is still running cannot be told; retry, or remove the lock once no \`agend update\` runs` };
  }

  // Stale. Moving the lock file is owned too: only the holder of the reclaim marker may do it. Without that, an updater
  // that judged an old stale lock could move a lock another updater has just claimed in its place (#1472 review).
  const marker = `${path}.reclaim`;
  deps.afterStaleJudged?.();
  try { writeFileSync(marker, serialized, { flag: "wx", mode: 0o600 }); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") return { ok: false, path, reason: `the reclaim marker ${marker} could not be created (${(err as Error).message})` };
    const other = parseInstallLock(readOrNull(marker) ?? "");
    const otherState = other ? holderState(other, deps) : "unknown";
    // A marker is held for a few file operations; one left by a crash in that window is never taken automatically.
    return otherState === "live"
      ? { ok: false, path, reason: `another install is replacing the stale lock on ${canonical}; retry` }
      : { ok: false, path, reason: `a reclaim marker ${marker} was left behind (pid ${other?.pid ?? "unknown"}); if no \`agend update\` runs, remove it and retry` };
  }
  try {
    // Under the marker the lock can change only by its live owner's release — and its holder is proven gone — so the
    // file judged above is still the one to move; re-read anyway and refuse on any difference.
    if (readOrNull(path) !== seen) return { ok: false, path, reason: `another install is starting on ${canonical}; retry` };
    const aside = `${path}.stale-${deps.pid}-${record.token.slice(0, 8)}`;
    try { renameSync(path, aside); } catch { return { ok: false, path, reason: `another install is starting on ${canonical}; retry` }; }
    deps.afterStaleMoved?.();
    if (readOrNull(aside) !== seen) {
      // Cannot happen under the marker; if it ever does, theirs goes back (link never overwrites) and nothing is deleted.
      try { linkSync(aside, path); unlinkSync(aside); } catch { deps.log(`  ⚠ An install lock changed while it was being replaced; left at ${aside}.`); }
      return { ok: false, path, reason: `another install is starting on ${canonical}; retry` };
    }
    // Preserve corrupt records for diagnosis; never require a manual rm.
    if (holder) { try { unlinkSync(aside); } catch { /* best effort */ } }
    deps.log(holder ? `  Replaced a stale install lock (pid ${holder.pid} is gone, was installing ${holder.targetSpec}).`
      : `  Replaced an unreadable or corrupt update lock; preserved it at ${aside}.`);
    try {
      if (claim()) return ours;
    } catch (err) {
      return { ok: false, path, reason: `the install lock ${path} could not be created (${(err as Error).message})` };
    }
    return { ok: false, path, reason: `another install is starting on ${canonical}; retry` };
  } finally {
    releaseIfOurs(marker, serialized, deps);
  }
}

/** Remove the lock only while it is still exactly the one this process wrote; never another owner's. */
function releaseIfOurs(path: string, serialized: string, deps: Pick<InstallLockDeps, "pid" | "log">): void {
  if (readOrNull(path) !== serialized) return;
  const aside = `${path}.release-${deps.pid}`;
  try { renameSync(path, aside); } catch { return; }
  if (readOrNull(aside) === serialized) {
    try { unlinkSync(aside); } catch { /* best effort */ }
    return;
  }
  // Someone replaced it between the check and the rename: put theirs back.
  try { linkSync(aside, path); } catch { deps.log(`  ⚠ The install lock changed while being released; left at ${aside}.`); return; }
  try { unlinkSync(aside); } catch { /* best effort */ }
}
