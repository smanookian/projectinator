// Per-model calibration: measured runs are folded into both the generic bucket and a
// per-model bucket; the router prices with the per-model average once it has enough
// samples and otherwise leaves the task's estimate alone. HOME is redirected so the
// user's real ~/.projectinator/calibration.json is never touched.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "pi-cal-"));
const realHome = process.env.HOME;
process.env.HOME = home; // must precede the imports below (os.homedir() reads it lazily)

const { recordActual, calibratedTokens, modelCalibratedTokens } = await import("../src/calibration.js");
const { estimateAccuracy } = await import("../src/estimate.js");
const { route, DEFAULT_POLICY } = await import("../src/router.js");
const { lockRegistryToProvider } = await import("../src/roles.js");
const { findEntry } = await import("../src/registry.js");

afterAll(() => { process.env.HOME = realHome; rmSync(home, { recursive: true, force: true }); });
beforeEach(() => rmSync(join(home, ".projectinator"), { recursive: true, force: true }));

const registry = lockRegistryToProvider("anthropic");
const modelFor = (cap: "code" | "test", tier: "fast" | "mid" | "high") => findEntry(cap, tier, registry).entry.byBackend.api.model;
const task = { id: "T", title: "t", capability: "code" as const, difficulty: "high" as const, dependsOn: [], estTokens: { input: 100_000, output: 20_000 } };
const policy = { ...DEFAULT_POLICY, backendMode: "api" as const };

describe("per-model calibration", () => {
  it("one run records both the generic and the model bucket; neither is live yet", () => {
    recordActual("code", "high", 4_000, 1_500, 0.9, "claude-opus-5");
    expect(calibratedTokens("code", "high")).toBeUndefined();
    expect(modelCalibratedTokens("code", "high", "claude-opus-5")).toBeUndefined();
    const rows = estimateAccuracy();
    expect(rows.map((r) => r.model)).toEqual([undefined, "claude-opus-5"]);
    expect(rows.every((r) => r.n === 1 && !r.active)).toBe(true);
  });
  it("the router keeps the task estimate until the routed model has enough samples", () => {
    const model = modelFor("code", "high");
    const before = route(task, { policy, registry }).cost;
    recordActual("code", "high", 4_000, 1_500, 0.9, "some-other-model");
    recordActual("code", "high", 4_000, 1_500, 0.9, "some-other-model");
    expect(calibratedTokens("code", "high")).toBeDefined(); // generic bucket is live…
    const d = route(task, { policy, registry });
    expect(d.cost).toBe(before); // …but the router does not use it for a different model
    expect(d.reasons.some((r) => r.includes("measured runs"))).toBe(false);
    expect(modelCalibratedTokens("code", "high", model)).toBeUndefined();
  });

  it("once the routed model has samples, the router prices with them", () => {
    const model = modelFor("code", "high");
    const before = route(task, { policy, registry }).cost;
    recordActual("code", "high", 4_000, 1_500, 0.9, model);
    recordActual("code", "high", 4_000, 1_500, 0.9, model);
    const d = route(task, { policy, registry });
    expect(d.cost).toBeLessThan(before); // 4k/1.5k tokens is far below the 100k/20k estimate
    expect(d.reasons).toContain(`tokens from measured runs on ${model}`);
  });
});
