// Offline tests for the research extractor's pure parts — no model, no spend.

import { describe, it, expect } from "vitest";
import { Value } from "typebox/value";
import { validateFindings, buildFindingsTool } from "../src/research.js";
import type { Finding } from "../src/scout.js";

const good: Finding[] = [
  { capability: "code", tier: "high", backend: "api", provider: "anthropic", model: "claude-opus-4-8", evidence: "88.6% SWE-bench" },
  { capability: "test", tier: "fast", backend: "api", provider: "google", model: "gemini-3-flash-preview", evidence: "cheap" },
];

describe("validateFindings", () => {
  it("passes findings whose models exist with matching providers", () => {
    const { ok, issues } = validateFindings(good);
    expect(ok).toBe(true);
    expect(issues).toHaveLength(0);
  });

  it("flags a model not in models.ts", () => {
    const { ok, issues } = validateFindings([
      { capability: "code", tier: "high", backend: "api", provider: "anthropic", model: "claude-ghost-9", evidence: "x" },
    ]);
    expect(ok).toBe(false);
    expect(issues[0]!.problem).toContain("not in models.ts");
  });

  it("flags a provider that disagrees with models.ts", () => {
    const { ok, issues } = validateFindings([
      { capability: "code", tier: "high", backend: "api", provider: "openai", model: "claude-opus-4-8", evidence: "x" },
    ]);
    expect(ok).toBe(false);
    expect(issues[0]!.problem).toContain("provider mismatch");
  });
});

describe("submit_findings schema", () => {
  it("accepts a well-formed findings payload", () => {
    const { tool } = buildFindingsTool();
    expect(Value.Check(tool.parameters, { findings: good })).toBe(true);
  });
  it("rejects a bad capability", () => {
    const { tool } = buildFindingsTool();
    const bad = { findings: [{ capability: "marketing", tier: "high", backend: "api", provider: "anthropic", model: "x", evidence: "y" }] };
    expect(Value.Check(tool.parameters, bad)).toBe(false);
  });
});
