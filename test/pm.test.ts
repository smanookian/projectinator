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
    for (const cap of ["plan", "design", "code", "review", "test", "ops"] as const) {
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

// Reviews read the code, so their cost grows with the project: on a measured build they were
// 22% of spend and found no bugs. The policy is enforced here rather than trusted to the PM
// prompt, and dropping a review must not orphan the test that waited on it.
const reviewed: Backlog = {
  tasks: [
    { id: "C1", title: "easy code", capability: "code", difficulty: "low", dependsOn: [] },
    { id: "R1", title: "review easy", capability: "review", difficulty: "low", dependsOn: ["C1"] },
    { id: "C2", title: "hard code", capability: "code", difficulty: "high", dependsOn: [] },
    { id: "R2", title: "review hard", capability: "review", difficulty: "low", dependsOn: ["C2"] },
    { id: "T1", title: "test", capability: "test", difficulty: "low", dependsOn: ["R1", "R2"] },
  ],
};

describe("normalizeBacklog — review policy", () => {
  it('"high" keeps the review of hard code and drops the rest', () => {
    const { backlog, diagnostics } = normalizeBacklog(reviewed, "high");
    expect(backlog.tasks.map((t) => t.id)).toEqual(["C1", "C2", "R2", "T1"]);
    expect(diagnostics.some((d) => d.includes("review policy"))).toBe(true);
  });

  it("the test inherits the dropped review's code dependency, so it still waits for the code", () => {
    const { backlog } = normalizeBacklog(reviewed, "high");
    // R1 is gone: T1 must now depend on C1 directly, and keep the surviving R2.
    expect(backlog.tasks.find((t) => t.id === "T1")!.dependsOn!.sort()).toEqual(["C1", "R2"]);
  });

  it('"off" drops every review and rewires the test onto both code tasks', () => {
    const { backlog } = normalizeBacklog(reviewed, "off");
    expect(backlog.tasks.map((t) => t.id)).toEqual(["C1", "C2", "T1"]);
    expect(backlog.tasks.find((t) => t.id === "T1")!.dependsOn!.sort()).toEqual(["C1", "C2"]);
  });

  it('"all" is untouched', () => {
    const { backlog } = normalizeBacklog(reviewed, "all");
    expect(backlog.tasks.map((t) => t.id)).toEqual(["C1", "R1", "C2", "R2", "T1"]);
  });

  it("keys on the reviewed code's difficulty, not the review task's own", () => {
    // Reviews are cheap/low by construction; reading their own difficulty would drop all of them.
    const { backlog } = normalizeBacklog(reviewed, "high");
    expect(backlog.tasks.some((t) => t.id === "R2"), "the hard task's review was dropped").toBe(true);
  });
});

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
  it("review tasks are kept (not coerced away) and route to the cheap tier at any difficulty", () => {
    const tasks = flattenBacklog({ tasks: [{ id: "R", title: "review", capability: "REVIEW", difficulty: "high" }] });
    expect(tasks[0]!.capability).toBe("review");
    const d = route(tasks[0]!, { policy: { ...DEFAULT_POLICY, backendMode: "api" } });
    expect(d.tier).toBe("fast");
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
