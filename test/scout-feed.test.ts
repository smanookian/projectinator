// Auto-scout from the OpenRouter catalog: price drift over 10% for models we price
// (native ids mapped to vendor/slug), new models only from routed vendors and only newer
// than what we know (variants skipped), one proposed finding per registry slot.

import { describe, it, expect } from "vitest";
import { scoutFromCatalog, slugFor } from "../src/scout-feed.js";
import type { ORModel } from "../src/openrouter.js";
import type { Model, RegistryEntry } from "../src/types.js";

const m = (id: string, provider: Model["provider"], input: number, output: number): Model => ({ id, provider, name: id, contextWindow: 1e6, cost: { input, output, cacheRead: 0, cacheWrite: 0 } });
const or = (id: string, input: number, output: number, created?: number): ORModel => ({ id, name: id, contextWindow: 1e6, cost: { input, output, cacheRead: 0, cacheWrite: 0 }, created });
const models: Record<string, Model> = {
  "claude-opus-4-8": m("claude-opus-4-8", "anthropic", 5, 25),
  "gpt-5.6-sol": m("gpt-5.6-sol", "openai", 4, 20),
  "google/gemini-3.8-flash": m("google/gemini-3.8-flash", "openrouter", 0.75, 3.75),
};
const registry: RegistryEntry[] = [
  { capability: "code", tier: "high", byBackend: { web: { provider: "anthropic", model: "claude-opus-4-8" }, api: { provider: "anthropic", model: "claude-opus-4-8" } }, evidence: "", updated: "" },
  { capability: "test", tier: "fast", byBackend: { web: { provider: "openrouter", model: "google/gemini-3.8-flash" }, api: { provider: "openrouter", model: "google/gemini-3.8-flash" } }, evidence: "", updated: "" },
];

describe("scout feed", () => {
  it("maps native ids to OpenRouter slugs", () => {
    expect(slugFor(models["claude-opus-4-8"]!)).toBe("anthropic/claude-opus-4.8");
    expect(slugFor(models["gpt-5.6-sol"]!)).toBe("openai/gpt-5.6-sol");
    expect(slugFor(models["google/gemini-3.8-flash"]!)).toBe("google/gemini-3.8-flash");
  });

  it("reports drift over 10% only, new models newer than the known ones, one finding per slot", () => {
    const catalog = [
      or("anthropic/claude-opus-4.8", 5, 25, 100), // same price
      or("openai/gpt-5.6-sol", 2, 10, 100), // halved
      or("google/gemini-3.8-flash", 0.8, 3.75, 100), // +6.7%: under threshold
      or("anthropic/claude-opus-5", 5, 25, 200), // new, newer
      or("anthropic/claude-opus-5:batch", 2.5, 12.5, 200), // variant: skipped
      or("anthropic/claude-haiku-3", 0.25, 1.25, 50), // older than what we know: skipped
      or("google/gemini-4-flash", 0.5, 2, 300), // new google
      or("mistral/large-9", 1, 3, 400), // vendor we don't route: skipped
    ];
    const r = scoutFromCatalog(catalog, models, registry);
    expect(r.drift).toEqual([{ id: "gpt-5.6-sol", slug: "openai/gpt-5.6-sol", ours: { input: 4, output: 20 }, live: { input: 2, output: 10 }, change: -0.5 }]);
    expect(r.newModels.map((n) => n.slug)).toEqual(["google/gemini-4-flash", "anthropic/claude-opus-5"]); // newest first
    expect(r.findings.map((f) => `${f.capability}/${f.tier}:${f.model}`)).toEqual(["test/fast:google/gemini-4-flash", "code/high:anthropic/claude-opus-5"]);
    expect(r.findings[0]!.provider).toBe("openrouter");
  });

  it("an empty catalog reports nothing", () => {
    expect(scoutFromCatalog([], models, registry)).toEqual({ drift: [], newModels: [], findings: [] });
  });
});
