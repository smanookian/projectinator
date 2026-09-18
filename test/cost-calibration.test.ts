// Plan estimates ran ~2x low and halted builds against their own cap. Deriving cost from tokens
// assumed input served from cache bills at the cacheRead rate; measured bills behave as if there
// is no cache discount (a task estimated at $0.15 with 95% cache assumed, $0.54 with none,
// actually cost $0.50). So: price conservatively until a bucket has measured runs, then use the
// measured price.

import { describe, it, expect, beforeEach } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { recordActual, calibratedCostUSD } from "../src/calibration.js";
import { dataHome } from "../src/tui/config.js";
import { route, DEFAULT_POLICY } from "../src/router.js";
import { lockRegistryToProvider } from "../src/roles.js";
import { findEntry } from "../src/registry.js";
import { estimateCost } from "../src/cost.js";
import { getModel } from "../src/models.js";

const registry = lockRegistryToProvider("anthropic");
const policy = { ...DEFAULT_POLICY, backendMode: "api" as const };
const task = {
  id: "T", title: "t", capability: "code" as const, difficulty: "medium" as const,
  dependsOn: [], estTokens: { input: 100_000, output: 4_000, cachedInputFraction: 0.95 },
};
const decide = () => route(task, { policy, registry, runningTotalBefore: 0 });

beforeEach(() => rmSync(join(dataHome(), "calibration.json"), { force: true }));

describe("cost estimation", () => {
  it("prices without a cache discount until the bucket has measured runs", () => {
    const model = getModel(findEntry("code", "mid", registry).entry.byBackend.api.model);
    const optimistic = estimateCost(task.estTokens, model);
    const conservative = estimateCost({ ...task.estTokens, cachedInputFraction: 0 }, model);
    expect(conservative).toBeGreaterThan(optimistic); // otherwise this test proves nothing

    expect(decide().cost).toBeCloseTo(conservative, 3);
  });

  it("uses the measured price once the bucket has enough runs on that model", () => {
    const modelId = findEntry("code", "mid", registry).entry.byBackend.api.model;
    // Two real runs that each billed $0.42, with token counts that would price far lower.
    for (let i = 0; i < 2; i++) recordActual("code", "medium", 50_000, 1_000, 0.95, modelId, 1_000, 0.42);

    expect(calibratedCostUSD("code", "medium", modelId)).toBeCloseTo(0.42, 4);
    const d = decide();
    expect(d.cost).toBeCloseTo(0.42, 4);
    expect(d.reasons.join(" ")).toMatch(/measured runs/);
  });

  it("one run is not enough to price from — it stays conservative", () => {
    const modelId = findEntry("code", "mid", registry).entry.byBackend.api.model;
    recordActual("code", "medium", 50_000, 1_000, 0.95, modelId, 1_000, 0.42);
    expect(calibratedCostUSD("code", "medium", modelId)).toBeUndefined();
    expect(decide().cost).not.toBeCloseTo(0.42, 4);
  });
});
