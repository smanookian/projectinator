// Offline tests for save & resume — fake executor, no spend.
// Proves: finished tasks are skipped on resume, cost is restored, checkpoints fire,
// and a halted run continues to completion when re-run with a higher cap.

import { describe, it, expect, vi } from "vitest";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBacklog } from "../src/orchestrator.js";
import { lockRegistryToProvider } from "../src/roles.js";
import { DEFAULT_POLICY } from "../src/router.js";
import { newBuildState, saveState, loadState, completedIds } from "../src/build-state.js";
import type { RoleExecutor, RoutingPolicy, Task, TaskOutcome } from "../src/types.js";

const t = (id: string, capability: Task["capability"], dependsOn: string[] = []): Task => ({
  id, title: `${capability} ${id}`, capability, difficulty: "low", dependsOn,
  estTokens: { input: 5_000, output: 2_000 },
});
const policy = (o: Partial<RoutingPolicy> = {}): RoutingPolicy => ({ ...DEFAULT_POLICY, backendMode: "api", ...o });
const anthropic = lockRegistryToProvider("anthropic");

function counter(): { exec: RoleExecutor; ran: string[] } {
  const ran: string[] = [];
  const exec: RoleExecutor = async ({ task }) => {
    ran.push(task.id);
    return { finalText: `did ${task.id}`, files: [`${task.id}.txt`], cost: 0.5, verdict: task.capability === "test" ? { passed: true, bugs: [] } : undefined };
  };
  return { exec, ran };
}

describe("resume via seedOutcomes", () => {
  it("skips finished tasks, restores cost, runs only the remainder", async () => {
    const tasks = [t("A", "design"), t("B", "code", ["A"]), t("C", "test", ["B"])];
    // Pretend A + B already ran in a prior session.
    const seed: TaskOutcome[] = [
      { taskId: "A", capability: "design", provider: "anthropic", modelId: "claude-opus-4-8", finalText: "spec", files: ["A.txt"], cost: 0.5, round: 0 },
      { taskId: "B", capability: "code", provider: "anthropic", modelId: "claude-opus-4-8", finalText: "code", files: ["B.txt"], cost: 0.5, round: 0 },
    ];
    const { exec, ran } = counter();
    const res = await runBacklog(tasks, { policy: policy(), execute: exec, registry: anthropic, seedOutcomes: seed });

    expect(ran).toEqual(["C"]); // only the unfinished task ran
    expect(res.totalCost).toBeCloseTo(1.5, 2); // 0.5 + 0.5 restored + 0.5 for C
  });

  it("a skipped dependency still provides handoff context to its dependents", async () => {
    const tasks = [t("A", "design"), t("B", "code", ["A"])];
    const seed: TaskOutcome[] = [
      { taskId: "A", capability: "design", provider: "anthropic", modelId: "claude-opus-4-8", finalText: "THE SPEC", files: ["A.txt"], cost: 0.5, round: 0 },
    ];
    const contexts: Record<string, string> = {};
    const exec: RoleExecutor = async ({ task, contextText }) => {
      contexts[task.id] = contextText;
      return { finalText: "x", files: [], cost: 0.5 };
    };
    await runBacklog(tasks, { policy: policy(), execute: exec, registry: anthropic, seedOutcomes: seed });
    expect(contexts["B"]).toContain("THE SPEC");
  });

  it("fires a checkpoint after each executed task", async () => {
    const tasks = [t("A", "design"), t("B", "code", ["A"])];
    const { exec } = counter();
    const onCheckpoint = vi.fn();
    await runBacklog(tasks, { policy: policy(), execute: exec, registry: anthropic, onCheckpoint });
    expect(onCheckpoint).toHaveBeenCalledTimes(2);
  });
});

describe("halt then resume to completion", () => {
  it("a budget halt leaves state that a higher cap can finish", async () => {
    const tasks = [t("A", "code"), t("B", "code", ["A"]), t("C", "code", ["B"])];
    const path = join(tmpdir(), `proj-resume-${process.pid}.json`);
    try {
      const state = newBuildState("test", tasks);
      const { exec: exec1, ran: ran1 } = counter();
      // Cap allows ~2 tasks (each est ~0.15 for code/low on opus). Set cap so it halts partway.
      const res1 = await runBacklog(tasks, {
        policy: policy({ budgetCapUSD: 0.3 }),
        execute: exec1, registry: anthropic,
        onCheckpoint: (outcomes, total) => { state.outcomes = outcomes; state.totalCost = total; saveState(state, path); },
      });
      expect(res1.halted).toBe(true);
      expect(existsSync(path)).toBe(true);
      const saved = loadState(path)!;
      expect(saved.outcomes.length).toBeGreaterThan(0);
      expect(saved.outcomes.length).toBeLessThan(3); // didn't finish

      // Resume with a big cap -> finishes the rest, doesn't re-run done tasks.
      const { exec: exec2, ran: ran2 } = counter();
      const res2 = await runBacklog(tasks, {
        policy: policy({ budgetCapUSD: 100 }),
        execute: exec2, registry: anthropic,
        seedOutcomes: saved.outcomes,
      });
      const doneAfter = new Set(res2.outcomes.map((o) => o.taskId));
      expect(doneAfter).toEqual(new Set(["A", "B", "C"]));
      // exec2 only ran the tasks not already done.
      expect(ran2).not.toContain(saved.outcomes[0]!.taskId);
      expect(ran1.length + ran2.length).toBe(3);
    } finally {
      rmSync(path, { force: true });
    }
  });
});

describe("build-state helpers", () => {
  it("completedIds reflects recorded outcomes", () => {
    const state = newBuildState("x", []);
    state.outcomes = [{ taskId: "A", capability: "code", provider: "anthropic", modelId: "m", finalText: "", files: [], cost: 1, round: 0 }];
    expect(completedIds(state)).toEqual(new Set(["A"]));
  });
  it("saveState/loadState round-trips", () => {
    const path = join(tmpdir(), `proj-state-${process.pid}.json`);
    try {
      const s = newBuildState("id1", [t("A", "code")]);
      s.totalCost = 2.5;
      saveState(s, path);
      expect(loadState(path)!.totalCost).toBe(2.5);
    } finally {
      rmSync(path, { force: true });
    }
  });
});
