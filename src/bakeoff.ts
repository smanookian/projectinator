// Model bake-off — the founding idea: run ONE task across several models, then
// compare cost, latency, and quality so you can pick the best model per role and
// feed that back into the routing registry.
//
// v1 covers TEXT roles (plan, design, test-reasoning) where the deliverable is
// text a judge can score. Code bake-off (per-candidate sandbox + real test
// scoring) is a later step.

import {
  AuthStorage,
  ModelRegistry,
  createAgentSession,
  defineTool,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { Capability, Difficulty, Provider, Task } from "./types.js";
import { resolvePiModel } from "./executor.js";
import { buildRolePrompt } from "./roles.js";
import { estimateTokens } from "./estimate.js";
import { addSessionCost } from "./session-cost.js";

export interface Candidate {
  provider: Provider;
  model: string;
}

export interface BakeoffEntry {
  provider: Provider;
  model: string;
  output: string;
  cost: number;
  ms: number;
  outputTokens: number;
  error?: string;
}

export interface JudgeScore {
  model: string;
  score: number; // 0-10
  reason: string;
}

export interface BakeoffResult {
  task: Task;
  entries: BakeoffEntry[];
  scores: JudgeScore[];
  winner?: string; // "provider/model"
  judge?: string; // judge model id
}

function lastAssistantText(session: AgentSession): string {
  const msgs = session.messages as Array<{ role?: string; content?: unknown }>;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role !== "assistant") continue;
    const c = m.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      return c
        .map((p: unknown) => (typeof p === "string" ? p : p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : ""))
        .join("")
        .trim();
    }
  }
  return "";
}

const id = (c: Candidate) => `${c.provider}/${c.model}`;

/** Run one candidate on the task, capturing output, cost, and latency. */
async function runCandidate(task: Task, cand: Candidate): Promise<BakeoffEntry> {
  const base: BakeoffEntry = { provider: cand.provider, model: cand.model, output: "", cost: 0, ms: 0, outputTokens: 0 };
  try {
    const authStorage = AuthStorage.create();
    const registry = ModelRegistry.create(authStorage);
    const model = resolvePiModel(registry, cand.provider, cand.model);
    const { session } = await createAgentSession({
      model,
      authStorage,
      modelRegistry: registry,
      thinkingLevel: "medium",
      noTools: "all",
    });
    try {
      const t0 = Date.now();
      await session.prompt(buildRolePrompt(task, ""));
      const ms = Date.now() - t0;
      const stats = session.getSessionStats();
      addSessionCost(stats.cost);
      const out: BakeoffEntry = {
        ...base,
        output: lastAssistantText(session),
        cost: Math.round(stats.cost * 10000) / 10000,
        ms,
        outputTokens: stats.tokens.output,
      };
      if (stats.tokens.total === 0) out.error = "returned 0 tokens (key likely can't access this model)";
      return out;
    } finally {
      session.dispose(); // dispose even when prompt() throws (expected for inaccessible models)
    }
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---- judge: score every output on one rubric, forced structured output ----

const JudgeSchema = Type.Object(
  {
    scores: Type.Array(
      Type.Object({
        option: Type.String({ description: "the option letter, e.g. A" }),
        score: Type.Number({ description: "0-10 quality for this deliverable" }),
        reason: Type.String({ description: "one sentence" }),
      }),
    ),
    winner: Type.String({ description: "the option letter of the best output" }),
  },
  { additionalProperties: true },
);
type JudgeRaw = Static<typeof JudgeSchema>;

function buildJudgeTool() {
  let captured: JudgeRaw | undefined;
  const tool = defineTool({
    name: "submit_scores",
    label: "Submit Scores",
    description: "Submit a 0-10 quality score and one-sentence reason for every option, plus the winning option letter.",
    parameters: JudgeSchema,
    execute: async (_id, params: JudgeRaw) => {
      captured = params;
      return { content: [{ type: "text", text: `Scored ${params.scores.length} options; winner ${params.winner}.` }], details: {} };
    },
  });
  return { tool, get: () => captured };
}

/** Judge anonymised outputs (A, B, C…) on one rubric for the task's capability. */
async function judge(task: Task, entries: BakeoffEntry[], judgeCand: Candidate): Promise<{ scores: JudgeScore[]; winner?: string; judgeId: string }> {
  const scored = entries.filter((e) => !e.error && e.output);
  if (scored.length < 2) return { scores: [], winner: undefined, judgeId: id(judgeCand) };

  const letters = scored.map((_, i) => String.fromCharCode(65 + i)); // A, B, C…
  const blocks = scored.map((e, i) => `### Option ${letters[i]}\n${e.output}`).join("\n\n");
  const authStorage = AuthStorage.create();
  const registry = ModelRegistry.create(authStorage);
  const model = resolvePiModel(registry, judgeCand.provider, judgeCand.model);
  const { tool, get } = buildJudgeTool();
  const { session } = await createAgentSession({
    model,
    authStorage,
    modelRegistry: registry,
    thinkingLevel: "medium",
    noTools: "all",
    customTools: [tool],
    tools: ["submit_scores"],
  });

  const prompt = [
    `You are judging ${scored.length} anonymous attempts at the same ${task.capability} task. Be a strict, fair critic.`,
    `Task: ${task.title}`,
    "",
    `Score each option 0-10 on how well it delivers a high-quality ${task.capability} result (correctness, completeness, clarity, usefulness). Then pick the single best.`,
    "Call submit_scores exactly once with a score+reason for EVERY option letter and the winner.",
    "",
    blocks,
  ].join("\n");

  try {
    await session.prompt(prompt);
    let raw = get();
    for (let i = 0; i < 2 && !raw; i++) {
      await session.prompt("Call submit_scores now with a score for every option letter and the winner.");
      raw = get();
    }
    addSessionCost(session.getSessionStats().cost);
    if (!raw) return { scores: [], winner: undefined, judgeId: id(judgeCand) };

    const byLetter = new Map(letters.map((l, i) => [l, scored[i]!]));
    const scores: JudgeScore[] = raw.scores
      .map((s) => {
        const e = byLetter.get(s.option.trim().toUpperCase().slice(0, 1));
        return e ? { model: id(e), score: s.score, reason: s.reason } : undefined;
      })
      .filter((x): x is JudgeScore => !!x);
    const winEntry = byLetter.get(String(raw.winner).trim().toUpperCase().slice(0, 1));
    return { scores, winner: winEntry ? id(winEntry) : undefined, judgeId: id(judgeCand) };
  } finally {
    session.dispose();
  }
}

export interface BakeoffOptions {
  /** Model that scores the outputs. Defaults to the first candidate. */
  judge?: Candidate;
  onProgress?: (msg: string) => void;
}

/** Run the full bake-off: every candidate on the task, then judge. */
export async function runBakeoff(task: Task, candidates: Candidate[], opts: BakeoffOptions = {}): Promise<BakeoffResult> {
  const log = opts.onProgress ?? (() => {});
  const entries: BakeoffEntry[] = [];
  for (const c of candidates) {
    log(`running ${id(c)}…`);
    const e = await runCandidate(task, c);
    log(e.error ? `  ${id(c)}: ERROR ${e.error}` : `  ${id(c)}: $${e.cost.toFixed(4)}  ${(e.ms / 1000).toFixed(1)}s  ${e.outputTokens} tok`);
    entries.push(e);
  }
  const judgeCand = opts.judge ?? candidates[0]!;
  log(`judging with ${id(judgeCand)}…`);
  const { scores, winner, judgeId } = await judge(task, entries, judgeCand);
  return { task, entries, scores, winner, judge: judgeId };
}

/** Convenience: build a one-off Task for a capability/difficulty from a prompt. */
export function bakeoffTask(prompt: string, capability: Capability, difficulty: Difficulty = "medium"): Task {
  return { id: "BAKE", title: prompt, capability, difficulty, dependsOn: [], estTokens: estimateTokens(capability, difficulty) };
}
