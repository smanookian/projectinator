// Burndown — tasks remaining and cumulative spend across the build. There are no
// timestamps in build-state, so the X axis is task-completion order (step 1..N),
// which is the natural timeline for a build. Retries add a step (and cost) without
// burning down a task, so they show up as flat-remaining / rising-cost.

import type { BuildState } from "./build-state.js";

export interface BurndownStep {
  taskId: string;
  remaining: number; // distinct tasks still to do after this step
  cumCost: number; // cumulative spend through this step
  retry: boolean; // this step re-ran an already-done task
}

export interface Burndown {
  taskCount: number;
  totalCost: number;
  steps: BurndownStep[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeBurndown(state: BuildState): Burndown {
  const taskCount = state.tasks.length;
  const done = new Set<string>();
  let cum = 0;
  const steps: BurndownStep[] = [];
  for (const o of state.outcomes) {
    const retry = done.has(o.taskId);
    done.add(o.taskId);
    cum += o.cost;
    steps.push({ taskId: o.taskId, remaining: taskCount - done.size, cumCost: round2(cum), retry });
  }
  return { taskCount, totalCost: round2(cum), steps };
}
