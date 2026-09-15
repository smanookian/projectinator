// Phase 4 — the Orchestrator. Runs a whole backlog end to end.
//
// - Topologically orders tasks by dependsOn (respects design->code->test->deploy).
// - Threads handoff context: a task sees the final output of its dependencies.
// - Runs a Tester -> Developer feedback loop, bounded by maxFeedbackRounds.
// - Tracks cost and halts on the budget cap.
//
// The executor is INJECTED (RoleExecutor), so this entire control flow is testable
// offline with a fake — no model, no spend. The real Pi executor lives in roles.ts.

import {
  TaskLimitError,
  type RegistryEntry,
  type RoleExecutor,
  type RoutingPolicy,
  type Task,
  type TaskOutcome,
} from "./types.js";
import { route } from "./router.js";
import { REGISTRY } from "./registry.js";

/** Order tasks so every task comes after its dependencies. Throws on a cycle. */
export function toposort(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map<string, "visiting" | "done">();
  const out: Task[] = [];

  const visit = (t: Task, trail: string[]) => {
    const s = state.get(t.id);
    if (s === "done") return;
    if (s === "visiting") {
      throw new Error(`Dependency cycle: ${[...trail, t.id].join(" -> ")}`);
    }
    state.set(t.id, "visiting");
    for (const dep of t.dependsOn ?? []) {
      const d = byId.get(dep);
      if (d) visit(d, [...trail, t.id]); // unknown deps already stripped by normalize
    }
    state.set(t.id, "done");
    out.push(t);
  };

  for (const t of tasks) visit(t, []);
  return out;
}

export interface RunOptions {
  policy: RoutingPolicy;
  execute: RoleExecutor;
  /** Registry to route against. Swap this to lock every role to one provider. */
  registry?: RegistryEntry[];
  onProgress?: (event: OrchestratorEvent) => void;
  /** Prior outcomes to resume from (append-only record). Their tasks are skipped. */
  seedOutcomes?: TaskOutcome[];
  /** Called after each task settles, with the full record + running total, for persistence. */
  onCheckpoint?: (outcomes: TaskOutcome[], totalCost: number) => void;
  /** Max tasks to run at once. 1 (default) = sequential. >1 runs independent tasks in parallel. */
  concurrency?: number;
  /** Optional human gate before development begins (design done → dev). Resolve "stop" to halt. */
  onGate?: (info: { stage: string }) => Promise<"continue" | "stop">;
}

export type OrchestratorEvent =
  | { type: "task_start"; task: Task; round: number; provider: string; modelId: string }
  | { type: "task_done"; outcome: TaskOutcome; runningTotal: number }
  | { type: "task_failed"; outcome: TaskOutcome; runningTotal: number }
  | { type: "task_skipped"; taskId: string }
  | { type: "test_failed"; taskId: string; bugs: number; round: number }
  | { type: "retry_dev"; taskId: string; forTest: string; round: number }
  | { type: "budget_halt"; runningTotal: number; cap: number }
  | { type: "gate"; stage: string }
  | { type: "cycle_or_error"; message: string };

export interface RunResult {
  outcomes: TaskOutcome[];
  totalCost: number;
  halted: boolean;
  haltReason?: string;
}

/** Build handoff text from a task's dependency outcomes. */
function gatherContext(task: Task, outcomes: Map<string, TaskOutcome>): string {
  const deps = task.dependsOn ?? [];
  if (deps.length === 0) return "";
  const parts: string[] = [];
  for (const depId of deps) {
    const o = outcomes.get(depId);
    if (!o) continue;
    const snippet = o.finalText.trim();
    if (snippet) parts.push(`### From ${depId} (${o.capability}):\n${snippet}`);
    if (o.files.length) parts.push(`### Files from ${depId}: ${o.files.join(", ")}`);
  }
  return parts.length ? `Context from upstream work:\n\n${parts.join("\n\n")}` : "";
}

function bugReport(bugs: { severity: string; description: string; file?: string }[]): string {
  return [
    "The tester found these issues. Fix them, then stop:",
    ...bugs.map((b) => `- [${b.severity}]${b.file ? ` (${b.file})` : ""} ${b.description}`),
  ].join("\n");
}

export async function runBacklog(tasks: Task[], opts: RunOptions): Promise<RunResult> {
  const { policy, execute } = opts;
  const registry = opts.registry ?? REGISTRY;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const outcomes = new Map<string, TaskOutcome>();
  const record: TaskOutcome[] = [];
  let running = 0;

  // Resume: replay prior outcomes so finished tasks are skipped and cost is restored.
  // A failed attempt is billed but never "done" — it is rebuilt.
  const seed = opts.seedOutcomes ?? [];
  for (const o of seed) {
    record.push(o);
    if (o.error) outcomes.delete(o.taskId); // last wins: a later failure voids an earlier pass
    else outcomes.set(o.taskId, o);
    running += o.cost;
  }
  running = round2(running);
  const wasDone = new Set(outcomes.keys());

  let halted = false;
  let haltReason: string | undefined;

  const emit = opts.onProgress ?? (() => {});
  const checkpoint = () => opts.onCheckpoint?.(record, round2(running));

  let ordered: Task[];
  try {
    ordered = toposort(tasks);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    emit({ type: "cycle_or_error", message });
    return { outcomes: [], totalCost: 0, halted: true, haltReason: message };
  }

  const runOne = async (task: Task, round: number, contextOverride?: string, tierBump = 0): Promise<TaskOutcome> => {
    const decision = route(task, { policy, registry, runningTotalBefore: running, tierBump });
    emit({ type: "task_start", task, round, provider: decision.provider, modelId: decision.model.id });
    const contextText = contextOverride ?? gatherContext(task, outcomes);
    const meta = { taskId: task.id, capability: task.capability, provider: decision.provider, modelId: decision.model.id, round };
    let outcome: TaskOutcome;
    try {
      outcome = { ...(await execute({ task, decision, contextText, round, limits: policy.taskLimits })), ...meta };
    } catch (e) {
      if (!(e instanceof TaskLimitError)) throw e;
      // Limit breach: bill what was spent, record the failure, halt the build.
      outcome = { finalText: "", files: [], cost: e.costSoFar, error: e.message, ...meta };
      running += outcome.cost;
      record.push(outcome);
      halted = true;
      haltReason = `${task.id} aborted: ${e.message}`;
      emit({ type: "task_failed", outcome, runningTotal: round2(running) });
      return outcome;
    }
    running += outcome.cost;
    outcomes.set(task.id, outcome);
    record.push(outcome);
    emit({ type: "task_done", outcome, runningTotal: round2(running) });
    return outcome;
  };

  // One task's full lifecycle: run it, then its Reviewer/Tester -> Developer feedback loop.
  const runTaskUnit = async (task: Task): Promise<void> => {
    let outcome = await runOne(task, 0);
    const judges = task.capability === "test" || task.capability === "review";
    if (!outcome.error && judges && outcome.verdict && !outcome.verdict.passed) {
      // The code to fix: direct code deps, plus code deps reached through a review
      // (a test depends on the review, which depends on the code).
      const codeDeps: Task[] = [];
      for (const id of task.dependsOn ?? []) {
        const dep = byId.get(id);
        if (!dep) continue;
        if (dep.capability === "code") codeDeps.push(dep);
        else if (dep.capability === "review") {
          for (const id2 of dep.dependsOn ?? []) {
            const d2 = byId.get(id2);
            if (d2?.capability === "code" && !codeDeps.includes(d2)) codeDeps.push(d2);
          }
        }
      }

      let round = 1;
      fix: while (outcome.verdict && !outcome.verdict.passed && round <= policy.maxFeedbackRounds) {
        emit({ type: "test_failed", taskId: task.id, bugs: outcome.verdict.bugs.length, round });
        const fixContext = bugReport(outcome.verdict.bugs);
        for (const dep of codeDeps) {
          emit({ type: "retry_dev", taskId: dep.id, forTest: task.id, round });
          // Escalation: the developer that just failed review/test retries one tier up.
          // The judge (review/test) stays on its routed model.
          if ((await runOne(dep, round, fixContext, 1)).error) break fix;
        }
        outcome = await runOne(task, round); // re-test
        if (outcome.error) break;
        round++;
      }
    }
    checkpoint();
  };

  // Human gate: pause once before the first development (code) task begins.
  let gateDone = false;
  const passGate = async (): Promise<boolean> => {
    if (gateDone || !opts.onGate) return true;
    gateDone = true;
    emit({ type: "gate", stage: "design→dev" });
    const decision = await opts.onGate({ stage: "design→dev" });
    return decision !== "stop";
  };

  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 1));

  // ---- sequential path (concurrency 1) — unchanged behavior ----
  if (concurrency === 1) {
    for (const task of ordered) {
      if (wasDone.has(task.id)) {
        emit({ type: "task_skipped", taskId: task.id });
        continue;
      }
      if (task.capability === "code" && !(await passGate())) {
        checkpoint();
        return { outcomes: record, totalCost: round2(running), halted: true, haltReason: "stopped at review gate" };
      }
      const est = route(task, { policy, registry, runningTotalBefore: running });
      if (est.overCap) {
        emit({ type: "budget_halt", runningTotal: round2(running + est.cost), cap: policy.budgetCapUSD });
        checkpoint();
        return { outcomes: record, totalCost: round2(running), halted: true, haltReason: "budget cap" };
      }
      await runTaskUnit(task);
      if (halted) return { outcomes: record, totalCost: round2(running), halted, haltReason };
    }
    return { outcomes: record, totalCost: round2(running), halted: false };
  }

  // ---- parallel path (concurrency > 1) — ready-set scheduler ----
  // JS is single-threaded, so mutations between awaits are atomic (no locks needed).
  // Independent tasks (deps satisfied) run concurrently up to `concurrency`. A budget
  // reservation on in-flight estimates prevents launches that could cross the cap.
  const remaining = new Set(ordered.filter((t) => !wasDone.has(t.id)).map((t) => t.id));
  for (const id of wasDone) emit({ type: "task_skipped", taskId: id });

  const inFlight = new Map<string, Promise<void>>();
  let reserved = 0;
  let codeInFlight = 0; // code tasks are serialized (they share files) even in parallel mode
  let failure: unknown; // first task error; rethrown after in-flight work drains

  const depsSatisfied = (t: Task) => (t.dependsOn ?? []).every((d) => !remaining.has(d));
  const readyTasks = () =>
    ordered.filter((t) => remaining.has(t.id) && !inFlight.has(t.id) && depsSatisfied(t));

  while (remaining.size > 0 && !halted) {
    // Gate before any development task launches.
    if (!gateDone && opts.onGate && readyTasks().some((t) => t.capability === "code")) {
      if (!(await passGate())) {
        halted = true;
        haltReason = "stopped at review gate";
        break;
      }
    }
    for (const task of readyTasks()) {
      if (inFlight.size >= concurrency) break;
      // Only one code task builds at a time — they write to the shared workspace.
      if (task.capability === "code" && codeInFlight >= 1) continue;
      // Reservations keep full precision: rounding each one to cents drops sub-cent
      // estimates entirely, so a wide backlog of cheap tasks would under-reserve.
      const est = route(task, { policy, registry, runningTotalBefore: running + reserved });
      if (running + reserved + est.cost > policy.budgetCapUSD) {
        if (inFlight.size === 0) {
          emit({ type: "budget_halt", runningTotal: round2(running + est.cost), cap: policy.budgetCapUSD });
          halted = true;
          haltReason = "budget cap";
        }
        break; // wait for in-flight tasks to free budget/capacity
      }
      reserved += est.cost;
      const cost = est.cost;
      const isCode = task.capability === "code";
      if (isCode) codeInFlight++;
      const settle = () => {
        if (isCode) codeInFlight--;
        reserved -= cost;
        remaining.delete(task.id);
        inFlight.delete(task.id);
      };
      // A rejection must NOT escape through Promise.race below: that abandons the
      // sibling promises, and their later rejections would have no handler attached
      // (unhandled rejection -> the host process dies mid-build). Capture the first
      // failure, stop launching, drain what's running, checkpoint, then rethrow.
      const p = runTaskUnit(task).then(settle, (e: unknown) => {
        settle();
        halted = true;
        haltReason ??= e instanceof Error ? e.message : String(e);
        failure ??= e;
      });
      inFlight.set(task.id, p);
    }

    if (inFlight.size === 0) break; // nothing running and nothing launchable -> done or halted
    await Promise.race(inFlight.values());
  }

  await Promise.all(inFlight.values());
  checkpoint();
  if (failure) throw failure;
  return { outcomes: record, totalCost: round2(running), halted, haltReason };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
