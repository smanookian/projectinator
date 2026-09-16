// Build persistence — checkpoint a run so a halt/crash/cancel can resume without
// re-paying for finished tasks. The orchestrator itself stays fs-free; this module
// (and run-build) own the disk I/O.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Task, TaskOutcome } from "./types.js";

/** One build run over the (un-parked) backlog. Outcomes are append-only, so a sprint is a
 *  contiguous slice of `outcomes`: [outcomeStart, outcomeEnd). */
export interface Sprint {
  n: number;
  startedAt: number; // epoch ms
  endedAt?: number;
  /** Tasks the sprint set out to do (not yet done at start). */
  taskIds: string[];
  outcomeStart: number;
  outcomeEnd?: number; // absent while running
  status: "running" | "complete" | "halted";
}

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
  /** Stack profile (docs/STACKS.md). Missing = static, today's behaviour. */
  stack?: "static" | "vite" | "node";
  /** Allow npm install scripts for this project (off by default; see STACKS.md decision 1). */
  allowInstallScripts?: boolean;
  /** Per-project budget cap (USD). Overrides the global default when set. */
  budgetCapUSD?: number;
  /** Cached AI retro narrative (generated on demand). */
  retroNarrative?: string;
  /** One entry per build run (first build, resume, change, sprint). Missing on old states:
   *  every outcome then counts as sprint 1. */
  sprints?: Sprint[];
  /** GitHub repo this project is published to (see github.ts for the ownership rule). */
  github?: { url: string; createdByProjectinator: boolean; base: string };
  /** Task id → issue URL, for "export backlog as issues" (so re-runs only add new tasks). */
  githubIssues?: Record<string, string>;
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

/** Which task ids are already finished (last outcome wins; a failed attempt does not
 *  count). Used to skip on resume. */
export function completedIds(state: BuildState): Set<string> {
  return new Set(state.outcomes.filter((o) => !o.error).map((o) => o.taskId));
}
