// Code bake-off scoring and the quality/$ frontier — pure parts of bakeoff.ts.
import { describe, it, expect } from "vitest";
import { scoreVerdict, paretoFront, parseCandidates, type BakeoffEntry, type JudgeScore } from "../src/bakeoff.js";

const e = (model: string, cost: number, provider: BakeoffEntry["provider"] = "anthropic", error?: string): BakeoffEntry => ({ provider, model, output: "", cost, ms: 0, outputTokens: 0, error });
const s = (model: string, score: number): JudgeScore => ({ model, score, reason: "" });

describe("scoreVerdict", () => {
  it("PASS run = 10, PASS read-only = 9, bugs cost by severity, FAIL caps at 5", () => {
    expect(scoreVerdict({ passed: true, runtimeChecked: true, bugs: [] })).toBe(10);
    expect(scoreVerdict({ passed: true, runtimeChecked: false, bugs: [] })).toBe(9);
    expect(scoreVerdict({ passed: true, runtimeChecked: true, bugs: [{ severity: "low", description: "" }, { severity: "medium", description: "" }] })).toBe(7);
    expect(scoreVerdict({ passed: false, runtimeChecked: true, bugs: [{ severity: "high", description: "" }] })).toBe(2);
    expect(scoreVerdict({ passed: false, runtimeChecked: true, bugs: [{ severity: "high", description: "" }, { severity: "high", description: "" }] })).toBe(0);
  });
});

describe("paretoFront", () => {
  it("keeps models no other beats on both axes; best value = score per dollar among passing (≥6); errors ignored", () => {
    const entries = [e("opus", 0.5), e("sonnet", 0.2), e("haiku", 0.05), e("flash", 0.04, "openrouter"), e("broken", 0.01, "anthropic", "boom")];
    const scores = [s("anthropic/opus", 9), s("anthropic/sonnet", 8), s("anthropic/haiku", 5), s("openrouter/flash", 6)];
    const r = paretoFront(entries, scores);
    // haiku is dominated by flash (better AND cheaper); the rest trade off
    expect(r.pareto).toEqual(["anthropic/opus", "anthropic/sonnet", "openrouter/flash"]);
    expect(r.bestValue).toBe("openrouter/flash"); // 6/0.04 = 150 per $
    // a cheap failure is never "best value"
    expect(paretoFront([e("a", 0.5), e("b", 0.001)], [s("anthropic/a", 9), s("anthropic/b", 2)]).bestValue).toBe("anthropic/a");
  });
  it("nothing scored → empty frontier", () => {
    expect(paretoFront([e("a", 1)], [])).toEqual({ pareto: [], bestValue: undefined });
  });
});

describe("parseCandidates", () => {
  it("provider:model, bare ids → default provider, slugs → openrouter", () => {
    expect(parseCandidates("anthropic:claude-opus-5, gpt-5.6-sol,google/gemini-3.8-flash,local:qwen3", "openai")).toEqual([
      { provider: "anthropic", model: "claude-opus-5" },
      { provider: "openai", model: "gpt-5.6-sol" },
      { provider: "openrouter", model: "google/gemini-3.8-flash" },
      { provider: "local", model: "qwen3" },
    ]);
  });
});
