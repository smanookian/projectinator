// Mid-build steering: pause stops new launches (running work finishes), inject adds tasks
// that get scheduled with their deps, remove drops an unstarted task, stop halts resumably.
// Deterministic: the executor blocks on gates we release.

import { describe, it, expect } from "vitest";
import { runBacklog, createBuildControl, type OrchestratorEvent } from "../src/orchestrator.js";
import { lockRegistryToProvider } from "../src/roles.js";
import { DEFAULT_POLICY } from "../src/router.js";
import type { RoleExecutor, RoutingPolicy, Task } from "../src/types.js";

const anthropic = lockRegistryToProvider("anthropic");
const policy = (o: Partial<RoutingPolicy> = {}): RoutingPolicy => ({ ...DEFAULT_POLICY, backendMode: "api", ...o });
const t = (id: string, capability: Task["capability"], dependsOn: string[] = []): Task => ({
  id, title: `${capability} ${id}`, capability, difficulty: "low", dependsOn, estTokens: { input: 5_000, output: 2_000 },
});
const tick = () => new Promise<void>((r) => setImmediate(r));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

/** Executor whose tasks block until released, recording the order they started. */
function gated() {
  const started: string[] = [];
  const gates = new Map<string, () => void>();
  const exec: RoleExecutor = async ({ task }) => {
    started.push(task.id);
    const { promise, resolve } = Promise.withResolvers<void>();
    gates.set(task.id, resolve);
    await promise;
    // Judges must return a verdict: a verdict-less test/review is a failed outcome that halts
    // the build, so a fixture without one would stop the schedule this test is exercising.
    const verdict = task.capability === "test" || task.capability === "review"
      ? { passed: true, bugs: [], runtimeChecked: true }
      : undefined;
    return { finalText: `did ${task.id}`, files: [], cost: 0.1, verdict };
  };
  const release = async (id: string) => { gates.get(id)?.(); gates.delete(id); await settle(); };
  return { exec, started, release, waiting: () => [...gates.keys()] };
}

describe("steering", () => {
  it("pause: running work finishes, nothing new starts; resume continues", async () => {
    const g = gated();
    const control = createBuildControl();
    const events: string[] = [];
    const run = runBacklog([t("A", "design"), t("B", "design"), t("C", "design")], {
      policy: policy(), execute: g.exec, registry: anthropic, concurrency: 1, control, onProgress: (e: OrchestratorEvent) => events.push(e.type),
    });
    await settle();
    expect(g.started).toEqual(["A"]);
    control.pause();
    await g.release("A");
    expect(g.started).toEqual(["A"]); // B did not start
    expect(events).toContain("paused");
    control.resume();
    await settle();
    expect(g.started).toEqual(["A", "B"]);
    expect(events).toContain("resumed");
    await g.release("B"); await g.release("C");
    const res = await run;
    expect(res.halted).toBe(false);
    expect(res.outcomes.map((o) => o.taskId)).toEqual(["A", "B", "C"]);
  });

  it("inject: new tasks (with deps on existing and on each other) are scheduled and returned", async () => {
    const g = gated();
    const control = createBuildControl();
    const added: string[] = [];
    const run = runBacklog([t("A", "code")], {
      policy: policy(), execute: g.exec, registry: anthropic, concurrency: 2, control,
      onProgress: (e) => { if (e.type === "task_added") added.push(e.task.id); },
    });
    await settle();
    control.inject([t("R", "review", ["A"]), t("T", "test", ["R", "nope"])]); // "nope" is dropped
    await g.release("A");
    expect(added).toEqual(["R", "T"]);
    expect(g.started).toEqual(["A", "R"]); // T waits for R
    await g.release("R");
    expect(g.started).toEqual(["A", "R", "T"]);
    await g.release("T");
    const res = await run;
    expect(res.tasks.map((x) => x.id)).toEqual(["A", "R", "T"]);
    expect(res.tasks.find((x) => x.id === "T")!.dependsOn).toEqual(["R"]);
    expect(res.outcomes.map((o) => o.taskId)).toEqual(["A", "R", "T"]);
  });

  it("remove: an unstarted task is dropped and its dependents no longer wait for it", async () => {
    const g = gated();
    const control = createBuildControl();
    const removed: string[] = [];
    const run = runBacklog([t("A", "design"), t("B", "design", ["A"]), t("C", "test", ["A", "B"])], {
      policy: policy(), execute: g.exec, registry: anthropic, concurrency: 1, control,
      onProgress: (e) => { if (e.type === "task_removed") removed.push(e.taskId); },
    });
    await settle();
    control.remove("B");
    control.remove("A"); // running → ignored
    await g.release("A");
    expect(removed).toEqual(["B"]);
    expect(g.started).toEqual(["A", "C"]); // C ran without waiting for B
    await g.release("C");
    const res = await run;
    expect(res.tasks.map((x) => x.id)).toEqual(["A", "C"]);
    expect(res.tasks.find((x) => x.id === "C")!.dependsOn).toEqual(["A"]);
  });

  it("stop: finishes what is running, halts resumably, and later tasks are untouched", async () => {
    const g = gated();
    const control = createBuildControl();
    const run = runBacklog([t("A", "design"), t("B", "design")], { policy: policy(), execute: g.exec, registry: anthropic, concurrency: 1, control });
    await settle();
    control.stop();
    await g.release("A");
    const res = await run;
    expect(res.halted).toBe(true);
    expect(res.haltReason).toBe("stopped by user");
    expect(res.outcomes.map((o) => o.taskId)).toEqual(["A"]);
    expect(g.started).toEqual(["A"]);
  });
});
