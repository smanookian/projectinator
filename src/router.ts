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
} from "./types.js";
import { estimateCost } from "./cost.js";
import { getModel } from "./models.js";
import { findEntry, REGISTRY } from "./registry.js";

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
}

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

  // 2. Difficulty -> tier.
  const tier = policy.difficultyToTier[task.difficulty];
  reasons.push(`difficulty=${task.difficulty} -> tier=${tier}`);

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

  // 5. Cost.
  const cost = estimateCost(task.estTokens, model);
  const runningTotal = round2((ctx.runningTotalBefore ?? 0) + cost);
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A sensible default policy. */
export const DEFAULT_POLICY: RoutingPolicy = {
  backendMode: "cost-first",
  budgetCapUSD: 15,
  difficultyToTier: { trivial: "fast", low: "mid", medium: "mid", high: "high" },
  maxFeedbackRounds: 3,
};
