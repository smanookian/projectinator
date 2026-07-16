// Build persistence — checkpoint a run so a halt/crash/cancel can resume without
// re-paying for finished tasks. The orchestrator itself stays fs-free; this module
// (and run-build) own the disk I/O.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Task, TaskOutcome } from "./types.js";

export interface BuildState {
  id: string;
  /** The original idea/request text, for display in the projects list. */
  idea?: string;
  /** Workflow used: auto-run, or approval-gated. */
  mode?: "auto" | "approval";
  tasks: Task[];
  /** Full record of every task run, including feedback-loop retries (append-only). */
  outcomes: TaskOutcome[];
  totalCost: number;
  status: "running" | "complete" | "halted";
  haltReason?: string;
  /** Per-project budget cap (USD). Overrides the global default when set. */
  budgetCapUSD?: number;
  /** Cached AI retro narrative (generated on demand). */
  retroNarrative?: string;
}

export function newBuildState(id: string, tasks: Task[], idea?: string, mode?: "auto" | "approval"): BuildState {
  return { id, idea, mode, tasks, outcomes: [], totalCost: 0, status: "running" };
}

export function saveState(state: BuildState, path: string): void {
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
}

export function loadState(path: string): BuildState | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as BuildState;
  } catch (e) {
    throw new Error(`Bad build state at ${path}: ${e instanceof Error ? e.message : e}`);
  }
}

/** Which task ids are already finished (last outcome wins). Used to skip on resume. */
export function completedIds(state: BuildState): Set<string> {
  return new Set(state.outcomes.map((o) => o.taskId));
}
