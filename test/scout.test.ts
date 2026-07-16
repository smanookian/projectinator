// Offline tests for the Scout + registry store. Pure logic, no network.

import { describe, it, expect } from "vitest";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { proposeUpdate, meaningfulChanges, formatProposal, type Finding } from "../src/scout.js";
import { mergeRegistry, loadRegistry, saveOverrides } from "../src/registry-store.js";
import { REGISTRY, findEntry } from "../src/registry.js";
import type { RegistryEntry } from "../src/types.js";

describe("proposeUpdate", () => {
  it("flags an update when the model differs", () => {
    const f: Finding[] = [{ capability: "code", tier: "high", backend: "api", provider: "anthropic", model: "claude-fable-5", evidence: "Fable now leads" }];
    const { updated, changes } = proposeUpdate(REGISTRY, f);
    const change = changes.find((c) => c.capability === "code" && c.tier === "high")!;
    expect(change.kind).toBe("update");
    expect(change.from).toBe("claude-opus-4-8");
    expect(change.to).toBe("claude-fable-5");
    // updated registry reflects it
    const entry = updated.find((e) => e.capability === "code" && e.tier === "high")!;
    expect(entry.byBackend.api.model).toBe("claude-fable-5");
    // input registry is untouched (pure)
    expect(findEntry("code", "high").entry.byBackend.api.model).toBe("claude-opus-4-8");
  });

  it("marks a noop when the finding matches the current pick", () => {
    const f: Finding[] = [{ capability: "test", tier: "fast", backend: "api", provider: "google", model: "gemini-3-flash-preview", evidence: "same" }];
    const { changes } = proposeUpdate(REGISTRY, f);
    expect(changes[0]!.kind).toBe("noop");
    expect(meaningfulChanges(changes)).toHaveLength(0);
  });

  it("adds a new capability/tier slot", () => {
    const f: Finding[] = [{ capability: "plan", tier: "high", backend: "api", provider: "openai", model: "gpt-5.6-sol", evidence: "new tier" }];
    const { updated, changes } = proposeUpdate(REGISTRY, f);
    expect(changes[0]!.kind).toBe("add");
    expect(updated.some((e) => e.capability === "plan" && e.tier === "high")).toBe(true);
  });

  it("flags a model not present in models.ts", () => {
    const f: Finding[] = [{ capability: "code", tier: "high", backend: "api", provider: "anthropic", model: "claude-imaginary-9", evidence: "hype" }];
    const { changes } = proposeUpdate(REGISTRY, f);
    expect(changes[0]!.kind).toBe("unknown-model");
  });

  it("formats a readable proposal and hides noops", () => {
    const f: Finding[] = [
      { capability: "code", tier: "high", backend: "api", provider: "anthropic", model: "claude-fable-5", evidence: "leads" },
      { capability: "test", tier: "fast", backend: "api", provider: "google", model: "gemini-3-flash-preview", evidence: "same" },
    ];
    const { changes } = proposeUpdate(REGISTRY, f);
    const text = formatProposal(changes);
    expect(text).toContain("code/high");
    expect(text).not.toContain("test/fast"); // noop hidden
  });
});

describe("registry store merge + persistence", () => {
  it("mergeRegistry replaces by capability/tier and keeps the rest", () => {
    const override: RegistryEntry = {
      capability: "code", tier: "high",
      byBackend: { web: { provider: "anthropic", model: "claude-fable-5" }, api: { provider: "anthropic", model: "claude-fable-5" } },
    };
    const merged = mergeRegistry(REGISTRY, [override]);
    expect(merged.find((e) => e.capability === "code" && e.tier === "high")!.byBackend.api.model).toBe("claude-fable-5");
    // unrelated entry survives
    expect(merged.find((e) => e.capability === "test" && e.tier === "fast")).toBeTruthy();
    expect(merged.length).toBe(REGISTRY.length); // replace, not append
  });

  it("saveOverrides then loadRegistry round-trips and applies", () => {
    const path = join(tmpdir(), `proj-scout-${process.pid}.json`);
    try {
      const f: Finding[] = [{ capability: "code", tier: "high", backend: "api", provider: "anthropic", model: "claude-fable-5", evidence: "x" }];
      const { updated } = proposeUpdate(REGISTRY, f);
      saveOverrides(updated, path);
      const loaded = loadRegistry(path);
      expect(loaded.find((e) => e.capability === "code" && e.tier === "high")!.byBackend.api.model).toBe("claude-fable-5");
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("loadRegistry returns the seed when no overrides file exists", () => {
    const loaded = loadRegistry(join(tmpdir(), "does-not-exist-xyz.json"));
    expect(loaded.length).toBe(REGISTRY.length);
  });
});
