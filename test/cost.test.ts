import { describe, it, expect } from "vitest";
import { estimateCost } from "../src/cost.js";
import { getModel } from "../src/models.js";

describe("estimateCost", () => {
  it("computes plain input+output cost per million tokens", () => {
    const opus = getModel("claude-opus-4-8"); // $5 in / $25 out
    // 400k in = $2.00, 60k out = $1.50 -> $3.50
    expect(estimateCost({ input: 400_000, output: 60_000 }, opus)).toBe(3.5);
  });

  it("applies cacheRead rate to the cached fraction of input", () => {
    const opus = getModel("claude-opus-4-8"); // input 5, cacheRead 0.5
    // 100k input, 50% cached: fresh 50k @5 = $0.25, cached 50k @0.5 = $0.025 -> $0.28 (rounded)
    const c = estimateCost({ input: 100_000, output: 0, cachedInputFraction: 0.5 }, opus);
    expect(c).toBeCloseTo(0.28, 2);
  });

  it("honors volume tiers (Gemini past 200k input)", () => {
    const g = getModel("gemini-3.1-pro-preview"); // base in 2/out 12; tier >200k in 4/out 18
    // 300k in @4 = $1.20, 10k out @18 = $0.18 -> $1.38
    expect(estimateCost({ input: 300_000, output: 10_000 }, g)).toBe(1.38);
  });

  it("cheap tester model is far cheaper than a flagship for the same work", () => {
    const flash = getModel("gemini-3-flash-preview");
    const fable = getModel("claude-fable-5");
    const work = { input: 80_000, output: 15_000 };
    expect(estimateCost(work, flash)).toBeLessThan(estimateCost(work, fable) / 5);
  });
});
