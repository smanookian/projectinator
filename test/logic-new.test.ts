// Regression tests for pure logic added in the analytics/planning work:
// burndown, retro, and stack instructions.

import { describe, it, expect } from "vitest";
import { computeBurndown } from "../src/burndown.js";
import { computeRetro } from "../src/retro.js";
import { stackInstruction } from "../src/stack.js";
import { enrichBrief } from "../src/intake.js";
import { deploySlug } from "../src/tui/deploy.js";
import type { BuildState } from "../src/build-state.js";
import type { Task, TaskOutcome } from "../src/types.js";

function task(id: string, cap: Task["capability"], epic: string, diff: Task["difficulty"] = "low"): Task {
  return { id, title: `${id} title`, capability: cap, difficulty: diff, dependsOn: [], epic, estTokens: { input: 1000, output: 500, cachedInputFraction: 0.5 } };
}
function outcome(taskId: string, cap: TaskOutcome["capability"], cost: number, round = 0, verdict?: TaskOutcome["verdict"]): TaskOutcome {
  return { taskId, capability: cap, provider: "anthropic", modelId: "claude-opus-4-8", round, cost, finalText: "", files: [], verdict };
}

function state(tasks: Task[], outcomes: TaskOutcome[]): BuildState {
  return { id: "t", idea: "an app", tasks, outcomes, totalCost: outcomes.reduce((a, o) => a + o.cost, 0), status: "complete" };
}

describe("computeBurndown", () => {
  it("burns down remaining tasks and accumulates cost in completion order", () => {
    const tasks = [task("A", "design", "E1"), task("B", "code", "E1"), task("C", "test", "E2")];
    const b = computeBurndown(state(tasks, [outcome("A", "design", 0.1), outcome("B", "code", 0.2), outcome("C", "test", 0.05)]));
    expect(b.taskCount).toBe(3);
    expect(b.steps.map((s) => s.remaining)).toEqual([2, 1, 0]);
    expect(b.steps.map((s) => s.cumCost)).toEqual([0.1, 0.3, 0.35]);
    expect(b.totalCost).toBe(0.35);
  });

  it("a retry adds a step + cost without burning down a task", () => {
    const tasks = [task("A", "code", "E1"), task("B", "test", "E1")];
    // A, B, then B fails → A re-run (round 1)
    const b = computeBurndown(state(tasks, [outcome("A", "code", 0.2), outcome("B", "test", 0.05), outcome("A", "code", 0.2, 1)]));
    expect(b.steps.map((s) => s.remaining)).toEqual([1, 0, 0]);
    expect(b.steps[2]!.retry).toBe(true);
    expect(b.steps[2]!.cumCost).toBeCloseTo(0.45);
  });
});

describe("computeRetro", () => {
  const tasks = [task("A", "design", "Foundation"), task("B", "code", "Foundation"), task("C", "test", "QA")];
  it("counts tests, groups cost by epic + model, and finds priciest", () => {
    const r = computeRetro(state(tasks, [
      outcome("A", "design", 0.10),
      outcome("B", "code", 0.30),
      outcome("C", "test", 0.05, 0, { passed: true, bugs: [] }),
    ]));
    expect(r.tests).toEqual({ passed: 1, failed: 0 });
    expect(r.byEpic.find((e) => e.epic === "Foundation")!.cost).toBeCloseTo(0.40);
    expect(r.byModel[0]!.model).toBe("claude-opus-4-8");
    expect(r.topCost[0]!.taskId).toBe("B");
    expect(r.estCost).toBeGreaterThan(0); // baseline prediction computed
  });

  it("surfaces tester-flagged bugs and a failed verdict", () => {
    const r = computeRetro(state(tasks, [
      outcome("C", "test", 0.05, 0, { passed: false, bugs: [{ severity: "high", description: "blank page" }] }),
    ]));
    expect(r.tests.failed).toBe(1);
    expect(r.bugs).toHaveLength(1);
    expect(r.bugs[0]!.severity).toBe("high");
  });
});

describe("stackInstruction", () => {
  it("returns empty for AI-decide (lets the PM choose)", () => {
    expect(stackInstruction({ platform: "web", framework: "ai" })).toBe("");
  });
  it("names the framework for vanilla + react (no build step)", () => {
    expect(stackInstruction({ platform: "web", framework: "vanilla" })).toMatch(/vanilla/i);
    const react = stackInstruction({ platform: "web", framework: "react" });
    expect(react).toMatch(/react/i);
    expect(react).toMatch(/no build|CDN/i);
  });
  it("falls back to web for non-web platforms", () => {
    expect(stackInstruction({ platform: "mobile", framework: "ai" })).toMatch(/web app/i);
  });
});

describe("enrichBrief", () => {
  it("returns the idea unchanged when there are no answers", () => {
    expect(enrichBrief("a todo app", [])).toBe("a todo app");
    expect(enrichBrief("a todo app", [{ question: "Q?", answer: "" }])).toBe("a todo app");
  });
  it("appends non-empty clarifications once", () => {
    const out = enrichBrief("a landing page", [
      { question: "What business?", answer: "Coffee shop" },
      { question: "Sections?", answer: "Hero, Menu" },
      { question: "Skipped?", answer: "  " },
    ]);
    expect(out).toContain("a landing page");
    expect(out).toContain("Clarifications from the requester");
    expect(out).toContain("What business? Coffee shop");
    expect(out).not.toContain("Skipped");
    // idempotent shape: only one clarifications block
    expect(out.match(/Clarifications from the requester/g)).toHaveLength(1);
  });
});

describe("deploySlug", () => {
  it("sanitises names to a deploy-safe slug", () => {
    expect(deploySlug("A Todo List web app!!")).toBe("a-todo-list-web-app");
    expect(deploySlug("   ")).toBe("projectinator-app");
    expect(deploySlug("Café ☕ Site")).toBe("caf-site");
  });
});
