// Phase 3 — the PM / Decomposer.
// Turns a one-line idea into a tagged backlog (epic -> story -> task).
//
// Structured output: Pi has none built in, so we force it. The PM model is given
// exactly ONE tool — submit_backlog, whose typebox schema IS the backlog shape —
// and must call it. That's far more reliable than parsing JSON out of prose.
//
// Token estimates are NOT asked of the model (it's bad at them); we fill them from
// code buckets after decomposition. The PM only decomposes + tags.

import {
  createAgentSession,
  defineTool,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { Backend, Capability, Difficulty, Provider, ReviewPolicy, Task } from "./types.js";
import { estimateTokens } from "./estimate.js";
import { findEntry } from "./registry.js";
import { piRuntime, resolvePiModel } from "./executor.js";
import { addSessionCost } from "./session-cost.js";

// ---- typebox schema = the backlog contract ----
// DELIBERATELY PERMISSIVE. A forced-tool call fails INVISIBLY if the args don't
// validate (Pi rejects it, our capture never fires). So: flat list, only id/title/
// capability/difficulty required, capability/difficulty as free strings (coerced in
// code), extra fields allowed. We validate/clean afterwards instead of at the gate.
const TaskSchema = Type.Object(
  {
    id: Type.String({ description: "Unique task id, e.g. T-01" }),
    title: Type.String({ description: "One concrete, buildable unit of work" }),
    capability: Type.String({ description: "one of: plan | design | code | review | test | ops" }),
    difficulty: Type.String({ description: "one of: trivial | low | medium | high" }),
    dependsOn: Type.Optional(Type.Array(Type.String(), { description: "task ids that must finish first" })),
    epic: Type.Optional(Type.String({ description: "optional grouping label" })),
    story: Type.Optional(Type.String({ description: "optional grouping label" })),
  },
  { additionalProperties: true },
);
const BacklogSchema = Type.Object({ tasks: Type.Array(TaskSchema) }, { additionalProperties: true });

const CAPS = new Set<Capability>(["plan", "design", "code", "review", "test", "ops"]);
const DIFFS = new Set<Difficulty>(["trivial", "low", "medium", "high"]);
function coerceCap(s: string): Capability {
  const v = s?.toLowerCase().trim() as Capability;
  return CAPS.has(v) ? v : "code";
}
function coerceDiff(s: string): Difficulty {
  const v = s?.toLowerCase().trim() as Difficulty;
  return DIFFS.has(v) ? v : "medium";
}

export type Backlog = Static<typeof BacklogSchema>;
export type BacklogTask = Static<typeof TaskSchema>;

// ---- the capture tool ----
export function buildBacklogTool() {
  let captured: Backlog | undefined;
  const tool = defineTool({
    name: "submit_backlog",
    label: "Submit Backlog",
    description: "Submit the finished backlog as a flat list of tasks. Call this exactly once.",
    parameters: BacklogSchema,
    execute: async (_id, params) => {
      captured = params as Backlog;
      return { content: [{ type: "text", text: `Backlog received: ${params.tasks.length} tasks.` }], details: {} };
    },
  });
  return { tool, get: () => captured };
}

export type Scope = "full" | "change";

export function pmSystemPrompt(scope: Scope = "full"): string {
  const sizing =
    scope === "change"
      ? [
          "This is a CHANGE to an EXISTING project whose files are already on disk.",
          "Produce the FEWEST tasks that accomplish the change — usually 1 code task plus 1",
          "`review` task that dependsOn it (cheap read-only wiring check) only when the change is",
          "`high` difficulty, plus 1 test task only if the change is risky. Do NOT re-plan the",
          "whole project, do NOT add design/setup/deploy tasks. One small tweak = one code task.",
        ]
      : [
          "Scale the number of tasks to the request. A tiny page = a few tasks; a full app = many.",
          "Group tasks under EPICS (big features/areas of the product). Set every task's `epic`",
          "field to its epic name, e.g. 'Hero section', 'Contact form', 'Deployment'. Aim for",
          "2-5 tasks per epic. Do not pad: never split one obvious unit of work into multiple",
          "tasks. Skip design/plan/ops tasks when the request clearly doesn't need them.",
          "For a MULTI-FILE app: name the target file(s) in each code task's title (e.g. 'Build",
          "src/components/Header.jsx') and keep file names CONSISTENT across tasks — decide one",
          "structure and reuse it. When several files must agree, add ONE early design task that",
          "defines the file tree, and have the code tasks depend on it.",
          "For each code task whose difficulty is `high`, add one `review` task that dependsOn it",
          "(a cheap read-only wiring check). Do NOT add reviews for low/medium code tasks — the",
          "Tester runs the app and covers them. The test task must dependsOn the review task(s)",
          "where they exist, else the code tasks. Order: design -> code -> [review] -> test.",
        ];
  return [
    "You are the PROJECT MANAGER on an autonomous software team.",
    "Break the user's request into a flat list of tasks.",
    ...sizing,
    "",
    "Each TASK must be:",
    "- atomic: one model can complete it in one focused turn",
    "- tagged with a capability: plan | design | code | review | test | ops",
    "- tagged with a difficulty: trivial | low | medium | high (how hard the thinking is)",
    "Optional per task: dependsOn (ids that must finish first, e.g. code depends on design),",
    "and epic/story labels for grouping. Use ids like T-01, unique across the list.",
    "Order matters: a design task should precede the code task that implements it; tests come after code.",
    "",
    "CRITICAL: You have exactly ONE tool — submit_backlog — and you MUST call it with a",
    "`tasks` array. Never reply with prose. Never ask the user a question. If anything is",
    "unclear, make a reasonable assumption (e.g. the main file is index.html) and submit.",
    "Always produce at least one task. Call submit_backlog exactly once.",
  ].join("\n");
}

// ---- pure post-processing (testable, no model) ----

export interface NormalizeResult {
  backlog: Backlog;
  diagnostics: string[];
}

/** Clean a raw backlog: drop duplicate task ids, strip dangling dependsOn refs, and apply the
 *  review policy. The policy is enforced here rather than trusted to the PM prompt: a model that
 *  adds a review anyway would otherwise quietly spend the money. Dropping a review rewires
 *  whatever depended on it (the test task) onto the review's own code dependencies, so the
 *  test still waits for the code it is testing. */
export function normalizeBacklog(raw: Backlog, reviewPolicy: ReviewPolicy = "all"): NormalizeResult {
  const diagnostics: string[] = [];
  const seen = new Set<string>();
  const allIds = new Set(raw.tasks.map((t) => t.id));

  const tasks = raw.tasks
    .filter((t) => {
      if (seen.has(t.id)) {
        diagnostics.push(`dropped duplicate task id ${t.id}`);
        return false;
      }
      seen.add(t.id);
      return true;
    })
    .map((t) => {
      const deps = (t.dependsOn ?? []).filter((d) => {
        if (!allIds.has(d)) {
          diagnostics.push(`task ${t.id}: dropped dangling dependsOn ${d}`);
          return false;
        }
        return true;
      });
      return { ...t, dependsOn: deps };
    });

  // Apply the review policy. "all" keeps every review the PM planned.
  if (reviewPolicy !== "all") {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const isReview = (t: { capability: string }) => coerceCap(t.capability) === "review";
    // Key on the difficulty of the CODE being reviewed, not the review task's own difficulty —
    // reviews are cheap/low by construction, so testing their own field drops every one.
    const reviewsHardCode = (t: (typeof tasks)[number]) =>
      (t.dependsOn ?? []).some((d) => {
        const dep = byId.get(d);
        return !!dep && coerceCap(dep.capability) === "code" && coerceDiff(dep.difficulty) === "high";
      });
    const keep = (t: (typeof tasks)[number]) =>
      !isReview(t) || (reviewPolicy === "high" && reviewsHardCode(t));
    const dropped = new Set(tasks.filter((t) => !keep(t)).map((t) => t.id));
    if (dropped.size) {
      // Inherit the dropped review's dependencies so a test that waited on the review now waits
      // on the code the review was reading.
      const inherited = (id: string): string[] => {
        const r = byId.get(id);
        return (r?.dependsOn ?? []).flatMap((d) => (dropped.has(d) ? inherited(d) : [d]));
      };
      const rewired = tasks
        .filter((t) => !dropped.has(t.id))
        .map((t) => {
          const deps = (t.dependsOn ?? []).flatMap((d) => (dropped.has(d) ? inherited(d) : [d]));
          return { ...t, dependsOn: [...new Set(deps)] };
        });
      diagnostics.push(
        `review policy "${reviewPolicy}": dropped ${dropped.size} review task(s) (${[...dropped].join(", ")})`,
      );
      return { backlog: { tasks: rewired }, diagnostics };
    }
  }

  return { backlog: { tasks }, diagnostics };
}

/** Flatten a backlog to routable Tasks, coercing loose tags + filling token estimates. */
export function flattenBacklog(backlog: Backlog): Task[] {
  return backlog.tasks.map((t) => {
    const capability = coerceCap(t.capability);
    const difficulty = coerceDiff(t.difficulty);
    return {
      id: t.id,
      title: t.title,
      capability,
      difficulty,
      dependsOn: t.dependsOn ?? [],
      epic: t.epic,
      story: t.story,
      estTokens: estimateTokens(capability, difficulty),
    };
  });
}

// ---- text fallback: parse a task list out of prose if the tool wasn't used ----

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
        .join("");
    }
  }
  return "";
}

/** Best-effort: pull a { tasks: [...] } (or a bare [...]) out of a model's text reply. */
export function extractBacklogFromText(text: string): Backlog | undefined {
  const tryParse = (s: string): Backlog | undefined => {
    try {
      const p = JSON.parse(s) as unknown;
      if (Array.isArray(p)) return { tasks: p as Backlog["tasks"] };
      if (p && typeof p === "object" && Array.isArray((p as { tasks?: unknown }).tasks)) return p as Backlog;
    } catch {
      /* not json */
    }
    return undefined;
  };
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const objMatch = text.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
  const arrMatch = text.match(/\[[\s\S]*\]/);
  for (const c of [fence?.[1], objMatch?.[0], arrMatch?.[0]]) {
    if (!c) continue;
    const r = tryParse(c.trim());
    if (r?.tasks?.length) return r;
  }
  return undefined;
}

// ---- live decomposition (calls the PM model, spends money) ----

export interface DecomposeOptions {
  backend: Backend;
  thinkingLevel?: "off" | "low" | "medium" | "high";
  onEvent?: Parameters<import("@earendil-works/pi-coding-agent").AgentSession["subscribe"]>[0];
  /** Override the PM model (else resolved from registry plan/mid). */
  modelOverride?: { provider: Provider; model: string };
  /** "change" = minimal tasks against an existing project; "full" = a fresh build. */
  scope?: Scope;
  /** Summary of the existing project (files + contents) so the PM plans with real context. */
  projectContext?: string;
  /** Council-approved epics: organize ALL tasks under exactly these. */
  epics?: { name: string; rationale: string }[];
  /** Which code tasks get a Reviewer pass. Enforced on the returned backlog, not just asked
   *  for in the prompt. Default "all" keeps whatever the PM planned. */
  reviewPolicy?: ReviewPolicy;
}

export interface DecomposeResult {
  provider: Provider;
  modelId: string;
  backlog: Backlog;
  tasks: Task[];
  diagnostics: string[];
}

export async function decomposeIdea(idea: string, opts: DecomposeOptions): Promise<DecomposeResult> {
  const runtime = await piRuntime();

  // PM = plan capability, mid tier — unless the caller overrides the model.
  const { entry } = findEntry("plan", "mid");
  const pick = opts.modelOverride ?? entry.byBackend[opts.backend];
  const model = resolvePiModel(runtime, pick.provider, pick.model);

  const { tool, get } = buildBacklogTool();
  const { session } = await createAgentSession({
    model,
    modelRuntime: runtime,
    thinkingLevel: opts.thinkingLevel ?? "medium",
    noTools: "all",
    customTools: [tool],
    tools: ["submit_backlog"],
  });

  const unsub = opts.onEvent ? session.subscribe(opts.onEvent) : undefined;
  try {
    const ctx = opts.projectContext ? `\n\n--- EXISTING PROJECT (plan the change against this) ---\n${opts.projectContext}` : "";
    const epicsBlock = opts.epics?.length
      ? `\n\n--- APPROVED EPICS (organize ALL tasks under EXACTLY these; set each task's epic field to one of these names) ---\n${opts.epics.map((e) => `- ${e.name}: ${e.rationale}`).join("\n")}`
      : "";
    await session.prompt(`${pmSystemPrompt(opts.scope ?? "full")}${ctx}${epicsBlock}\n\n--- REQUEST ---\n${idea}`);
    let raw = get();
    // Nudge up to 3 times if the tool wasn't called (or its args failed validation).
    for (let i = 0; i < 3 && !raw; i++) {
      await session.prompt(
        "You did not call submit_backlog successfully. Call submit_backlog NOW with a `tasks` " +
          "array as the tool arguments. Do not write prose. Make reasonable assumptions if needed.",
      );
      raw = get();
    }
    // Last resort: the model may have printed the backlog as JSON text — parse it.
    if (!raw) raw = extractBacklogFromText(lastAssistantText(session));
    if (!raw || !raw.tasks?.length) {
      const stats = session.getSessionStats();
      if (stats.tokens.total === 0) {
        // The provider call returned nothing — bad/inaccessible key, OR (very common)
        // the account has no credit/balance so the API rejects the request.
        throw new Error(
          `The ${pick.provider} model returned nothing (0 tokens). Likely causes: the API key is invalid, ` +
            `the account has no credit/balance, or the key lacks access to ${pick.model}. Add credit or set a ` +
            `working key, or pick a different provider in Settings → Preferred provider.`,
        );
      }
      const said = lastAssistantText(session).slice(0, 200).replace(/\s+/g, " ").trim();
      throw new Error(
        `The planner didn't return a task list.${said ? ` It said: "${said}…"` : ""} Try rephrasing the request.`,
      );
    }

    const { backlog, diagnostics } = normalizeBacklog(raw, opts.reviewPolicy ?? "all");
    return {
      provider: pick.provider,
      modelId: pick.model,
      backlog,
      tasks: flattenBacklog(backlog),
      diagnostics,
    };
  } finally {
    addSessionCost(session.getSessionStats().cost);
    unsub?.();
    session.dispose();
  }
}
