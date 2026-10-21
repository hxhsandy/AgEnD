// #2347: over the temporary public link the fleet's settings are read-only on the server too — a real gateway listener
// refuses every write that changes fleet.yaml (or applies, reloads or restarts it) with 403 before any handler, and
// still serves reads and the operations the page keeps there. The page's switch and the server's agree.
import { request } from "node:http";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicWebGateway, FLEET_READ_ONLY_OVER_PUBLIC_LINK, isPublicFleetWrite, isPublicWebRoute, type PublicGateway } from "../src/public-web-gateway.js";

const host = "ro-fixture.trycloudflare.com";
let gateway: PublicGateway, base: URL;
const dispatched: string[] = [];
beforeAll(async () => {
  gateway = createPublicWebGateway({ exposureId: "b".repeat(32), isCurrent: () => true, isOpen: () => true,
    dispatch: (req, res) => { dispatched.push(`${req.method} ${req.url}`); res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); } });
  gateway.setHost(host);
  base = await gateway.listen();
});
afterAll(() => gateway.close());

function send(method: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    // One connection per request (agent: false): the gateway keeps at most 32 sockets and drops the rest.
    const req = request({ host: base.hostname, port: base.port, method, path, agent: false, headers: { host, "content-type": "application/json" } }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end(method === "GET" ? undefined : "{}");
  });
}

const WRITES: Array<[string, string]> = [
  ["PUT", "/api/settings/fleet/defaults"], ["PUT", "/api/settings/fleet/channels"], ["PUT", "/api/settings/fleet/web"], ["PUT", "/api/settings/classic/defaults"],
  ["PATCH", "/api/settings/classic/channels/room1"], ["POST", "/api/settings/fleet/instances"], ["PATCH", "/api/settings/fleet/instances/alpha"],
  ["DELETE", "/api/settings/fleet/instances/alpha"], ["POST", "/api/settings/apply"], ["POST", "/api/settings/restart-fleet"], ["POST", "/api/settings/reload"],
  ["POST", "/api/settings/quickstart/commit"], ["POST", "/api/settings/secrets/OPENAI/verify"], ["POST", "/api/settings/provider-secrets/openai/apply"],
  ["POST", "/api/settings/connections/main/secret/apply"], ["POST", "/api/settings/connections/main/binding/verify"],
  ["POST", "/ui/instances"], ["POST", "/ui/config"], ["POST", "/ui/instances/alpha/delete"],
];
const KEPT: Array<[string, string]> = [
  ["GET", "/api/settings/schema"], ["GET", "/api/settings/fleet/raw"], ["GET", "/api/settings/apply/job1"], ["POST", "/api/settings/status-emojis/preview"],
  ["POST", "/api/settings/quickstart/probe"], ["POST", "/api/settings/instances/alpha/pause"], ["POST", "/api/settings/instances/alpha/wake"],
  ["DELETE", `/api/settings/pending/${"c".repeat(32)}`], ["POST", "/ui/stop/alpha"], ["POST", "/ui/send"],
];

describe("#2347: the fleet's settings are read-only over the public link, on the server", () => {
  it("every route here is one the public link offers at all (so the refusal is this rule, not the route list)", () => {
    expect([...WRITES, ...KEPT].filter(([m, p]) => !isPublicWebRoute(m, p))).toEqual([]);
  });
  it("a real listener refuses each fleet write with 403 before any handler", async () => {
    dispatched.length = 0;
    const out = [];
    for (const [m, p] of WRITES) { const r = await send(m, p); out.push([m, p, r.status, JSON.parse(r.body).error]); }
    expect(out.filter(([, , status, error]) => status !== 403 || error !== "fleet_settings_read_only_over_public_link")).toEqual([]);
    expect(dispatched).toEqual([]);
  });
  it("…and still hands over reads and the operations the page keeps there", async () => {
    dispatched.length = 0;
    const out = [];
    for (const [m, p] of KEPT) out.push((await send(m, p)).status);
    expect([out, dispatched]).toEqual([KEPT.map(() => 200), KEPT.map(([m, p]) => `${m} ${p}`)]);
  });
  it("one switch on each side, set the same way: the page's FLEET_READ_ONLY_OVER_PUBLIC_LINK and the server's", () => {
    const page = ["src/ui/settings-draft.js", "src/ui/shared/app-store.js"].map((f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } }).join("\n");
    const m = page.match(/export const FLEET_READ_ONLY_OVER_PUBLIC_LINK = (true|false);/);
    expect([m?.[1], FLEET_READ_ONLY_OVER_PUBLIC_LINK]).toEqual(["true", true]);
    expect(isPublicFleetWrite("GET", "/api/settings/fleet/raw")).toBe(false);
  });
});
