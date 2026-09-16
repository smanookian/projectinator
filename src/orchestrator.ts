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
  type Bug,
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

/** Isolation for a parallel code task: a private directory to build in, and how to fold
 *  the result back. `merge` returns conflicting paths when the fold-back failed. */
export interface Isolation {
  dir: string;
  merge: (message: string) => { ok: true } | { ok: false; conflicts: string[] };
  discard: () => void;
}

/** Mid-build steering. All methods are safe to call at any time; the scheduler consults the
 *  control between launches. In-flight tasks always finish; nothing is killed. */
export interface BuildControl {
  /** Don't launch anything new until resume(). */
  pause(): void;
  resume(): void;
  paused(): boolean;
  /** Add tasks to the backlog (deps may point at existing or other new tasks). Picked up at
   *  the next scheduling pass; unknown deps are dropped. */
  inject(tasks: Task[]): void;
  /** Remove a not-yet-started task (and anything that depended only on it keeps its other deps). */
  remove(taskId: string): boolean;
  /** Finish what is running, then stop (halted, resumable). */
  stop(): void;
}

export function createBuildControl(): BuildControl & { _queue: Task[]; _removed: Set<string>; _stop: boolean; _wake: () => Promise<void> } {
  let paused = false;
  // The scheduler waits on this while paused with nothing running; any steering call wakes it.
  let waiter = Promise.withResolvers<void>();
  const wake = () => { waiter.resolve(); waiter = Promise.withResolvers<void>(); };
  const c = {
    _queue: [] as Task[], _removed: new Set<string>(), _stop: false,
    _wake: () => waiter.promise,
    pause: () => { paused = true; wake(); }, resume: () => { paused = false; wake(); }, paused: () => paused,
    inject: (tasks: Task[]) => { c._queue.push(...tasks); wake(); },
    remove: (taskId: string) => { c._removed.add(taskId); wake(); return true; },
    stop: () => { c._stop = true; wake(); },
  };
  return c;
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
  /** Give a parallel code task its own directory (git worktree). Absent = code tasks
   *  serialize on the shared workspace. Only consulted when another code task is running. */
  isolate?: (task: Task) => Isolation | undefined;
  /** Steering handle (createBuildControl). Absent = no steering. */
  control?: ReturnType<typeof createBuildControl>;
  /** Escalation rung 4: split a code task that keeps failing review/test into smaller tasks.
   *  Return the replacement tasks (ids must be new; deps may point at existing tasks). The
   *  orchestrator injects them plus a fresh judge. Absent = the ladder ends at the Designer. */
  replan?: (info: { task: Task; bugs: Bug[]; judge: Task; backlog: Task[] }) => Promise<Task[]>;
}

export type OrchestratorEvent =
  | { type: "task_start"; task: Task; round: number; provider: string; modelId: string }
  | { type: "task_done"; outcome: TaskOutcome; runningTotal: number }
  | { type: "task_failed"; outcome: TaskOutcome; runningTotal: number }
  | { type: "task_skipped"; taskId: string }
  | { type: "merge_conflict"; taskId: string; conflicts: string[] }
  | { type: "paused" }
  | { type: "resumed" }
  | { type: "task_added"; task: Task }
  | { type: "task_removed"; taskId: string }
  /** Escalation past the dev-fix rounds: the Designer rewrites the spec, or the PM splits the task. */
  | { type: "escalate"; taskId: string; rung: "respec" | "replan"; forTask: string; detail: string }
  | { type: "test_failed"; taskId: string; bugs: number; round: number }
  | { type: "retry_dev"; taskId: string; forTest: string; round: number }
  | { type: "budget_halt"; runningTotal: number; cap: number }
  | { type: "gate"; stage: string }
  | { type: "cycle_or_error"; message: string };

export interface RunResult {
  /** The backlog as it ended — including injected tasks, minus removed ones. */
  tasks: Task[];
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
    return { tasks, outcomes: [], totalCost: 0, halted: true, haltReason: message };
  }

  const runOne = async (task: Task, round: number, contextOverride?: string, tierBump = 0, workspace?: string): Promise<TaskOutcome> => {
    const decision = route(task, { policy, registry, runningTotalBefore: running, tierBump });
    emit({ type: "task_start", task, round, provider: decision.provider, modelId: decision.model.id });
    const contextText = contextOverride ?? gatherContext(task, outcomes);
    const meta = { taskId: task.id, capability: task.capability, provider: decision.provider, modelId: decision.model.id, round };
    let outcome: TaskOutcome;
    try {
      outcome = { ...(await execute({ task, decision, contextText, round, limits: policy.taskLimits, workspace })), ...meta };
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

  const escalated = new Set<string>(); // "<judgeId>:respec" | "<judgeId>:replan" — each rung once per judge
  const pending: Task[] = []; // tasks added from inside a task unit (escalation); picked up next pass
  const inject = (tasks: Task[]) => { pending.push(...tasks); };

  // One task's full lifecycle: run it, then its Reviewer/Tester -> Developer feedback loop.
  const runTaskUnit = async (task: Task, iso?: Isolation): Promise<void> => {
    let outcome: TaskOutcome;
    if (iso) {
      // Build in the worktree, then fold back. On a conflict, discard and rebuild serially
      // on the merged tree: the second attempt sees the other task's files.
      outcome = await runOne(task, 0, undefined, 0, iso.dir);
      if (outcome.error) { iso.discard(); checkpoint(); return; }
      const m = iso.merge(`${task.id}: ${task.title}`.replace(/\s+/g, " ").slice(0, 72));
      if (!m.ok) {
        emit({ type: "merge_conflict", taskId: task.id, conflicts: m.conflicts });
        outcomes.delete(task.id); // the worktree result is gone; the serial rerun is the real one
        outcome = await runOne(task, 0, `${gatherContext(task, outcomes)}\n\nNote: a parallel task changed ${m.conflicts.join(", ")} while you were working; you are now building on the merged files. Re-do this task against what is on disk.`);
      }
    } else {
      outcome = await runOne(task, 0);
    }
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
      const devFix = async (context: (dep: Task) => string): Promise<boolean> => {
        for (const dep of codeDeps) {
          emit({ type: "retry_dev", taskId: dep.id, forTest: task.id, round });
          // Escalation: the developer that just failed review/test retries one tier up.
          // The judge (review/test) stays on its routed model.
          if ((await runOne(dep, round, context(dep), 1)).error) return false;
        }
        outcome = await runOne(task, round); // re-judge
        round++;
        return !outcome.error;
      };
      const failing = () => !!outcome.verdict && !outcome.verdict.passed;

      // Rungs 1..N: developer fixes the reported bugs (tier-bumped), judge re-runs.
      while (failing() && round <= policy.maxFeedbackRounds) {
        emit({ type: "test_failed", taskId: task.id, bugs: outcome.verdict!.bugs.length, round });
        const report = bugReport(outcome.verdict!.bugs);
        if (!(await devFix(() => report))) break;
      }

      // Rung N+1: the Designer rewrites the spec the failing code was built from, once.
      // The new spec flows to the developer through the normal upstream context.
      const designDep = failing() && !outcome.error
        ? codeDeps.flatMap((c) => (c.dependsOn ?? []).map((id) => byId.get(id))).find((d) => d?.capability === "design")
        : undefined;
      if (designDep && !escalated.has(`${task.id}:respec`)) {
        escalated.add(`${task.id}:respec`);
        const bugs = outcome.verdict!.bugs;
        emit({ type: "escalate", taskId: designDep.id, rung: "respec", forTask: task.id, detail: `${bugs.length} bug(s) survived ${round - 1} fix round(s)` });
        const respec = [
          gatherContext(designDep, outcomes),
          `Your earlier spec was implemented, but ${round - 1} round(s) of fixes could not clear these problems found by the ${task.capability === "review" ? "reviewer" : "tester"}:`,
          ...bugs.map((b) => `- [${b.severity}]${b.file ? ` (${b.file})` : ""} ${b.description}`),
          "Rewrite the spec so a developer cannot get these wrong: be concrete about the exact files, element ids, text, and behaviour involved; simplify anything ambiguous. Output the full revised spec.",
        ].filter(Boolean).join("\n\n");
        if (!(await runOne(designDep, round, respec)).error) {
          emit({ type: "test_failed", taskId: task.id, bugs: bugs.length, round });
          // The revised spec must reach the developer: rebuild the upstream context from the
          // designer's new output instead of the bare bug list the earlier rounds use.
          await devFix((dep) => `${gatherContext(dep, outcomes)}\n\n${bugReport(bugs)}\n\nThe design spec was revised because of these problems — follow the spec above exactly.`);
        }
      }

      // Rung N+2: the PM splits the failing code task into smaller ones, once. They join the
      // backlog with a fresh judge of the same kind; this judge's failed verdict stands.
      if (failing() && !outcome.error && opts.replan && codeDeps.length && !escalated.has(`${task.id}:replan`)) {
        escalated.add(`${task.id}:replan`);
        const target = codeDeps[0]!;
        const bugs = outcome.verdict!.bugs;
        emit({ type: "escalate", taskId: target.id, rung: "replan", forTask: task.id, detail: `asking the PM to split ${target.id}` });
        const pieces = (await opts.replan({ task: target, bugs, judge: task, backlog: ordered })).filter((t) => !byId.has(t.id) && t.capability !== "test" && t.capability !== "review");
        if (pieces.length) {
          const judge: Task = {
            ...task,
            id: `${task.id}-r${escalated.size}`,
            title: `${task.title} (after split)`,
            dependsOn: [...(task.dependsOn ?? []).filter((d) => d !== target.id), ...pieces.map((p) => p.id)],
          };
          inject([...pieces, judge]);
        }
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
  const control = opts.control;

  // ---- ready-set scheduler (concurrency 1 = strictly sequential, in toposorted order) ----
  // JS is single-threaded, so mutations between awaits are atomic (no locks needed).
  // Independent tasks (deps satisfied) run concurrently up to `concurrency`. A budget
  // reservation on in-flight estimates prevents launches that could cross the cap.
  // Steering (pause / inject / remove / stop) is applied at the top of every pass.
  const remaining = new Set(ordered.filter((t) => !wasDone.has(t.id)).map((t) => t.id));
  for (const id of wasDone) emit({ type: "task_skipped", taskId: id });

  const inFlight = new Map<string, Promise<void>>();
  let reserved = 0;
  let codeInFlight = 0; // code tasks are serialized (they share files) unless isolated
  let failure: unknown; // first task error; rethrown after in-flight work drains
  let pausedAnnounced = false;

  const depsSatisfied = (t: Task) => (t.dependsOn ?? []).every((d) => !remaining.has(d));
  const readyTasks = () =>
    ordered.filter((t) => remaining.has(t.id) && !inFlight.has(t.id) && depsSatisfied(t));

  const applySteering = () => {
    const queue = [...pending.splice(0), ...(control?._queue.splice(0) ?? [])];
    if (queue.length) {
      const known = new Set([...byId.keys(), ...queue.map((t) => t.id)]);
      for (const raw of queue) {
        if (byId.has(raw.id)) continue; // duplicate id: ignore
        const t: Task = { ...raw, dependsOn: (raw.dependsOn ?? []).filter((d) => known.has(d)) };
        byId.set(t.id, t);
        ordered.push(t);
        remaining.add(t.id);
        emit({ type: "task_added", task: t });
      }
    }
    if (!control) return;
    for (const id of control._removed) {
      control._removed.delete(id);
      if (!remaining.has(id) || inFlight.has(id)) continue; // gone, done, or running: nothing to do
      remaining.delete(id);
      const i = ordered.findIndex((t) => t.id === id);
      if (i >= 0) ordered.splice(i, 1);
      byId.delete(id);
      for (const t of ordered) if (t.dependsOn?.includes(id)) t.dependsOn = t.dependsOn.filter((d) => d !== id);
      emit({ type: "task_removed", taskId: id });
    }
  };

  while (!halted) {
    applySteering();
    if (control?._stop) { halted = true; haltReason = "stopped by user"; break; }
    if (remaining.size === 0) break;
    if (control?.paused()) {
      if (!pausedAnnounced) { emit({ type: "paused" }); pausedAnnounced = true; }
      await (inFlight.size ? Promise.race([...inFlight.values(), control._wake()]) : control._wake());
      continue;
    }
    if (pausedAnnounced) { emit({ type: "resumed" }); pausedAnnounced = false; }

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
      // Code tasks share the workspace: only one at a time — unless the caller can give
      // this one its own worktree, in which case it runs in parallel and is merged back.
      let iso: Isolation | undefined;
      if (task.capability === "code" && codeInFlight >= 1) {
        iso = opts.isolate?.(task);
        if (!iso) continue;
      }
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
      const p = runTaskUnit(task, iso).then(settle, (e: unknown) => {
        settle();
        halted = true;
        haltReason ??= e instanceof Error ? e.message : String(e);
        failure ??= e;
      });
      inFlight.set(task.id, p);
      if (concurrency === 1) break; // sequential: one launch per pass keeps toposort order exact
    }

    if (inFlight.size === 0) {
      if (halted || readyTasks().length === 0) break; // nothing running and nothing launchable -> done or halted
      continue; // (deps just became satisfiable via steering)
    }
    await Promise.race(inFlight.values());
  }

  await Promise.all(inFlight.values());
  checkpoint();
  if (failure) throw failure;
  return { tasks: ordered, outcomes: record, totalCost: round2(running), halted, haltReason };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
