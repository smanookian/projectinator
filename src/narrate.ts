// AI narrative for a build retro. Feeds the data-driven RetroReport to a model
// and gets back a short "what went well / what to improve" write-up. On-demand
// (costs a small call) and cached on the build state by the caller.

import {
  AuthStorage,
  ModelRegistry,
  createAgentSession,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { Backend, Provider } from "./types.js";
import type { RetroReport } from "./retro.js";
import { findEntry } from "./registry.js";
import { resolvePiModel } from "./executor.js";
import { addSessionCost } from "./session-cost.js";

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

/** Compact fact sheet the model reasons over — numbers, not prose. */
function facts(r: RetroReport): string {
  const lines = [
    `Idea: ${r.idea}`,
    `Status: ${r.status}. Tasks done: ${r.doneCount}/${r.taskCount}.`,
    `Cost: predicted $${r.estCost.toFixed(2)}, actual $${r.totalCost.toFixed(2)}.`,
    `Tests: ${r.tests.passed} passed, ${r.tests.failed} failed.`,
    r.retries.length ? `Rebuilds: ${r.retries.map((x) => `${x.taskId}×${x.rounds}`).join(", ")}.` : "Rebuilds: none.",
    `Cost by epic: ${r.byEpic.map((e) => `${e.epic} $${e.cost}`).join(", ") || "n/a"}.`,
    `Cost by model: ${r.byModel.map((m) => `${m.model} $${m.cost} (${m.tasks})`).join(", ") || "n/a"}.`,
    `Priciest tasks: ${r.topCost.map((t) => `${t.taskId} $${t.cost}`).join(", ") || "n/a"}.`,
    r.bugs.length
      ? `Tester flags: ${r.bugs.map((b) => `[${b.severity}] ${b.description}`).slice(0, 6).join("; ")}.`
      : "Tester flags: none.",
  ];
  return lines.join("\n");
}

const PROMPT = [
  "You are a pragmatic engineering lead writing a SHORT retro for this build.",
  "Use the facts below — reference the actual numbers. Do not invent anything.",
  "Write exactly three sections, terse bullets, under 140 words total:",
  "**What went well** (2-3 bullets)",
  "**What to improve** (2-3 bullets)",
  "**Next time** (one line)",
  "No preamble, no closing remarks.",
].join("\n");

export interface NarrateOptions {
  backend: Backend;
  modelOverride?: { provider: Provider; model: string };
}

/** Generate the narrative. Throws on failure (caller shows the error). */
export async function narrateRetro(report: RetroReport, opts: NarrateOptions): Promise<string> {
  const authStorage = AuthStorage.create();
  const registry = ModelRegistry.create(authStorage);
  const { entry } = findEntry("plan", "mid");
  const pick = opts.modelOverride ?? entry.byBackend[opts.backend];
  const model = resolvePiModel(registry, pick.provider, pick.model);

  const { session } = await createAgentSession({
    model,
    authStorage,
    modelRegistry: registry,
    thinkingLevel: "low",
    noTools: "all",
  });
  try {
    await session.prompt(`${PROMPT}\n\n--- FACTS ---\n${facts(report)}`);
    const text = lastAssistantText(session);
    if (!text) throw new Error("The model returned no narrative.");
    return text;
  } finally {
    addSessionCost(session.getSessionStats().cost);
    session.dispose();
  }
}
