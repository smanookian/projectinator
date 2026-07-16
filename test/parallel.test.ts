// Offline tests for parallel execution — a fake executor tracks how many tasks run
// at once. No model, no spend.

import { describe, it, expect } from "vitest";
import { runBacklog } from "../src/orchestrator.js";
import { lockRegistryToProvider } from "../src/roles.js";
import { DEFAULT_POLICY } from "../src/router.js";
import type { RoleExecutor, RoutingPolicy, Task } from "../src/types.js";

const t = (id: string, capability: Task["capability"], dependsOn: string[] = []): Task => ({
  id, title: `${capability} ${id}`, capability, difficulty: "low", dependsOn,
  estTokens: { input: 5_000, output: 2_000 },
});
const policy = (o: Partial<RoutingPolicy> = {}): RoutingPolicy => ({ ...DEFAULT_POLICY, backendMode: "api", ...o });
const anthropic = lockRegistryToProvider("anthropic");

const tick = () => new Promise<void>((r) => setImmediate(r));

// Tracks max concurrent executions and which pairs overlapped.
function tracker(over: { passing?: boolean } = {}): {
  exec: RoleExecutor;
  maxActive: () => number;
  activeAt: Map<string, Set<string>>;
} {
  let active = 0;
  let max = 0;
  const live = new Set<string>();
  const activeAt = new Map<string, Set<string>>();
  const exec: RoleExecutor = async ({ task }) => {
    active++;
    max = Math.max(max, active);
    live.add(task.id);
    activeAt.set(task.id, new Set(live)); // who was running when this one was
    await tick();
    await tick();
    active--;
    live.delete(task.id);
    return { finalText: `did ${task.id}`, files: [], cost: 0.5, verdict: task.capability === "test" ? { passed: over.passing ?? true, bugs: [] } : undefined };
  };
  return { exec, maxActive: () => max, activeAt };
}

describe("parallel: independent tasks overlap", () => {
  it("runs 3 independent tasks at once with concurrency 3", async () => {
    const tasks = [t("A", "design"), t("B", "design"), t("C", "design")];
    const tr = tracker();
    const res = await runBacklog(tasks, { policy: policy(), execute: tr.exec, registry: anthropic, concurrency: 3 });
    expect(res.halted).toBe(false);
    expect(tr.maxActive()).toBe(3);
    expect(res.outcomes.map((o) => o.taskId).sort()).toEqual(["A", "B", "C"]);
  });

  it("respects the concurrency cap", async () => {
    const tasks = [t("A", "design"), t("B", "design"), t("C", "design"), t("D", "design")];
    const tr = tracker();
    await runBacklog(tasks, { policy: policy(), execute: tr.exec, registry: anthropic, concurrency: 2 });
    expect(tr.maxActive()).toBe(2);
  });
});

describe("parallel: code tasks serialize (shared workspace)", () => {
  it("never runs two code tasks at once, even with high concurrency", async () => {
    const tasks = [t("A", "code"), t("B", "code"), t("C", "code")];
    const tr = tracker();
    const res = await runBacklog(tasks, { policy: policy(), execute: tr.exec, registry: anthropic, concurrency: 3 });
    expect(res.halted).toBe(false);
    expect(tr.maxActive()).toBe(1); // code writes serialize
    expect(res.outcomes.map((o) => o.taskId).sort()).toEqual(["A", "B", "C"]);
  });
  it("code serializes but design still parallelizes alongside", async () => {
    const tasks = [t("D1", "design"), t("D2", "design"), t("C1", "code"), t("C2", "code")];
    const tr = tracker();
    await runBacklog(tasks, { policy: policy(), execute: tr.exec, registry: anthropic, concurrency: 4 });
    // the two designs overlap (>=2 active at some point), but never two code together
    expect(tr.maxActive()).toBeGreaterThanOrEqual(2);
    const codeOverlap = [...tr.activeAt.get("C1")!].includes("C2") || [...tr.activeAt.get("C2")!].includes("C1");
    expect(codeOverlap).toBe(false);
  });
});

describe("parallel: dependencies never overlap", () => {
  it("a chain runs strictly one-at-a-time even with high concurrency", async () => {
    const tasks = [t("A", "design"), t("B", "code", ["A"]), t("C", "test", ["B"])];
    const tr = tracker();
    await runBacklog(tasks, { policy: policy(), execute: tr.exec, registry: anthropic, concurrency: 5 });
    expect(tr.maxActive()).toBe(1); // full chain, no overlap possible
    // B never ran while A was live, C never while B was live
    expect(tr.activeAt.get("B")!.has("A")).toBe(false);
    expect(tr.activeAt.get("C")!.has("B")).toBe(false);
  });

  it("fan-out then join: two branches parallel, join waits for both", async () => {
    const tasks = [
      t("DA", "design"), t("DB", "design"),
      t("CA", "code", ["DA"]), t("CB", "code", ["DB"]),
      t("TJ", "test", ["CA", "CB"]),
    ];
    const tr = tracker();
    await runBacklog(tasks, { policy: policy(), execute: tr.exec, registry: anthropic, concurrency: 4 });
    expect(tr.maxActive()).toBe(2); // DA+DB (then CA+CB) run in pairs
    // The join saw neither code task still running.
    expect(tr.activeAt.get("TJ")!.has("CA")).toBe(false);
    expect(tr.activeAt.get("TJ")!.has("CB")).toBe(false);
  });
});

describe("parallel: budget + resume still hold", () => {
  it("halts when the cap would be crossed and nothing is in flight", async () => {
    const tasks = [t("A", "code"), t("B", "code"), t("C", "code")];
    const tr = tracker();
    const res = await runBacklog(tasks, { policy: policy({ budgetCapUSD: 0.05 }), execute: tr.exec, registry: anthropic, concurrency: 3 });
    expect(res.halted).toBe(true);
    expect(res.haltReason).toBe("budget cap");
  });

  it("skips seeded (done) tasks under concurrency", async () => {
    const tasks = [t("A", "design"), t("B", "design"), t("C", "code", ["A", "B"])];
    const tr = tracker();
    const seed = [
      { taskId: "A", capability: "design" as const, provider: "anthropic" as const, modelId: "claude-opus-4-8", finalText: "a", files: [], cost: 0.5, round: 0 },
    ];
    const res = await runBacklog(tasks, { policy: policy(), execute: tr.exec, registry: anthropic, concurrency: 3, seedOutcomes: seed });
    // A skipped; only B and C run.
    const ran = res.outcomes.filter((o) => o.finalText.startsWith("did")).map((o) => o.taskId);
    expect(ran).not.toContain("A");
    expect(ran.sort()).toEqual(["B", "C"]);
  });
});
