// "A newer model is out": reading model families from ids, and which newer version is offered.
import { describe, it, expect } from "vitest";
import { familyOf, newerThan, findUpgrades, upgraded } from "../src/model-updates.js";
import type { Model, Provider } from "../src/types.js";

const m = (provider: Provider, id: string, input = 1): Model => ({ id, provider, name: id, contextWindow: 1, cost: { input, output: input * 5, cacheRead: 0, cacheWrite: 0 } });

describe("familyOf", () => {
  it("reads Anthropic's dashed minor versions, OpenAI's tier suffixes and OpenRouter slugs", () => {
    expect(familyOf("claude-opus-5-5")).toEqual({ family: "claude-opus|", version: [5, 5] });
    expect(familyOf("gpt-5.6-sol")).toEqual({ family: "gpt|sol", version: [5, 6] });
    expect(familyOf("anthropic/claude-opus-5.5")).toEqual({ family: "anthropic/claude-opus|", version: [5, 5] });
    expect(familyOf("gemini-3-flash-preview")?.family).toBe(familyOf("gemini-3.8-flash")?.family);
  });
  it("ignores snapshots and variants, which are the same model repackaged", () => {
    for (const id of ["claude-opus-5-fast", "claude-opus-4-5-20251101", "anthropic/claude-opus-5:batch", "~anthropic/claude-opus-latest", "claude-opus-4-6-thinking"]) {
      expect(familyOf(id), id).toBeUndefined();
    }
  });
});

describe("newerThan", () => {
  const catalog = [
    m("anthropic", "claude-opus-5"), m("anthropic", "claude-opus-5-5"), m("anthropic", "claude-opus-5-5-fast"),
    m("anthropic", "claude-sonnet-5-5"), m("openai", "gpt-6.2-sol"), m("openai", "gpt-6.2-terra"),
    m("openrouter", "anthropic/claude-opus-6"), m("anthropic", "claude-opus-6-1", 0),
  ];
  it("offers the newest priced model of the same family and provider", () => {
    expect(newerThan("claude-opus-5", "anthropic", catalog)?.id).toBe("claude-opus-5-5"); // 6-1 has no price
    expect(newerThan("gpt-5.6-sol", "openai", catalog)?.id).toBe("gpt-6.2-sol"); // not terra
    expect(newerThan("anthropic/claude-opus-5", "openrouter", catalog)?.id).toBe("anthropic/claude-opus-6");
  });
  it("offers nothing for the newest model or another family", () => {
    expect(newerThan("claude-opus-5-5", "anthropic", catalog)).toBeUndefined();
    expect(newerThan("claude-haiku-4-5", "anthropic", catalog)).toBeUndefined();
  });
});

describe("findUpgrades / upgraded", () => {
  const catalog = [m("anthropic", "claude-opus-5-5"), m("anthropic", "claude-sonnet-5-5")];
  const team = [
    { label: "Developer", provider: "anthropic" as const, model: "claude-opus-5" },
    { label: "Designer", provider: "anthropic" as const, model: "claude-opus-5" },
    { label: "PM", provider: "anthropic" as const, model: "claude-sonnet-5" },
    { label: "Tester", provider: "local" as const, model: "qwen:7b" },
  ];
  it("groups roles per model and leaves out skipped versions", () => {
    const ups = findUpgrades(team, catalog, ["claude-sonnet-5-5"]);
    expect(ups.map((u) => [u.from, u.to.id, u.roles])).toEqual([["claude-opus-5", "claude-opus-5-5", ["Developer", "Designer"]]]);
  });
  it("follows switches, chained, without looping", () => {
    expect(upgraded("claude-opus-5", { "claude-opus-5": "claude-opus-5-5", "claude-opus-5-5": "claude-opus-6" })).toBe("claude-opus-6");
    expect(upgraded("a", { a: "b", b: "a" })).toBe("a");
    expect(upgraded("x", {})).toBe("x");
  });
});
