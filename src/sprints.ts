// Sprints — each build run (first build, resume, change, board-planned sprint) is one sprint
// over the tasks not yet done. Metrics come from the sprint's slice of the append-only
// outcomes record. States from before sprints existed count every outcome as sprint 1.

import type { BuildState, Sprint } from "./build-state.js";
import { computeBurndown, type Burndown } from "./burndown.js";

export interface SprintReport {
  n: number;
  status: Sprint["status"];
  planned: number; // tasks the sprint set out to do
  done: number; // of those, finished (last attempt succeeded)
  retries: number; // extra attempts (feedback rounds, escalations)
  cost: number;
  durationMs?: number; // absent while running
  burndown: Burndown; // over this sprint's tasks and outcomes only
}

export interface SprintSummary {
  sprints: SprintReport[];
  /** Average tasks finished per completed sprint; undefined until one has ended. */
  velocity?: number;
  /** Average cost per finished task across all sprints. */
  costPerTask?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function sprintsOf(state: BuildState): Sprint[] {
  if (state.sprints?.length) return state.sprints;
  if (!state.outcomes.length) return [];
  return [{ n: 1, startedAt: 0, taskIds: state.tasks.map((t) => t.id), outcomeStart: 0, outcomeEnd: state.outcomes.length, status: state.status }];
}

export function reportSprint(state: BuildState, s: Sprint): SprintReport {
  const outcomes = state.outcomes.slice(s.outcomeStart, s.outcomeEnd ?? state.outcomes.length);
  const planned = new Set(s.taskIds);
  const last = new Map<string, boolean>(); // taskId → last attempt succeeded
  let cost = 0;
  for (const o of outcomes) {
    cost += o.cost;
    if (planned.has(o.taskId)) last.set(o.taskId, !o.error);
  }
  const done = [...last.values()].filter(Boolean).length;
  const tasks = state.tasks.filter((t) => planned.has(t.id));
  return {
    n: s.n,
    status: s.status,
    planned: planned.size,
    done,
    retries: Math.max(0, outcomes.length - last.size),
    cost: round2(cost),
    durationMs: s.endedAt !== undefined && s.startedAt ? s.endedAt - s.startedAt : undefined,
    burndown: computeBurndown({ ...state, tasks, outcomes }),
  };
}

export function computeSprints(state: BuildState): SprintSummary {
  const sprints = sprintsOf(state).map((s) => reportSprint(state, s));
  const ended = sprints.filter((s) => s.status !== "running");
  const doneAll = sprints.reduce((n, s) => n + s.done, 0);
  const costAll = sprints.reduce((n, s) => n + s.cost, 0);
  return {
    sprints,
    velocity: ended.length ? round2(ended.reduce((n, s) => n + s.done, 0) / ended.length) : undefined,
    costPerTask: doneAll ? round2(costAll / doneAll) : undefined,
  };
}
