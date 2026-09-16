// Sprint metrics from build-state: each run is a slice of the append-only outcomes.
// Done = last attempt of a planned task succeeded; retries = extra attempts; velocity =
// average done per ended sprint. Old states (no `sprints`) count as one sprint.

import { describe, it, expect } from "vitest";
import { computeSprints } from "../src/sprints.js";
import type { BuildState } from "../src/build-state.js";
import type { Task, TaskOutcome } from "../src/types.js";

const t = (id: string): Task => ({ id, title: id, capability: "code", difficulty: "low", dependsOn: [], estTokens: { input: 1, output: 1 } });
const o = (taskId: string, cost: number, error?: string): TaskOutcome => ({ taskId, capability: "code", provider: "anthropic", modelId: "m", round: 0, finalText: "", files: [], cost, error });

describe("sprints", () => {
  it("splits outcomes per sprint and reports done/retries/cost/velocity", () => {
    const state: BuildState = {
      id: "p", tasks: [t("A"), t("B"), t("C")], totalCost: 0.5, status: "running",
      outcomes: [o("A", 0.1), o("B", 0.1, "timeout"), o("B", 0.1), o("B", 0.05), /* sprint 2 → */ o("C", 0.15)],
      sprints: [
        { n: 1, startedAt: 1000, endedAt: 61_000, taskIds: ["A", "B", "C"], outcomeStart: 0, outcomeEnd: 4, status: "halted" },
        { n: 2, startedAt: 70_000, taskIds: ["C"], outcomeStart: 4, status: "running" },
      ],
    };
    const r = computeSprints(state);
    expect(r.sprints.map((s) => [s.n, s.planned, s.done, s.retries, s.cost, s.durationMs])).toEqual([
      [1, 3, 2, 2, 0.35, 60_000], // A done; B failed once then done twice (2 retries); C untouched
      [2, 1, 1, 0, 0.15, undefined],
    ]);
    expect(r.sprints[0]!.burndown.taskCount).toBe(3);
    expect(r.sprints[0]!.burndown.steps.map((s) => s.remaining)).toEqual([2, 1, 1, 1]);
    expect(r.sprints[1]!.burndown.steps.map((s) => s.taskId)).toEqual(["C"]);
    expect(r.velocity).toBe(2); // only sprint 1 has ended
    expect(r.costPerTask).toBe(0.17); // 0.50 / 3 done
  });

  it("a state from before sprints existed is one sprint over everything", () => {
    const state: BuildState = { id: "p", tasks: [t("A"), t("B")], totalCost: 0.2, status: "complete", outcomes: [o("A", 0.1), o("B", 0.1)] };
    const r = computeSprints(state);
    expect(r.sprints).toHaveLength(1);
    expect(r.sprints[0]).toMatchObject({ n: 1, planned: 2, done: 2, retries: 0, cost: 0.2, status: "complete" });
    expect(r.velocity).toBe(2);
  });

  it("no outcomes → no sprints", () => {
    expect(computeSprints({ id: "p", tasks: [t("A")], totalCost: 0, status: "running", outcomes: [] }).sprints).toEqual([]);
  });
});
