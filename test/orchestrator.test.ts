// Offline orchestrator tests — a FAKE executor drives the whole control flow.
// No model, no network, no spend. Proves toposort, handoff threading, the
// Tester->Developer feedback loop, and the budget halt.

import { describe, it, expect, vi } from "vitest";
import { toposort, runBacklog } from "../src/orchestrator.js";
import { lockRegistryToProvider } from "../src/roles.js";
import { DEFAULT_POLICY } from "../src/router.js";
import type { RoleExecutor, RoutingPolicy, Task, Verdict } from "../src/types.js";

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
    if (task.capability === "test") {
      const q = verdictQueues[task.id];
      verdict = q && q.length ? q.shift() : { passed: true, bugs: [] };
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
      verdicts: { "T-02": [{ passed: false, bugs: [{ severity: "high", description: "broken" }] }, { passed: true, bugs: [] }] },
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
    const alwaysFail: Verdict = { passed: false, bugs: [{ severity: "low", description: "nope" }] };
    const { exec, calls } = fakeExecutor({ verdicts: { "T-02": [alwaysFail, alwaysFail, alwaysFail, alwaysFail, alwaysFail] } });
    await runBacklog(tasks, { policy: policy({ maxFeedbackRounds: 2 }), execute: exec, registry: anthropic });

    // initial test + 2 rounds of (dev + test) = T-02 tested 3 times, T-01 run 3 times.
    expect(calls.filter((c) => c.id === "T-02").length).toBe(3);
    expect(calls.filter((c) => c.id === "T-01").length).toBe(3);
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
