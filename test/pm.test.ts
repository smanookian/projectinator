// Offline tests for the PM decomposer's pure logic — no model, no spend.
// Covers: token buckets, backlog normalization (dedupe + dangling deps),
// flattening to routable tasks, and the typebox schema accepting a valid backlog.

import { describe, it, expect } from "vitest";
import { Value } from "typebox/value";
import { estimateTokens } from "../src/estimate.js";
import { normalizeBacklog, flattenBacklog, buildBacklogTool, extractBacklogFromText, type Backlog } from "../src/pm.js";
import { route, DEFAULT_POLICY } from "../src/router.js";

describe("estimateTokens buckets", () => {
  it("returns positive input/output for every capability+difficulty", () => {
    for (const cap of ["plan", "design", "code", "test", "ops"] as const) {
      for (const diff of ["trivial", "low", "medium", "high"] as const) {
        const e = estimateTokens(cap, diff);
        expect(e.input).toBeGreaterThan(0);
        expect(e.output).toBeGreaterThan(0);
      }
    }
  });
  it("harder tasks cost more tokens than trivial ones", () => {
    expect(estimateTokens("code", "high").input).toBeGreaterThan(estimateTokens("code", "trivial").input);
  });
  it("applies a cached-input fraction (Pi caches heavily)", () => {
    expect(estimateTokens("code", "medium").cachedInputFraction).toBeGreaterThan(0);
  });
});

const sample: Backlog = {
  tasks: [
    { id: "T-01", title: "design", capability: "design", difficulty: "high", dependsOn: [], epic: "E-1", story: "S-1" },
    { id: "T-02", title: "code", capability: "code", difficulty: "high", dependsOn: ["T-01"] },
    { id: "T-02", title: "dup", capability: "code", difficulty: "low", dependsOn: [] }, // duplicate id
    { id: "T-03", title: "test", capability: "test", difficulty: "trivial", dependsOn: ["T-99"] }, // dangling dep
    { id: "T-04", title: "no deps field", capability: "code", difficulty: "low" }, // dependsOn omitted entirely
  ],
};

describe("normalizeBacklog", () => {
  it("drops duplicate task ids and dangling dependsOn", () => {
    const { backlog, diagnostics } = normalizeBacklog(sample);
    const tasks = backlog.tasks;
    expect(tasks.map((t) => t.id)).toEqual(["T-01", "T-02", "T-03", "T-04"]); // dup removed
    expect(tasks.find((t) => t.id === "T-03")!.dependsOn).toEqual([]); // dangling stripped
    expect(diagnostics.some((d) => d.includes("duplicate"))).toBe(true);
    expect(diagnostics.some((d) => d.includes("dangling"))).toBe(true);
  });
  it("keeps valid dependencies and tolerates a missing dependsOn", () => {
    const { backlog } = normalizeBacklog(sample);
    expect(backlog.tasks.find((t) => t.id === "T-02")!.dependsOn).toEqual(["T-01"]);
    expect(backlog.tasks.find((t) => t.id === "T-04")!.dependsOn).toEqual([]);
  });
});

describe("flattenBacklog", () => {
  it("produces routable tasks with token estimates + epic/story refs", () => {
    const { backlog } = normalizeBacklog(sample);
    const tasks = flattenBacklog(backlog);
    expect(tasks).toHaveLength(4);
    const design = tasks.find((t) => t.id === "T-01")!;
    expect(design.epic).toBe("E-1");
    expect(design.story).toBe("S-1");
    expect(design.estTokens.input).toBeGreaterThan(0);
  });
  it("flattened tasks route cleanly through the router", () => {
    const tasks = flattenBacklog(normalizeBacklog(sample).backlog);
    for (const task of tasks) {
      const d = route(task, { policy: { ...DEFAULT_POLICY, backendMode: "api" } });
      expect(d.model.id).toBeTruthy();
      expect(d.cost).toBeGreaterThan(0);
    }
  });
});

describe("submit_backlog typebox schema", () => {
  it("accepts a well-formed backlog", () => {
    const { tool } = buildBacklogTool();
    expect(Value.Check(tool.parameters, sample)).toBe(true);
  });
  it("accepts a minimal task with no dependsOn/epic/story", () => {
    const { tool } = buildBacklogTool();
    const minimal = { tasks: [{ id: "T", title: "t", capability: "code", difficulty: "low" }] };
    expect(Value.Check(tool.parameters, minimal)).toBe(true);
  });
  it("accepts extra fields and odd capability strings (validated/coerced in code, not at the gate)", () => {
    const { tool } = buildBacklogTool();
    const loose = { tasks: [{ id: "T", title: "t", capability: "banana", difficulty: "spicy", priority: 1 }] };
    expect(Value.Check(tool.parameters, loose)).toBe(true); // schema is permissive
    const flat = flattenBacklog(loose as unknown as Backlog);
    expect(flat[0]!.capability).toBe("code"); // coerced
    expect(flat[0]!.difficulty).toBe("medium"); // coerced
  });
});

describe("extractBacklogFromText (fallback)", () => {
  it("parses a fenced JSON tasks object", () => {
    const text = 'Sure! ```json\n{"tasks":[{"id":"T-1","title":"do it","capability":"code","difficulty":"low"}]}\n``` done';
    const b = extractBacklogFromText(text);
    expect(b?.tasks).toHaveLength(1);
  });
  it("parses a bare array", () => {
    const b = extractBacklogFromText('[{"id":"T-1","title":"x","capability":"code","difficulty":"low"}]');
    expect(b?.tasks).toHaveLength(1);
  });
  it("returns undefined on prose with no JSON", () => {
    expect(extractBacklogFromText("I'll add the avatar to the top right.")).toBeUndefined();
  });
});
