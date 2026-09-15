// Offline orchestrator tests — a FAKE executor drives the whole control flow.
// No model, no network, no spend. Proves toposort, handoff threading, the
// Tester->Developer feedback loop, and the budget halt.

import { describe, it, expect, vi } from "vitest";
import { toposort, runBacklog } from "../src/orchestrator.js";
import { lockRegistryToProvider } from "../src/roles.js";
import { DEFAULT_POLICY } from "../src/router.js";
import { REGISTRY, findEntry } from "../src/registry.js";
import { TaskLimitError, type RoleExecutor, type RoutingPolicy, type Task, type Verdict } from "../src/types.js";

const t = (id: string, capability: Task["capability"], dependsOn: string[] = [], difficulty: Task["difficulty"] = "low"): Task => ({
  id, title: `${capability} ${id}`, capability, difficulty, dependsOn,
  estTokens: { input: 5_000, output: 2_000 },
});

const policy = (o: Partial<RoutingPolicy> = {}): RoutingPolicy => ({ ...DEFAULT_POLICY, backendMode: "api", ...o });
const anthropic = lockRegistryToProvider("anthropic");

// A fake executor: records call order, returns cheap results, tester passes by default.
function fakeExecutor(over: { verdicts?: Record<string, Verdict[]>; cost?: number } = {}): {
  exec: RoleExecutor;
  calls: { id: string; round: number; context: string }[];
} {
  const calls: { id: string; round: number; context: string }[] = [];
  const verdictQueues = { ...(over.verdicts ?? {}) };
  const exec: RoleExecutor = async ({ task, contextText, round }) => {
    calls.push({ id: task.id, round, context: contextText });
    let verdict: Verdict | undefined;
    if (task.capability === "test" || task.capability === "review") {
      const q = verdictQueues[task.id];
      verdict = q && q.length ? q.shift() : { passed: true, bugs: [], runtimeChecked: true };
    }
    return { finalText: `did ${task.id}`, files: [`${task.id}.txt`], cost: over.cost ?? 0.5, verdict };
  };
  return { exec, calls };
}

describe("toposort", () => {
  it("orders dependencies before dependents", () => {
    const tasks = [t("C", "test", ["B"]), t("B", "code", ["A"]), t("A", "design")];
    const order = toposort(tasks).map((x) => x.id);
    expect(order.indexOf("A")).toBeLessThan(order.indexOf("B"));
    expect(order.indexOf("B")).toBeLessThan(order.indexOf("C"));
  });
  it("throws on a cycle", () => {
    const tasks = [t("A", "code", ["B"]), t("B", "code", ["A"])];
    expect(() => toposort(tasks)).toThrow(/cycle/i);
  });
});

describe("runBacklog — happy path", () => {
  it("runs tasks in dependency order and threads handoff context", async () => {
    const tasks = [t("T-03", "test", ["T-02"]), t("T-02", "code", ["T-01"]), t("T-01", "design")];
    const { exec, calls } = fakeExecutor();
    const res = await runBacklog(tasks, { policy: policy(), execute: exec, registry: anthropic });

    expect(res.halted).toBe(false);
    expect(calls.map((c) => c.id)).toEqual(["T-01", "T-02", "T-03"]);
    // T-02 (code) should receive T-01's (design) output as context.
    expect(calls.find((c) => c.id === "T-02")!.context).toContain("T-01");
    expect(res.totalCost).toBeCloseTo(1.5, 2);
  });
});

describe("runBacklog — Tester->Developer feedback loop", () => {
  it("re-runs the code dep with a bug report, then re-tests, until pass", async () => {
    const tasks = [t("T-01", "code"), t("T-02", "test", ["T-01"])];
    // Tester fails once (1 bug), then passes on the retry.
    const { exec, calls } = fakeExecutor({
      verdicts: { "T-02": [{ passed: false, bugs: [{ severity: "high", description: "broken" }], runtimeChecked: true }, { passed: true, bugs: [], runtimeChecked: true }] },
    });
    const res = await runBacklog(tasks, { policy: policy({ maxFeedbackRounds: 3 }), execute: exec, registry: anthropic });

    const ids = calls.map((c) => c.id);
    // T-01, T-02(fail), T-01(retry), T-02(pass)
    expect(ids).toEqual(["T-01", "T-02", "T-01", "T-02"]);
    // The retry of T-01 carries the bug report.
    const retryDev = calls.filter((c) => c.id === "T-01")[1]!;
    expect(retryDev.round).toBe(1);
    expect(retryDev.context.toLowerCase()).toContain("broken");
    expect(res.halted).toBe(false);
  });

  it("stops after maxFeedbackRounds even if tester keeps failing", async () => {
    const tasks = [t("T-01", "code"), t("T-02", "test", ["T-01"])];
    const alwaysFail: Verdict = { passed: false, bugs: [{ severity: "low", description: "nope" }], runtimeChecked: true };
    const { exec, calls } = fakeExecutor({ verdicts: { "T-02": [alwaysFail, alwaysFail, alwaysFail, alwaysFail, alwaysFail] } });
    await runBacklog(tasks, { policy: policy({ maxFeedbackRounds: 2 }), execute: exec, registry: anthropic });

    // initial test + 2 rounds of (dev + test) = T-02 tested 3 times, T-01 run 3 times.
    expect(calls.filter((c) => c.id === "T-02").length).toBe(3);
    expect(calls.filter((c) => c.id === "T-01").length).toBe(3);
  });
});

describe("runBacklog — Reviewer in the loop", () => {
  it("a failed review re-runs the code with the bug report before the tester ever runs", async () => {
    const tasks = [t("C", "code"), t("R", "review", ["C"]), t("T", "test", ["R"])];
    const { exec, calls } = fakeExecutor({
      verdicts: { R: [{ passed: false, bugs: [{ severity: "high", description: "app.js references init() which is never defined" }], runtimeChecked: false }, { passed: true, bugs: [], runtimeChecked: false }] },
    });
    const res = await runBacklog(tasks, { policy: policy(), execute: exec, registry: anthropic });
    expect(calls.map((c) => c.id)).toEqual(["C", "R", "C", "R", "T"]);
    expect(calls.filter((c) => c.id === "C")[1]!.context).toContain("never defined");
    expect(res.halted).toBe(false);
  });

  it("a failed test finds the code through the review it depends on", async () => {
    const tasks = [t("C", "code"), t("R", "review", ["C"]), t("T", "test", ["R"])];
    const { exec, calls } = fakeExecutor({
      verdicts: { T: [{ passed: false, bugs: [{ severity: "high", description: "blank page" }], runtimeChecked: true }, { passed: true, bugs: [], runtimeChecked: true }] },
    });
    await runBacklog(tasks, { policy: policy(), execute: exec, registry: anthropic });
    // C, R, T(fail), C(fix), T(pass) — the fix round goes to C even though T depends only on R.
    expect(calls.map((c) => c.id)).toEqual(["C", "R", "T", "C", "T"]);
    expect(calls.filter((c) => c.id === "C")[1]!.round).toBe(1);
  });
});

describe("runBacklog — developer retries escalate one tier", () => {
  it("the fix round runs the dev on the next tier up; the judge keeps its model", async () => {
    // code/low -> mid tier; the retry must land on the high-tier model. Uses the real
    // registry: the provider-lock one maps every code tier to the same model.
    const tasks = [t("C", "code", [], "low"), t("T", "test", ["C"], "low")];
    const models: { id: string; model: string }[] = [];
    const exec: RoleExecutor = async ({ task, decision, round }) => {
      models.push({ id: task.id, model: decision.model.id });
      const verdict = task.capability === "test" ? { passed: round > 0, bugs: round > 0 ? [] : [{ severity: "high" as const, description: "x" }], runtimeChecked: true } : undefined;
      return { finalText: "", files: [], cost: 0.1, verdict };
    };
    await runBacklog(tasks, { policy: policy(), execute: exec, registry: REGISTRY });
    const mid = findEntry("code", "mid", REGISTRY).entry.byBackend.api.model;
    const high = findEntry("code", "high", REGISTRY).entry.byBackend.api.model;
    const testModel = findEntry("test", "mid", REGISTRY).entry.byBackend.api.model;
    expect(mid).not.toBe(high); // otherwise this test proves nothing
    expect(models).toEqual([
      { id: "C", model: mid },
      { id: "T", model: testModel },
      { id: "C", model: high },
      { id: "T", model: testModel },
    ]);
  });
});

describe("runBacklog — budget halt", () => {
  it("stops before running a task that would cross the cap", async () => {
    const tasks = [t("A", "code"), t("B", "code"), t("C", "code")];
    const { exec, calls } = fakeExecutor({ cost: 5 }); // each ~ real 5, but est drives the halt
    const onProgress = vi.fn();
    const res = await runBacklog(tasks, {
      policy: policy({ budgetCapUSD: 0.05 }), // below the first task's estimate -> halt pre-flight
      execute: exec,
      registry: anthropic,
      onProgress,
    });
    expect(res.halted).toBe(true);
    expect(res.haltReason).toBe("budget cap");
    expect(calls.length).toBe(0); // halted before any execution
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ type: "budget_halt" }));
  });
});

describe("mid-build review gate", () => {
  const tasks = [t("D", "design"), t("C", "code", ["D"]), t("T", "test", ["C"])];

  it("pauses before code; 'continue' runs everything (gate fires once)", async () => {
    const { exec, calls } = fakeExecutor();
    let gateCalls = 0;
    const res = await runBacklog(tasks, {
      policy: policy(), execute: exec, registry: anthropic,
      onGate: async () => { gateCalls++; return "continue"; },
    });
    expect(gateCalls).toBe(1);
    expect(calls.map((c) => c.id)).toEqual(["D", "C", "T"]);
    expect(res.halted).toBe(false);
  });

  it("'stop' halts before any code runs (design already done)", async () => {
    const { exec, calls } = fakeExecutor();
    const res = await runBacklog(tasks, {
      policy: policy(), execute: exec, registry: anthropic,
      onGate: async () => "stop",
    });
    expect(calls.map((c) => c.id)).toEqual(["D"]); // only design ran
    expect(res.halted).toBe(true);
    expect(res.haltReason).toBe("stopped at review gate");
  });

  it("gates in parallel mode too", async () => {
    const { exec, calls } = fakeExecutor();
    const res = await runBacklog(tasks, {
      policy: policy(), execute: exec, registry: anthropic, concurrency: 3,
      onGate: async () => "stop",
    });
    expect(calls.every((c) => c.id === "D")).toBe(true); // no code/test ran
    expect(res.halted).toBe(true);
  });
});

describe("lockRegistryToProvider", () => {
  it("maps every capability to the chosen provider", () => {
    const reg = lockRegistryToProvider("anthropic");
    for (const e of reg) {
      expect(e.byBackend.api.provider).toBe("anthropic");
      expect(e.byBackend.web.provider).toBe("anthropic");
    }
  });
});

describe("per-task limits", () => {
  // Executor that breaches on one task; everything else succeeds cheaply.
  const breaching = (failId: string): RoleExecutor => async ({ task }) => {
    if (task.id === failId) throw new TaskLimitError("cost", task.id, 1.25, "spent $1.25 > per-task cap $1");
    return { finalText: `did ${task.id}`, files: [], cost: 0.5, verdict: task.capability === "test" ? { passed: true, bugs: [], runtimeChecked: true } : undefined };
  };

  it("passes the policy limits to the executor", async () => {
    const seen: unknown[] = [];
    const exec: RoleExecutor = async ({ limits }) => { seen.push(limits); return { finalText: "", files: [], cost: 0 }; };
    const limits = { timeoutMs: 1234, costCapUSD: 0.5 };
    await runBacklog([t("A", "design")], { policy: policy({ taskLimits: limits }), execute: exec, registry: anthropic });
    expect(seen).toEqual([limits]);
  });

  it("sequential: bills the aborted attempt, records it as failed, halts before the next task", async () => {
    const tasks = [t("A", "design"), t("B", "code", ["A"]), t("C", "test", ["B"])];
    const events: string[] = [];
    const checkpoint = vi.fn();
    const res = await runBacklog(tasks, {
      policy: policy(), execute: breaching("B"), registry: anthropic,
      onProgress: (e) => events.push(e.type), onCheckpoint: checkpoint,
    });
    expect(res.halted).toBe(true);
    expect(res.haltReason).toBe("B aborted: spent $1.25 > per-task cap $1");
    expect(res.totalCost).toBe(1.75); // A 0.50 + the aborted B 1.25
    const b = res.outcomes.find((o) => o.taskId === "B")!;
    expect(b.error).toBeDefined();
    expect(res.outcomes.map((o) => o.taskId)).toEqual(["A", "B"]); // C never ran
    expect(events).toContain("task_failed");
    expect(checkpoint).toHaveBeenCalled();
  });

  it("parallel: the breach halts the build without rejecting; siblings finish", async () => {
    const tasks = [t("A", "design"), t("B", "design"), t("C", "design"), t("D", "code", ["A", "B", "C"])];
    const res = await runBacklog(tasks, { policy: policy(), execute: breaching("B"), registry: anthropic, concurrency: 3 });
    expect(res.halted).toBe(true);
    expect(res.haltReason).toMatch(/^B aborted/);
    expect(res.outcomes.map((o) => o.taskId).sort()).toEqual(["A", "B", "C"]); // D never launched
  });

  it("feedback loop: a breach during a dev retry stops the loop", async () => {
    const tasks = [t("B", "code"), t("C", "test", ["B"])];
    let calls = 0;
    const exec: RoleExecutor = async ({ task, round }) => {
      calls++;
      if (task.id === "B" && round === 1) throw new TaskLimitError("timeout", "B", 0.2, "ran longer than 1 min");
      return { finalText: "", files: [], cost: 0.1, verdict: task.capability === "test" ? { passed: false, bugs: [{ severity: "high", description: "x" }], runtimeChecked: true } : undefined };
    };
    const res = await runBacklog(tasks, { policy: policy(), execute: exec, registry: anthropic });
    expect(res.halted).toBe(true);
    expect(calls).toBe(3); // B, C (fail), B retry (breach) — no re-test
  });
});
