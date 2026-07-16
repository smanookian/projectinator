// Intake — the PM's clarifying-questions step. Before planning a vague request,
// the PM asks 2-4 short questions (each with suggested options) to pin down what
// to build. A clear request returns no questions and skips straight to planning.
//
// Forced structured output, same discipline as pm.ts: one tool, permissive
// schema, coerced/validated in code.

import {
  AuthStorage,
  ModelRegistry,
  createAgentSession,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { Backend, Provider } from "./types.js";
import { findEntry } from "./registry.js";
import { resolvePiModel } from "./executor.js";
import { addSessionCost } from "./session-cost.js";

const IntakeSchema = Type.Object(
  {
    needsClarification: Type.Boolean({ description: "true only if the request is too vague to plan well" }),
    questions: Type.Array(
      Type.Object(
        {
          question: Type.String({ description: "one short clarifying question" }),
          options: Type.Array(Type.String(), { description: "2-4 concrete pickable answers; may be empty for free text" }),
          multi: Type.Boolean({ description: "true if several options can apply at once" }),
        },
        { additionalProperties: true },
      ),
      { description: "empty when needsClarification is false; at most 4" },
    ),
  },
  { additionalProperties: true },
);
type IntakeRaw = Static<typeof IntakeSchema>;

export interface IntakeQuestion {
  question: string;
  options: string[];
  multi: boolean;
}

function buildIntakeTool() {
  let captured: IntakeRaw | undefined;
  const tool = defineTool({
    name: "submit_intake",
    label: "Submit Intake",
    description: "Submit whether clarification is needed and, if so, the clarifying questions. Call exactly once.",
    parameters: IntakeSchema,
    execute: async (_id, params) => {
      captured = params as IntakeRaw;
      return { content: [{ type: "text", text: `Intake: ${params.needsClarification ? `${params.questions.length} questions` : "clear"}.` }], details: {} };
    },
  });
  return { tool, get: () => captured };
}

const SYSTEM = [
  "You are the PROJECT MANAGER doing intake for a build request.",
  "If the request already has enough detail to plan and build — its purpose and the",
  "must-have features are clear or reasonably inferable — set needsClarification=false",
  "and questions=[].",
  "If it is vague (a bare template like 'landing page', a one-liner missing the",
  "essentials), set needsClarification=true and produce 2-4 SHORT questions that most",
  "reduce ambiguity: what the product/business actually is, a name, must-have",
  "sections/features, and style. For each question give 2-4 concrete pickable options;",
  "set multi=true when several can apply (e.g. which sections). Never more than 4",
  "questions. Do not ask what you can reasonably assume. Call submit_intake exactly once.",
].join("\n");

export interface AssessOptions {
  backend: Backend;
  modelOverride?: { provider: Provider; model: string };
}

/** Ask the PM whether the request needs clarification; returns up to 4 questions
 *  (empty = clear enough to plan directly). Never throws — returns [] on trouble. */
export async function assessIntake(idea: string, opts: AssessOptions): Promise<IntakeQuestion[]> {
  const authStorage = AuthStorage.create();
  const registry = ModelRegistry.create(authStorage);
  const { entry } = findEntry("plan", "mid");
  const pick = opts.modelOverride ?? entry.byBackend[opts.backend];

  try {
    const model = resolvePiModel(registry, pick.provider, pick.model);
    const { tool, get } = buildIntakeTool();
    const { session } = await createAgentSession({
      model,
      authStorage,
      modelRegistry: registry,
      thinkingLevel: "low",
      noTools: "all",
      customTools: [tool],
      tools: ["submit_intake"],
    });
    try {
      await session.prompt(`${SYSTEM}\n\n--- REQUEST ---\n${idea}`);
      let raw = get();
      if (!raw) {
        await session.prompt("Call submit_intake now.");
        raw = get();
      }
      addSessionCost(session.getSessionStats().cost);
      if (!raw || !raw.needsClarification) return [];
      return (raw.questions ?? [])
        .slice(0, 4)
        .map((q) => ({
          question: String(q.question ?? "").trim(),
          options: (q.options ?? []).map((o) => String(o).trim()).filter(Boolean).slice(0, 6),
          multi: !!q.multi,
        }))
        .filter((q) => q.question);
    } finally {
      session.dispose();
    }
  } catch {
    return []; // never block a build on intake — fall through to planning
  }
}

/** Fold the collected answers into the brief the PM will plan from. */
export function enrichBrief(idea: string, answers: { question: string; answer: string }[]): string {
  const kept = answers.filter((a) => a.answer.trim());
  if (!kept.length) return idea;
  const lines = kept.map((a) => `- ${a.question} ${a.answer.trim()}`);
  return `${idea}\n\nClarifications from the requester:\n${lines.join("\n")}`;
}
