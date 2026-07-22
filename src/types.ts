// Core domain types for Projectinator's brain layer.
// Phase 1 is pure data + logic — no Pi, no network, no agents.

/** How we reach a model. `api` = metered + stable. `web` = user's existing
 *  web subscription, ~free but brittle (breaks on UI changes, no structured output). */
export type Backend = "api" | "web";

/** What kind of work a task needs. Roles bind to capabilities, never to model names. */
export type Capability = "plan" | "design" | "code" | "test" | "ops";

/** How hard the task is. Drives which tier of model we spend on. */
export type Difficulty = "trivial" | "low" | "medium" | "high";

/** Capability tier — the abstract "how strong a model" axis. */
export type Tier = "fast" | "mid" | "high";

export type Provider = "anthropic" | "openai" | "google" | "openrouter";

// ---------------------------------------------------------------------------
// Model pricing — mirrors Pi's models.json `cost` shape so it ports 1:1 later.
// All rates are USD per 1,000,000 tokens.
// ---------------------------------------------------------------------------

export interface CostTier {
  /** This tier applies once cumulative input tokens exceed this threshold. */
  inputTokensAbove: number;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ModelCost {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Optional volume tiers; highest matching threshold wins. */
  tiers?: CostTier[];
}

export interface Model {
  id: string;
  provider: Provider;
  name: string;
  contextWindow: number;
  cost: ModelCost;
}

// ---------------------------------------------------------------------------
// Registry — the swappable brain. capability + tier -> model, per backend.
// ---------------------------------------------------------------------------

export interface BackendPick {
  provider: Provider;
  /** Model id, must exist in the model table. */
  model: string;
}

export interface RegistryEntry {
  capability: Capability;
  tier: Tier;
  /** Model depends on how you connect. Web (free) can afford the best;
   *  API (paid) can pick a cheaper equivalent. */
  byBackend: Record<Backend, BackendPick>;
  /** On API, prompt the user which model to use for this role. */
  ask?: boolean;
  /** Why this pick — benchmark / source note. */
  evidence?: string;
  updated?: string;
}

// ---------------------------------------------------------------------------
// Task — what the PM emits, what the router reads.
// ---------------------------------------------------------------------------

export interface TokenEstimate {
  input: number;
  output: number;
  /** Fraction of input served from cache (0..1). Cuts cost via cacheRead rate. */
  cachedInputFraction?: number;
}

export interface Task {
  id: string;
  title: string;
  capability: Capability;
  difficulty: Difficulty;
  estTokens: TokenEstimate;
  epic?: string;
  story?: string;
  dependsOn?: string[];
}

// ---------------------------------------------------------------------------
// Policy — the user's knobs.
// ---------------------------------------------------------------------------

export type BackendMode = "ask" | "cost-first" | "api" | "web";

export interface RoutingPolicy {
  backendMode: BackendMode;
  /** Halt the run and ask the user if the cumulative bill would cross this. */
  budgetCapUSD: number;
  difficultyToTier: Record<Difficulty, Tier>;
  /** Tester -> Developer feedback loop stop condition (used later, in the orchestrator). */
  maxFeedbackRounds: number;
}

// ---------------------------------------------------------------------------
// Routing result.
// ---------------------------------------------------------------------------

export interface RouteDecision {
  taskId: string;
  backend: Backend;
  provider: Provider;
  model: Model;
  tier: Tier;
  /** Estimated USD for this task alone. */
  cost: number;
  /** Cumulative USD including this task. */
  runningTotal: number;
  /** True if runningTotal crossed the budget cap — caller should confirm with user. */
  overCap: boolean;
  /** Human-readable trail of how the decision was made. */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Orchestration (Phase 4).
// ---------------------------------------------------------------------------

export interface Bug {
  severity: "low" | "medium" | "high";
  description: string;
  file?: string;
}

/** A tester's structured judgement of a build. */
export interface Verdict {
  passed: boolean;
  bugs: Bug[];
}

/** What a role produces when it runs a task. */
export interface RoleResult {
  /** The agent's final assistant text (design spec, notes, summary). */
  finalText: string;
  /** Files present in the workspace after the run (repo-relative). */
  files: string[];
  /** Pi's own measured dollar cost for this run. */
  cost: number;
  /** Only for test tasks — the pass/fail judgement. */
  verdict?: Verdict;
}

/** Executor injected into the orchestrator. Real impl runs Pi; tests pass a fake. */
export type RoleExecutor = (input: {
  task: Task;
  decision: RouteDecision;
  /** Handoff text gathered from this task's dependencies. */
  contextText: string;
  /** 0 on first attempt, 1+ during a Tester→Developer feedback round. */
  round: number;
}) => Promise<RoleResult>;

/** One recorded step of a build run. */
export interface TaskOutcome extends RoleResult {
  taskId: string;
  capability: Capability;
  provider: Provider;
  modelId: string;
  round: number;
}
