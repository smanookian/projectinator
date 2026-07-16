// Build retro — a free, data-driven summary of a finished build, computed from
// build-state: what passed, what the tester flagged, cost per epic and per
// model, retries, and the priciest tasks. No model call.

import type { BuildState } from "./build-state.js";
import type { Bug } from "./types.js";

export interface RetroReport {
  idea: string;
  status: BuildState["status"];
  totalCost: number;
  taskCount: number;
  doneCount: number;
  tests: { passed: number; failed: number };
  bugs: Bug[]; // everything the tester flagged during the build
  retries: { taskId: string; title: string; rounds: number }[];
  byEpic: { epic: string; cost: number; tasks: number }[];
  byModel: { model: string; cost: number; tasks: number }[];
  topCost: { taskId: string; title: string; cost: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeRetro(state: BuildState): RetroReport {
  const titleById = new Map(state.tasks.map((t) => [t.id, t.title]));
  const epicById = new Map(state.tasks.map((t) => [t.id, t.epic || "General"]));
  const outcomes = state.outcomes;
  const doneIds = new Set(outcomes.map((o) => o.taskId));

  // Tests: judge each test task by its LAST outcome (final state after retries).
  const lastTestByTask = new Map<string, (typeof outcomes)[number]>();
  for (const o of outcomes) if (o.capability === "test") lastTestByTask.set(o.taskId, o);
  let passed = 0;
  let failed = 0;
  for (const o of lastTestByTask.values()) {
    if (o.verdict?.passed) passed++;
    else if (o.verdict) failed++;
  }

  // Bugs the tester flagged anywhere during the build (signal, even if later fixed).
  const bugs: Bug[] = [];
  for (const o of outcomes) if (o.verdict?.bugs) bugs.push(...o.verdict.bugs);

  // Retries: any outcome past round 0 means a Tester→Developer rebuild happened.
  const roundsByTask = new Map<string, number>();
  for (const o of outcomes) if (o.round > 0) roundsByTask.set(o.taskId, Math.max(roundsByTask.get(o.taskId) ?? 0, o.round));
  const retries = [...roundsByTask.entries()].map(([taskId, rounds]) => ({ taskId, title: titleById.get(taskId) ?? taskId, rounds }));

  // Cost per epic + per model.
  const epicCost = new Map<string, { cost: number; tasks: number }>();
  const modelCost = new Map<string, { cost: number; tasks: number }>();
  for (const o of outcomes) {
    const e = epicById.get(o.taskId) ?? "General";
    const ec = epicCost.get(e) ?? { cost: 0, tasks: 0 };
    epicCost.set(e, { cost: ec.cost + o.cost, tasks: ec.tasks + 1 });
    const mc = modelCost.get(o.modelId) ?? { cost: 0, tasks: 0 };
    modelCost.set(o.modelId, { cost: mc.cost + o.cost, tasks: mc.tasks + 1 });
  }
  const byEpic = [...epicCost.entries()].map(([epic, v]) => ({ epic, cost: round2(v.cost), tasks: v.tasks })).sort((a, b) => b.cost - a.cost);
  const byModel = [...modelCost.entries()].map(([model, v]) => ({ model, cost: round2(v.cost), tasks: v.tasks })).sort((a, b) => b.cost - a.cost);

  const topCost = [...outcomes]
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3)
    .map((o) => ({ taskId: o.taskId, title: titleById.get(o.taskId) ?? o.taskId, cost: round2(o.cost) }));

  return {
    idea: state.idea ?? state.id,
    status: state.status,
    totalCost: round2(state.totalCost),
    taskCount: state.tasks.length,
    doneCount: doneIds.size,
    tests: { passed, failed },
    bugs,
    retries,
    byEpic,
    byModel,
    topCost,
  };
}
