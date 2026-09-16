// Model bake-off — the founding idea: run ONE task across several models, then
// compare cost, latency, and quality so you can pick the best model per role and
// feed that back into the routing registry.
//
// TEXT roles (plan, design, test-reasoning): each candidate answers, one judge model
// scores the anonymised outputs.
// CODE: each candidate builds the task in its own scratch folder with the real
// developer tooling, then the real Tester (headless browser + interaction) runs against
// it; the verdict is the score — no judge model, no opinion.
// Pareto: entries no other beats on both quality and cost are marked.

import {
  createAgentSession,
  defineTool,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { Capability, Difficulty, Provider, Task, Verdict } from "./types.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePiExecutor } from "./roles.js";
import { getModel } from "./models.js";
import { DEFAULT_POLICY } from "./router.js";
import { piRuntime, resolvePiModel } from "./executor.js"
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
  /** Code bake-off: where this candidate built, and what the Tester found. */
  dir?: string;
  verdict?: Verdict;
  files?: string[];
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
  judge?: string; // judge model id (text) or the tester model (code)
  /** Quality/$ frontier: models no other candidate beats on both score and cost. */
  pareto: string[];
  /** Best score per dollar among entries of passing quality (score ≥ 6). */
  bestValue?: string;
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
    const runtime = await piRuntime();
    const model = resolvePiModel(runtime, cand.provider, cand.model);
    const { session } = await createAgentSession({
      model,
      modelRuntime: runtime,
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
      if (stats.tokens.total === 0) out.error = "returned 0 tokens (invalid key, no credit/balance, or no model access)";
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
  const runtime = await piRuntime();
  const model = resolvePiModel(runtime, judgeCand.provider, judgeCand.model);
  const { tool, get } = buildJudgeTool();
  const { session } = await createAgentSession({
    model,
    modelRuntime: runtime,
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

// ---- code bake-off: build in a scratch folder, let the real Tester score it ----

/** Tester verdict → 0-10. PASS = 10 (9 if the app was only read, not run); every bug costs
 *  by severity (high 3, medium 2, low 1); a FAIL never scores above 5. */
export function scoreVerdict(v: Verdict): number {
  const penalty = v.bugs.reduce((n, b) => n + (b.severity === "high" ? 3 : b.severity === "medium" ? 2 : 1), 0);
  if (v.passed) return Math.max(6, (v.runtimeChecked ? 10 : 9) - penalty);
  return Math.max(0, 5 - penalty);
}

const decisionFor = (task: Task, cand: Candidate) => {
  const model = getModel(cand.model);
  return { taskId: task.id, backend: "api" as const, provider: cand.provider, model, tier: "high" as const, cost: 0, runningTotal: 0, overCap: false, reasons: ["bake-off"] };
};

async function runCodeCandidate(task: Task, cand: Candidate, tester: Candidate, log: (m: string) => void): Promise<BakeoffEntry> {
  const dir = mkdtempSync(join(tmpdir(), `bakeoff-${cand.model.replace(/[^a-z0-9.-]/gi, "_")}-`));
  const base: BakeoffEntry = { provider: cand.provider, model: cand.model, output: "", cost: 0, ms: 0, outputTokens: 0, dir };
  const limits = DEFAULT_POLICY.taskLimits;
  const exec = makePiExecutor({ workspace: dir, backend: "api", noFallback: true });
  try {
    const t0 = Date.now();
    const built = await exec({ task, decision: decisionFor(task, cand), contextText: "", round: 0, limits });
    const ms = Date.now() - t0;
    log(`  ${id(cand)}: built ${built.files.length} file(s)  $${built.cost.toFixed(4)}  ${(ms / 1000).toFixed(1)}s — testing…`);
    const testTask: Task = { id: `${task.id}-TEST`, title: `Test: ${task.title}`, capability: "test", difficulty: task.difficulty, dependsOn: [task.id], estTokens: task.estTokens };
    const tested = await exec({ task: testTask, decision: decisionFor(testTask, tester), contextText: `Context from upstream work:\n\n### From ${task.id} (code):\n${built.finalText}`, round: 0, limits });
    const verdict = tested.verdict ?? { passed: false, bugs: [{ severity: "high", description: "tester returned no verdict" }], runtimeChecked: false };
    return { ...base, output: built.finalText, cost: Math.round(built.cost * 10000) / 10000, ms, outputTokens: 0, files: built.files, verdict };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Pareto frontier + best value over scored, error-free entries. */
export function paretoFront(entries: BakeoffEntry[], scores: JudgeScore[]): { pareto: string[]; bestValue?: string } {
  const scored = entries.filter((e) => !e.error).map((e) => ({ key: id(e), cost: e.cost, score: scores.find((s) => s.model === id(e))?.score })).filter((x): x is { key: string; cost: number; score: number } => x.score !== undefined);
  const pareto = scored.filter((a) => !scored.some((b) => b !== a && b.score >= a.score && b.cost <= a.cost && (b.score > a.score || b.cost < a.cost))).map((x) => x.key);
  const value = (x: { score: number; cost: number }) => x.score / Math.max(x.cost, 1e-6);
  const best = scored.filter((x) => x.score >= 6).sort((a, b) => value(b) - value(a) || b.score - a.score)[0];
  return { pareto, bestValue: best?.key };
}

export interface BakeoffOptions {
  /** Text roles: the model that scores the outputs. Defaults to the first candidate. */
  judge?: Candidate;
  /** Code: the Tester model that runs each build. Defaults to the first candidate. */
  tester?: Candidate;
  onProgress?: (msg: string) => void;
}

/** Run the full bake-off: every candidate on the task, then judge (text) or test (code). */
export async function runBakeoff(task: Task, candidates: Candidate[], opts: BakeoffOptions = {}): Promise<BakeoffResult> {
  const log = opts.onProgress ?? (() => {});
  const entries: BakeoffEntry[] = [];
  if (task.capability === "code") {
    const tester = opts.tester ?? candidates[0]!;
    for (const c of candidates) {
      log(`building with ${id(c)}…`);
      const e = await runCodeCandidate(task, c, tester, log);
      log(e.error ? `  ${id(c)}: ERROR ${e.error}` : `  ${id(c)}: ${e.verdict!.passed ? "PASS" : "FAIL"} (${e.verdict!.bugs.length} bug(s))`);
      entries.push(e);
    }
    const scores: JudgeScore[] = entries.filter((e) => !e.error && e.verdict).map((e) => ({
      model: id(e), score: scoreVerdict(e.verdict!),
      reason: e.verdict!.passed ? (e.verdict!.runtimeChecked ? "Tester ran it: PASS" : "Tester read it: PASS* (not run)") : `Tester: FAIL — ${e.verdict!.bugs.slice(0, 2).map((b) => b.description).join("; ")}`,
    }));
    const top = [...scores].sort((a, b) => b.score - a.score || (entries.find((e) => id(e) === a.model)!.cost - entries.find((e) => id(e) === b.model)!.cost))[0];
    return { task, entries, scores, winner: scores.length >= 2 ? top?.model : undefined, judge: id(tester), ...paretoFront(entries, scores) };
  }
  for (const c of candidates) {
    log(`running ${id(c)}…`);
    const e = await runCandidate(task, c);
    log(e.error ? `  ${id(c)}: ERROR ${e.error}` : `  ${id(c)}: $${e.cost.toFixed(4)}  ${(e.ms / 1000).toFixed(1)}s  ${e.outputTokens} tok`);
    entries.push(e);
  }
  const judgeCand = opts.judge ?? candidates[0]!;
  log(`judging with ${id(judgeCand)}…`);
  const { scores, winner, judgeId } = await judge(task, entries, judgeCand);
  return { task, entries, scores, winner, judge: judgeId, ...paretoFront(entries, scores) };
}

/** Parse "provider:model" or bare model ids (provider guessed: slug with "/" → openrouter,
 *  else the given default). */
export function parseCandidates(spec: string, defaultProvider: Provider): Candidate[] {
  return spec.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = /^(anthropic|openai|google|openrouter|local):(.+)$/.exec(s);
    if (m) return { provider: m[1] as Provider, model: m[2]! };
    return { provider: s.includes("/") ? "openrouter" : defaultProvider, model: s };
  });
}

/** Convenience: build a one-off Task for a capability/difficulty from a prompt. */
export function bakeoffTask(prompt: string, capability: Capability, difficulty: Difficulty = "medium"): Task {
  return { id: "BAKE", title: prompt, capability, difficulty, dependsOn: [], estTokens: estimateTokens(capability, difficulty) };
}
