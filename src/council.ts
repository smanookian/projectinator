// Council planning (opt-in "deep plan"). Three perspectives propose epics from
// different lenses in parallel, then a synthesizer merges them into one ordered
// epic list. The user approves the epics; expansion into tasks happens after,
// via the normal decomposer seeded with these epics.

import {
  AuthStorage,
  ModelRegistry,
  createAgentSession,
  defineTool,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { Backend, Provider } from "./types.js";
import { findEntry } from "./registry.js";
import { resolvePiModel } from "./executor.js";
import { addSessionCost } from "./session-cost.js";

export interface Epic {
  name: string;
  rationale: string;
}

const EpicsSchema = Type.Object(
  {
    epics: Type.Array(
      Type.Object(
        { name: Type.String(), rationale: Type.String({ description: "one line: why this epic exists" }) },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
);
type EpicsRaw = Static<typeof EpicsSchema>;

function buildEpicsTool(toolName: string) {
  let captured: EpicsRaw | undefined;
  const tool = defineTool({
    name: toolName,
    label: "Submit Epics",
    description: "Submit the epic list. Call exactly once.",
    parameters: EpicsSchema,
    execute: async (_id, params) => {
      captured = params as EpicsRaw;
      return { content: [{ type: "text", text: `Got ${params.epics.length} epics.` }], details: {} };
    },
  });
  return { tool, get: () => captured };
}

function lastAssistantText(session: AgentSession): string {
  const msgs = session.messages as Array<{ role?: string; content?: unknown }>;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role !== "assistant") continue;
    const c = m.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((p: unknown) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : "")).join("");
  }
  return "";
}

interface Ctx {
  backend: Backend;
  modelOverride?: { provider: Provider; model: string };
}

async function runEpicAgent(idea: string, system: string, toolName: string, ctx: Ctx): Promise<Epic[]> {
  const authStorage = AuthStorage.create();
  const registry = ModelRegistry.create(authStorage);
  const { entry } = findEntry("plan", "mid");
  const pick = ctx.modelOverride ?? entry.byBackend[ctx.backend];
  try {
    const model = resolvePiModel(registry, pick.provider, pick.model);
    const { tool, get } = buildEpicsTool(toolName);
    const { session } = await createAgentSession({
      model,
      authStorage,
      modelRegistry: registry,
      thinkingLevel: "low",
      noTools: "all",
      customTools: [tool],
      tools: [toolName],
    });
    try {
      await session.prompt(`${system}\n\n--- REQUEST ---\n${idea}`);
      let raw = get();
      if (!raw) { await session.prompt(`Call ${toolName} now.`); raw = get(); }
      addSessionCost(session.getSessionStats().cost);
      return (raw?.epics ?? [])
        .map((e) => ({ name: String(e.name ?? "").trim(), rationale: String(e.rationale ?? "").trim() }))
        .filter((e) => e.name);
    } finally {
      session.dispose();
    }
  } catch {
    return [];
  }
}

const LENSES: { key: string; system: string }[] = [
  {
    key: "architect",
    system:
      "You are the ARCHITECT on a planning council. Propose the EPICS (big areas of work) for this build " +
      "from a TECHNICAL structure lens — components, data, integration, scaffolding. 3-6 epics, each a short " +
      "name + one-line rationale. Call submit_epics_architect once.",
  },
  {
    key: "product",
    system:
      "You are the PRODUCT lead on a planning council. Propose the EPICS from a USER-VALUE lens — the features " +
      "and flows a user needs, in priority order. 3-6 epics, each a short name + one-line rationale. Call " +
      "submit_epics_product once.",
  },
  {
    key: "risk",
    system:
      "You are the RISK/QA lead on a planning council. Propose the EPICS from a WHAT-COULD-GO-WRONG lens — " +
      "validation, edge cases, error/empty states, testing, and anything easy to forget. 3-6 epics, each a " +
      "short name + one-line rationale. Call submit_epics_risk once.",
  },
];

const SYNTH_SYSTEM = [
  "You are the PROJECT MANAGER chairing a planning council. Three leads proposed epics from different lenses",
  "(architect, product, risk). Merge them into ONE clean, ordered epic list for the build: dedupe overlaps,",
  "keep what matters, drop noise, and order them the way the work should proceed. Aim for 3-7 epics. Each epic:",
  "a short name + a one-line rationale that folds in the strongest point(s) from the leads. Call submit_epics once.",
].join("\n");

export interface CouncilResult {
  epics: Epic[];
  proposals: { lens: string; epics: Epic[] }[];
}

/** Run the council: 3 lenses in parallel, then synthesize. Falls back to a single
 *  lens's epics if synthesis fails; empty only if everything fails. */
export async function councilEpics(idea: string, ctx: Ctx): Promise<CouncilResult> {
  const proposalsRaw = await Promise.all(
    LENSES.map((l) => runEpicAgent(idea, l.system, `submit_epics_${l.key}`, ctx).then((epics) => ({ lens: l.key, epics }))),
  );
  const proposals = proposalsRaw.filter((p) => p.epics.length);
  if (!proposals.length) return { epics: [], proposals: [] };

  // Synthesize.
  const authStorage = AuthStorage.create();
  const registry = ModelRegistry.create(authStorage);
  const { entry } = findEntry("plan", "mid");
  const pick = ctx.modelOverride ?? entry.byBackend[ctx.backend];
  try {
    const model = resolvePiModel(registry, pick.provider, pick.model);
    const { tool, get } = buildEpicsTool("submit_epics");
    const { session } = await createAgentSession({
      model, authStorage, modelRegistry: registry, thinkingLevel: "low",
      noTools: "all", customTools: [tool], tools: ["submit_epics"],
    });
    try {
      const block = proposals
        .map((p) => `### ${p.lens}\n${p.epics.map((e) => `- ${e.name}: ${e.rationale}`).join("\n")}`)
        .join("\n\n");
      await session.prompt(`${SYNTH_SYSTEM}\n\n--- REQUEST ---\n${idea}\n\n--- LEAD PROPOSALS ---\n${block}`);
      let raw = get();
      if (!raw) { await session.prompt("Call submit_epics now."); raw = get(); }
      addSessionCost(session.getSessionStats().cost);
      const epics = (raw?.epics ?? [])
        .map((e) => ({ name: String(e.name ?? "").trim(), rationale: String(e.rationale ?? "").trim() }))
        .filter((e) => e.name);
      // Fall back to the largest single proposal if synthesis produced nothing.
      const best = proposals.slice().sort((a, b) => b.epics.length - a.epics.length)[0]!.epics;
      return { epics: epics.length ? epics : best, proposals };
    } finally {
      session.dispose();
    }
  } catch {
    const best = proposals.slice().sort((a, b) => b.epics.length - a.epics.length)[0]!.epics;
    return { epics: best, proposals };
  }
}
