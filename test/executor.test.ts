// Offline integration test — no API key, no network, no spend.
// Proves our registry's model ids resolve to real Pi models, and the developer
// prompt is well-formed. This is the safety net that guarantees the live path
// won't fail on a bad model id.

import { describe, it, expect } from "vitest";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { resolvePiModel, buildDeveloperPrompt } from "../src/executor.js";
import { REGISTRY } from "../src/registry.js";
import { MODELS } from "../src/models.js";
import type { Task } from "../src/types.js";

const registry = ModelRegistry.create(AuthStorage.create());

describe("every model in our table resolves in Pi's registry", () => {
  for (const [id, model] of Object.entries(MODELS)) {
    it(`${model.provider}/${id}`, () => {
      const pi = resolvePiModel(registry, model.provider, id);
      expect(pi.id).toBe(id);
    });
  }
});

describe("every registry pick (both backends) is executable in Pi", () => {
  for (const entry of REGISTRY) {
    for (const backend of ["web", "api"] as const) {
      const pick = entry.byBackend[backend];
      it(`${entry.capability}/${entry.tier} ${backend} -> ${pick.model}`, () => {
        const pi = resolvePiModel(registry, pick.provider, pick.model);
        expect(pi.id).toBe(pick.model);
      });
    }
  }
});

describe("our estimated price matches Pi's authoritative price", () => {
  it("input/output rates agree for the core roster", () => {
    for (const id of ["claude-opus-4-8", "claude-fable-5", "gpt-5.6-sol", "gpt-5.6-terra"]) {
      const ours = MODELS[id]!;
      const pi = registry.find(ours.provider, id)!;
      expect(pi.cost?.input).toBe(ours.cost.input);
      expect(pi.cost?.output).toBe(ours.cost.output);
    }
  });
});

describe("buildDeveloperPrompt", () => {
  it("names the task and instructs file writes", () => {
    const task: Task = {
      id: "T-1", title: "Build a widget", capability: "code", difficulty: "high",
      estTokens: { input: 1000, output: 500 },
    };
    const p = buildDeveloperPrompt(task);
    expect(p).toContain("T-1");
    expect(p).toContain("Build a widget");
    expect(p.toLowerCase()).toContain("file");
  });
});

describe("resolvePiModel fails loudly on an unknown id", () => {
  it("throws with a helpful message", () => {
    expect(() => resolvePiModel(registry, "anthropic", "claude-nonexistent-9")).toThrow(/no model/i);
  });
});
