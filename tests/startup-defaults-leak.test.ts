/**
 * Tests for #N: defaults.startup must not leak into instance configs (#live bug 2026-10-21).
 *
 * Root cause: getEffectiveInstanceDefaults() did not strip `startup` from
 * FleetDefaults, so `defaults.startup.stagger_delay_ms` was merged into every
 * instance's InstanceConfig. On SIGHUP after editing stagger_delay_ms, every
 * running instance appeared "config changed" and was restarted.
 */
import { describe, expect, it } from "vitest";
import { getEffectiveInstanceDefaults, loadFleetConfig } from "../src/config.js";
import { classifyInstanceChange } from "../src/instance-config-impact.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "agend-startup-defaults-"));
  dirs.push(d);
  return d;
}
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

// ── getEffectiveInstanceDefaults: startup must not appear ───────────────────

describe("getEffectiveInstanceDefaults — startup not merged into instances", () => {
  it("startup is absent from effective instance defaults when set in fleet defaults", () => {
    const result = getEffectiveInstanceDefaults({
      backend: "claude-code",
      startup: { concurrency: 4, stagger_delay_ms: 2000 },
    });
    // startup is fleet-only; no instance should see it
    expect(result).not.toHaveProperty("startup");
  });

  it("startup absent from defaults → still absent in effective", () => {
    const result = getEffectiveInstanceDefaults({ backend: "claude-code" });
    expect(result).not.toHaveProperty("startup");
  });

  it("instance-level fields (backend, model) are still forwarded", () => {
    const result = getEffectiveInstanceDefaults({ backend: "kiro-cli", model: "claude-sonnet-4.6" });
    expect(result.backend).toBe("kiro-cli");
    expect(result.model).toBe("claude-sonnet-4.6");
  });

  it("other fleet-only fields (tips, max_cross_instance_message_bytes) are also absent", () => {
    const result = getEffectiveInstanceDefaults({
      tips: "on" as any,
      max_cross_instance_message_bytes: 12288,
      backend: "claude-code",
    });
    expect(result).not.toHaveProperty("tips");
    expect(result).not.toHaveProperty("max_cross_instance_message_bytes");
  });
});

// ── loadFleetConfig: startup does not appear in instance entries ─────────────

describe("loadFleetConfig — startup not written into instance entries", () => {
  it("instance config does not contain startup when defaults.startup is set", () => {
    const d = tmp();
    const wdir = join(d, "proj");
    mkdirSync(wdir, { recursive: true });
    writeFileSync(join(d, "fleet.yaml"), [
      "defaults:",
      "  backend: claude-code",
      "  startup:",
      "    stagger_delay_ms: 2000",
      "    concurrency: 4",
      "instances:",
      "  my-agent:",
      `    working_directory: ${wdir}`,
    ].join("\n"));
    const config = loadFleetConfig(join(d, "fleet.yaml"));
    const inst = config.instances["my-agent"];
    expect(inst).toBeDefined();
    expect(inst).not.toHaveProperty("startup");
    // fleet-level startup is still accessible through defaults
    expect(config.defaults?.startup?.stagger_delay_ms).toBe(2000);
  });
});

// ── classifyInstanceChange: changing startup does not restart instances ───────

describe("classifyInstanceChange — startup change does not restart instances", () => {
  it("changing startup in defaults does not cause classifyInstanceChange to return 'restart'", () => {
    // Before fix: startup leaked into InstanceConfig, so runtimeConfig would
    // contain { startup: { stagger_delay_ms: 2000 } } and the new config would
    // contain { startup: { stagger_delay_ms: 500 } } → classifyInstanceChange
    // would see a cold field change → "restart" for every instance.
    //
    // After fix: startup is stripped from InstanceConfig; both runtime and new
    // configs lack startup → classifyInstanceChange returns "none".
    const runtimeConfig = getEffectiveInstanceDefaults({
      startup: { stagger_delay_ms: 2000 },
    });
    const newConfig = getEffectiveInstanceDefaults({
      startup: { stagger_delay_ms: 500 },
    });
    // Neither config should have startup
    expect(runtimeConfig).not.toHaveProperty("startup");
    expect(newConfig).not.toHaveProperty("startup");
    // classifyInstanceChange sees no difference → no restart
    const result = classifyInstanceChange(
      runtimeConfig as any,
      newConfig as any,
    );
    expect(result, "changing defaults.startup must not restart instances").toBe("none");
  });

  it("changing a real instance field (backend) still triggers restart", () => {
    const runtimeConfig = getEffectiveInstanceDefaults({ backend: "claude-code" });
    const newConfig = getEffectiveInstanceDefaults({ backend: "kiro-cli" });
    const result = classifyInstanceChange(
      runtimeConfig as any,
      newConfig as any,
    );
    expect(result).toBe("restart");
  });
});

// ── handleCreate / lossless patch: startup not written into new instance entry ─

describe("handleCreate — startup not written into new instance's InstanceConfig", () => {
  it("instanceConfig built by handleCreate does not contain startup", () => {
    // Verify getEffectiveInstanceDefaults is called (not raw defaults spread)
    // by checking that a FleetDefaults with startup produces no startup in result.
    const fleetDefaults = {
      backend: "claude-code",
      model: "claude-sonnet-4.6",
      startup: { stagger_delay_ms: 2000, concurrency: 4 },
    };
    const effective = getEffectiveInstanceDefaults(fleetDefaults);
    // Simulate what handleCreate now does: DEFAULT_INSTANCE_CONFIG + effective + overrides
    const instanceConfig = {
      ...{ working_directory: "/work" }, // DEFAULT_INSTANCE_CONFIG placeholder
      ...effective,
      working_directory: "/work/proj",
      topic_id: "123456789",
    };
    expect(instanceConfig).not.toHaveProperty("startup");
    expect(instanceConfig.backend).toBe("claude-code");
    expect(instanceConfig.model).toBe("claude-sonnet-4.6");
  });
});

// ── Source-structure check: startup is in the strip list ─────────────────────

describe("getEffectiveInstanceDefaults source: startup in destructure list", () => {
  it("config.ts strips startup from fleetDefaults before merging", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "../src/config.ts"),
      "utf-8",
    );
    // The destructure-and-discard pattern must name startup
    expect(src).toContain("startup: _startup");
    // And the function name must appear near it
    const fnStart = src.indexOf("function getEffectiveInstanceDefaults");
    const fnBlock = src.slice(fnStart, fnStart + 1500);
    expect(fnBlock).toContain("startup: _startup");
  });

  it("instance-lifecycle.ts handleCreate uses getEffectiveInstanceDefaults (not raw defaults spread)", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "../src/instance-lifecycle.ts"),
      "utf-8",
    );
    // Must call getEffectiveInstanceDefaults, not spread raw defaults
    expect(src).toContain("getEffectiveInstanceDefaults(this.ctx.fleetConfig!.defaults");
    // Old raw spread must be absent
    expect(src).not.toContain("...this.ctx.fleetConfig!.defaults,");
  });
});
