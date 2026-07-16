// Phase 2 — the Executor. Runs ONE task on a real Pi agent session with the model
// the router chose. Writes real files to a workspace dir, then reads back Pi's own
// token usage + cost so we can compare estimated vs actual.
//
// Constructing a session and resolving models is offline + free. Only session.prompt()
// hits the provider API and spends money — that path is guarded by the caller.

import {
  AuthStorage,
  ModelRegistry,
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Provider, RouteDecision, Task } from "./types.js";
import { estimateCost } from "./cost.js";
import { getModel } from "./models.js";
import { addSessionCost } from "./session-cost.js";

/** Pi's own Model type, derived so we don't depend on a deep sub-path import. */
type PiModel = NonNullable<ReturnType<ModelRegistry["find"]>>;

/** Resolve a Projectinator (provider, modelId) to Pi's executable Model.
 *  Offline + free — reads Pi's built-in registry. Throws with a clear message
 *  if the id isn't one Pi knows (our ids are kept identical to Pi's on purpose). */
export function resolvePiModel(
  registry: ModelRegistry,
  provider: Provider,
  modelId: string,
): PiModel {
  const m = registry.find(provider, modelId);
  if (!m) {
    throw new Error(
      `Pi has no model "${provider}/${modelId}". ` +
        `Check src/models.ts uses Pi's exact built-in id.`,
    );
  }
  return m;
}

export interface ExecuteOptions {
  /** Directory the agent builds into (its cwd). */
  workspace: string;
  /** Extended-thinking level. Pi clamps to model capability. */
  thinkingLevel?: "off" | "low" | "medium" | "high";
  /** Optional progress hook — receives raw Pi session events. */
  onEvent?: (event: AgentSessionEvent) => void;
  /** Override auth (tests). Default resolves env keys / ~/.pi/agent/auth.json. */
  authStorage?: AuthStorage;
  /** Tools the agent may use. Default: the coding set. */
  tools?: string[];
}

export interface ExecuteResult {
  taskId: string;
  provider: Provider;
  modelId: string;
  /** Files present in the workspace after the run (repo-relative). */
  files: string[];
  /** Pi's own measured usage for the run. */
  actual: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  /** Pi's own computed dollar cost. */
  actualCost: number;
  /** What we predicted before running, for calibration. */
  estCost: number;
  /** actualCost - estCost. Positive = we under-estimated. */
  costDelta: number;
}

/** Build the Developer role's instruction for a single task. */
export function buildDeveloperPrompt(task: Task): string {
  return [
    `You are the DEVELOPER on an autonomous build team. Complete exactly this task and nothing more.`,
    ``,
    `Task ${task.id}: ${task.title}`,
    task.story ? `Story: ${task.story}` : ``,
    ``,
    `Rules:`,
    `- Write real files into the current working directory using your file tools.`,
    `- Keep it minimal and correct; no placeholders, no TODOs.`,
    `- Do not explain at length. Build, then stop.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Execute one task on a live Pi session. THIS SPENDS MONEY (session.prompt).
 * Caller is responsible for gating on a live flag + present API key.
 */
export async function executeTask(
  task: Task,
  decision: RouteDecision,
  opts: ExecuteOptions,
): Promise<ExecuteResult> {
  const authStorage = opts.authStorage ?? AuthStorage.create();
  const registry = ModelRegistry.create(authStorage);
  const model = resolvePiModel(registry, decision.provider, decision.model.id);

  const { session } = await createAgentSession({
    model,
    cwd: opts.workspace,
    authStorage,
    modelRegistry: registry,
    thinkingLevel: opts.thinkingLevel ?? "medium",
    tools: opts.tools ?? ["read", "write", "edit", "bash", "ls", "grep", "find"],
  });

  let unsubscribe: (() => void) | undefined;
  if (opts.onEvent) unsubscribe = session.subscribe(opts.onEvent);

  try {
    await session.prompt(buildDeveloperPrompt(task));
    const stats = session.getSessionStats();
    addSessionCost(stats.cost);

    const estCost = estimateCost(task.estTokens, getModel(decision.model.id));
    const actualCost = round2(stats.cost);

    return {
      taskId: task.id,
      provider: decision.provider,
      modelId: decision.model.id,
      files: listFiles(opts.workspace),
      actual: {
        input: stats.tokens.input,
        output: stats.tokens.output,
        cacheRead: stats.tokens.cacheRead,
        cacheWrite: stats.tokens.cacheWrite,
        total: stats.tokens.total,
      },
      actualCost,
      estCost,
      costDelta: round2(actualCost - estCost),
    };
  } finally {
    unsubscribe?.();
    session.dispose();
  }
}

/** List files in a workspace, skipping Pi/session/VCS noise. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const skip = new Set([".pi", ".git", "node_modules"]);
  const walk = (d: string) => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      if (skip.has(name)) continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
