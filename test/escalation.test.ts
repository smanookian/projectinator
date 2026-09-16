// Escalation ladder past the dev-fix rounds. Rung N+1: the Designer upstream of the failing
// code rewrites the spec once, and the next dev fix sees the NEW spec. Rung N+2: the PM
// (opts.replan) splits the code task; the pieces plus a fresh judge join the backlog. Each
// rung fires at most once per judge; no design dep / no replan hook = rung skipped.

import { describe, it, expect } from "vitest";
import { runBacklog, type OrchestratorEvent } from "../src/orchestrator.js";
import { lockRegistryToProvider } from "../src/roles.js";
import { DEFAULT_POLICY } from "../src/router.js";
import type { RoleExecutor, RoutingPolicy, Task, Verdict } from "../src/types.js";

const anthropic = lockRegistryToProvider("anthropic");
const policy = (o: Partial<RoutingPolicy> = {}): RoutingPolicy => ({ ...DEFAULT_POLICY, backendMode: "api", maxFeedbackRounds: 2, ...o });
const t = (id: string, capability: Task["capability"], dependsOn: string[] = []): Task => ({
  id, title: `${capability} ${id}`, capability, difficulty: "low", dependsOn, estTokens: { input: 5_000, output: 2_000 },
});
const fail: Verdict = { passed: false, runtimeChecked: true, bugs: [{ severity: "high", description: "title missing", file: "index.html" }] };
const pass: Verdict = { passed: true, runtimeChecked: true, bugs: [] };

/** Executor: the judge fails `failTimes` times, then passes. Records every call. */
function judgeExec(failTimes: number) {
  const calls: { id: string; round: number; context: string }[] = [];
  let fails = 0;
  const exec: RoleExecutor = async ({ task, round, contextText }) => {
    calls.push({ id: task.id, round, context: contextText });
    const verdict = task.capability === "test" || task.capability === "review" ? (fails++ < failTimes ? fail : pass) : undefined;
    return { finalText: task.capability === "design" ? `SPEC v${calls.filter((c) => c.id === task.id).length}` : `did ${task.id}`, files: [], cost: 0.01, verdict };
  };
  return { exec, calls };
}

describe("escalation ladder", () => {
  const backlog = [t("D", "design"), t("C", "code", ["D"]), t("T", "test", ["C"])];

  it("rung 3: after the dev rounds fail, the Designer re-specs once and the dev fix sees the new spec", async () => {
    const { exec, calls } = judgeExec(3); // fails rounds 0,1,2 → passes after the re-spec fix
    const events: OrchestratorEvent[] = [];
    const res = await runBacklog(backlog, { policy: policy(), execute: exec, registry: anthropic, onProgress: (e) => events.push(e) });
    const seq = calls.map((c) => c.id).join(" ");
    expect(seq).toBe("D C T C T C T D C T"); // 2 fix rounds, then re-spec + one more fix + judge
    expect(events.filter((e) => e.type === "escalate").map((e) => (e as { rung: string }).rung)).toEqual(["respec"]);
    const respecCall = calls.filter((c) => c.id === "D")[1]!;
    expect(respecCall.context).toContain("title missing");
    const lastFix = calls.filter((c) => c.id === "C").at(-1)!;
    expect(lastFix.context).toContain("SPEC v2"); // the developer sees the rewritten spec
    expect(lastFix.context).toContain("title missing");
    expect(res.outcomes.at(-1)!.verdict?.passed).toBe(true);
    expect(res.halted).toBe(false);
  });

  it("rung 4: still failing → the PM splits the task; pieces + a fresh judge join the backlog; rungs never repeat", async () => {
    const { exec, calls } = judgeExec(4); // fails through the re-spec round; the new judge passes
    const events: OrchestratorEvent[] = [];
    const replanCalls: string[] = [];
    const res = await runBacklog(backlog, {
      policy: policy(), execute: exec, registry: anthropic, onProgress: (e) => events.push(e),
      replan: async ({ task, bugs, judge }) => {
        replanCalls.push(`${task.id}<-${judge.id}:${bugs.length}`);
        return [t("C1", "code", ["D"]), t("C2", "code", ["C1"]), t("R", "review", ["C2"])]; // R is dropped: judges are added by the ladder
      },
    });
    expect(replanCalls).toEqual(["C<-T:1"]);
    expect(events.filter((e) => e.type === "escalate").map((e) => (e as { rung: string }).rung)).toEqual(["respec", "replan"]);
    const added = events.filter((e) => e.type === "task_added").map((e) => (e as { task: Task }).task);
    expect(added.map((a) => a.id)).toEqual(["C1", "C2", "T-r2"]);
    expect(added[2]!.capability).toBe("test");
    expect(added[2]!.dependsOn).toEqual(["C1", "C2"]); // the new judge depends on the pieces, not the old code task
    expect(calls.map((c) => c.id).slice(-3)).toEqual(["C1", "C2", "T-r2"]);
    expect(res.tasks.map((x) => x.id)).toEqual(["D", "C", "T", "C1", "C2", "T-r2"]);
    expect(res.outcomes.at(-1)!.verdict?.passed).toBe(true);
  });

  it("no design upstream and no replan hook: the build ends after the dev rounds as before", async () => {
    const { exec, calls } = judgeExec(99);
    const events: OrchestratorEvent[] = [];
    const res = await runBacklog([t("C", "code"), t("T", "test", ["C"])], { policy: policy(), execute: exec, registry: anthropic, onProgress: (e) => events.push(e) });
    expect(calls.map((c) => c.id).join(" ")).toBe("C T C T C T");
    expect(events.some((e) => e.type === "escalate")).toBe(false);
    expect(res.outcomes.at(-1)!.verdict?.passed).toBe(false);
    expect(res.halted).toBe(false);
  });
});
