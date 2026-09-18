// The Router — deterministic dispatch. No LLM, no network. Given a tagged task
// and a policy, it resolves backend -> model -> cost, and flags budget overruns.
//
// User prompts (which backend? which model on API?) are injected as callbacks so
// the router stays pure and unit-testable. In the CLI they wrap real prompts;
// in tests they're stubs.

import type {
  Backend,
  RegistryEntry,
  RouteDecision,
  RoutingPolicy,
  Task,
  Tier,
} from "./types.js";
import { estimateCost } from "./cost.js";
import { getModel } from "./models.js";
import { findEntry, REGISTRY } from "./registry.js";
import { calibratedCostUSD, modelCalibratedTokens } from "./calibration.js";

export interface RouterPrompts {
  /** Ask the user which backend to use. Called only when backendMode === "ask". */
  chooseBackend?: (task: Task) => Backend;
  /** Ask the user which model on API. Called only when entry.ask && backend === "api".
   *  Return a model id, or undefined to accept the registry default. */
  chooseModel?: (task: Task, entry: RegistryEntry, backend: Backend) => string | undefined;
}

export interface RouteContext {
  policy: RoutingPolicy;
  registry?: RegistryEntry[];
  prompts?: RouterPrompts;
  /** Cumulative spend before this task, USD. */
  runningTotalBefore?: number;
  /** Escalate the model tier by this many steps (fast→mid→high, capped). Used by the
   *  feedback loop: a developer that failed review/test retries one tier up. */
  tierBump?: number;
}

const TIERS: Tier[] = ["fast", "mid", "high"];

/** Resolve which backend to use from the policy (and a prompt, if "ask"). */
export function resolveBackend(policy: RoutingPolicy, task: Task, prompts?: RouterPrompts): Backend {
  switch (policy.backendMode) {
    case "api":
      return "api";
    case "web":
      return "web";
    case "cost-first":
      // Web-login rides the user's existing subscription -> effectively free.
      return "web";
    case "ask":
      if (!prompts?.chooseBackend) {
        throw new Error('backendMode "ask" requires prompts.chooseBackend');
      }
      return prompts.chooseBackend(task);
  }
}

export function route(task: Task, ctx: RouteContext): RouteDecision {
  const { policy } = ctx;
  const registry = ctx.registry ?? REGISTRY;
  const reasons: string[] = [];

  // 1. Backend.
  const backend = resolveBackend(policy, task, ctx.prompts);
  reasons.push(`backend=${backend} (mode=${policy.backendMode})`);

  // 2. Difficulty -> tier (+ escalation).
  const base = policy.difficultyToTier[task.difficulty];
  const tier = TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(base) + (ctx.tierBump ?? 0))]!;
  reasons.push(`difficulty=${task.difficulty} -> tier=${tier}${tier !== base ? ` (escalated from ${base})` : ""}`);

  // 3. Registry lookup (with tier fallback).
  const { entry, exactTier } = findEntry(task.capability, tier, registry);
  if (!exactTier) reasons.push(`no ${task.capability}/${tier} entry, fell back to ${entry.tier}`);

  // 4. Backend-conditional model, with optional per-role prompt on API.
  let modelId = entry.byBackend[backend].model;
  if (backend === "api" && entry.ask && ctx.prompts?.chooseModel) {
    const picked = ctx.prompts.chooseModel(task, entry, backend);
    if (picked && picked !== modelId) {
      reasons.push(`user overrode model ${modelId} -> ${picked}`);
      modelId = picked;
    }
  }
  const model = getModel(modelId);
  reasons.push(`model=${model.id} (${model.provider})`);

  // 5. Cost. Prefer what this bucket actually BILLED on this model. Deriving cost from tokens
  // assumes input served from cache bills at the cacheRead rate; measured runs show the bill
  // behaving as if there were no cache discount, which made estimates ~2x low and halted builds
  // against their own cap. Token math remains the fallback for a model that hasn't run yet.
  const est = modelCalibratedTokens(task.capability, task.difficulty, model.id) ?? task.estTokens;
  const measured = calibratedCostUSD(task.capability, task.difficulty, model.id);
  // No measured price yet: price the tokens as if none of the input gets a cache discount.
  // Measured runs bill that way (a task estimated at $0.15 with 95% cache assumed, and $0.54
  // with none, actually cost $0.50), so the optimistic assumption is what made caps unusable.
  const cost = measured ?? estimateCost({ ...est, cachedInputFraction: 0 }, model);
  if (measured !== undefined) reasons.push(`cost from ${model.id}'s measured runs`);
  else if (est !== task.estTokens) reasons.push(`tokens from measured runs on ${model.id}, priced without a cache discount`);
  const runningTotal = Math.round(((ctx.runningTotalBefore ?? 0) + cost) * 10_000) / 10_000;
  const overCap = runningTotal > policy.budgetCapUSD;
  if (overCap) reasons.push(`OVER CAP: running $${runningTotal} > cap $${policy.budgetCapUSD}`);

  return {
    taskId: task.id,
    backend,
    provider: model.provider,
    model,
    tier: entry.tier,
    cost,
    runningTotal,
    overCap,
    reasons,
  };
}

/** Route a whole backlog in order, threading the running total. */
export function routeBacklog(tasks: Task[], ctx: RouteContext): RouteDecision[] {
  const out: RouteDecision[] = [];
  let running = ctx.runningTotalBefore ?? 0;
  for (const task of tasks) {
    const decision = route(task, { ...ctx, runningTotalBefore: running });
    running = decision.runningTotal;
    out.push(decision);
  }
  return out;
}

/** A sensible default policy. */
export const DEFAULT_POLICY: RoutingPolicy = {
  backendMode: "cost-first",
  budgetCapUSD: 15,
  difficultyToTier: { trivial: "fast", low: "mid", medium: "mid", high: "high" },
  maxFeedbackRounds: 3,
  taskLimits: { timeoutMs: 10 * 60_000, costCapUSD: 3 },
};
