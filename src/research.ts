// Auto-feed the Scout — turn a research report into structured findings.
//
// The deep-research harness (or any benchmark write-up) produces prose. This module
// extracts it into clean Finding[] the Scout can consume: a model reads the report and
// calls a forced typebox tool. That's reliable because it's reformatting text we give
// it, not recalling facts from memory.
//
// Flow:  research report (text)  ->  extractFindings()  ->  findings.json  ->  scout --from

import {
  AuthStorage,
  ModelRegistry,
  createAgentSession,
  defineTool,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { Provider } from "./types.js";
import type { Finding } from "./scout.js";
import { resolvePiModel } from "./executor.js";
import { MODELS } from "./models.js";

const FindingsSchema = Type.Object({
  findings: Type.Array(
    Type.Object({
      capability: Type.Union([
        Type.Literal("plan"), Type.Literal("design"), Type.Literal("code"),
        Type.Literal("test"), Type.Literal("ops"),
      ]),
      tier: Type.Union([Type.Literal("fast"), Type.Literal("mid"), Type.Literal("high")]),
      backend: Type.Union([Type.Literal("web"), Type.Literal("api")]),
      provider: Type.Union([Type.Literal("anthropic"), Type.Literal("openai"), Type.Literal("google")]),
      model: Type.String({ description: "exact model id, e.g. claude-opus-4-8" }),
      evidence: Type.String({ description: "one-line benchmark/source justification" }),
    }),
  ),
});
type FindingsRaw = Static<typeof FindingsSchema>;

export interface ValidationIssue {
  index: number;
  model: string;
  problem: string;
}

/** Pure check: does each finding reference a real model with a matching provider? */
export function validateFindings(findings: Finding[]): { ok: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  findings.forEach((f, index) => {
    const m = MODELS[f.model];
    if (!m) {
      issues.push({ index, model: f.model, problem: "model not in models.ts" });
    } else if (m.provider !== f.provider) {
      issues.push({ index, model: f.model, problem: `provider mismatch (models.ts says ${m.provider})` });
    }
  });
  return { ok: issues.length === 0, issues };
}

function buildFindingsTool() {
  let captured: Finding[] | undefined;
  const tool = defineTool({
    name: "submit_findings",
    label: "Submit Findings",
    description: "Submit the extracted model-per-role findings.",
    parameters: FindingsSchema,
    execute: async (_id, params: FindingsRaw) => {
      captured = params.findings as Finding[];
      return { content: [{ type: "text", text: `Extracted ${params.findings.length} findings.` }], details: {} };
    },
  });
  return { tool, get: () => captured };
}

export function extractionPrompt(report: string): string {
  return [
    "You are a data extractor. From the research report below, extract the single best",
    "model for each role the report covers, as structured findings.",
    "",
    "For each finding set: capability (plan|design|code|test|ops), tier (fast|mid|high),",
    "backend (usually 'api' for benchmark-driven picks), provider, the EXACT model id,",
    "and a one-line evidence note. Only include roles the report actually supports.",
    "Do not invent models. When done, call submit_findings once.",
    "",
    "--- REPORT ---",
    report,
  ].join("\n");
}

export interface ExtractOptions {
  model: { provider: Provider; model: string };
  authStorage?: AuthStorage;
  onEvent?: Parameters<AgentSession["subscribe"]>[0];
}

/** Extract findings from a report via a model. Spends money (one model call). */
export async function extractFindings(report: string, opts: ExtractOptions): Promise<Finding[]> {
  const authStorage = opts.authStorage ?? AuthStorage.create();
  const registry = ModelRegistry.create(authStorage);
  const model = resolvePiModel(registry, opts.model.provider, opts.model.model);

  const { tool, get } = buildFindingsTool();
  const { session } = await createAgentSession({
    model, authStorage, modelRegistry: registry,
    thinkingLevel: "low",
    noTools: "all",
    customTools: [tool],
    tools: ["submit_findings"],
  });

  const unsub = opts.onEvent ? session.subscribe(opts.onEvent) : undefined;
  try {
    await session.prompt(extractionPrompt(report));
    let out = get();
    if (!out) {
      await session.followUp("Call submit_findings now.");
      out = get();
    }
    if (!out) throw new Error("Extractor did not call submit_findings.");
    return out;
  } finally {
    unsub?.();
    session.dispose();
  }
}

export { FindingsSchema, buildFindingsTool };
