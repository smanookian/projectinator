// Phase 4 — role definitions + the real Pi-backed executor.
//
// Each capability becomes a role with its own prompt and tool set. The Tester uses
// a forced typebox verdict tool (like the PM) so its pass/fail is structured, which
// the orchestrator's feedback loop depends on.

import {
  AuthStorage,
  ModelRegistry,
  createAgentSession,
  defineTool,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type {
  Backend,
  Capability,
  Provider,
  RegistryEntry,
  RoleExecutor,
  RoleResult,
  Task,
  Verdict,
} from "./types.js";
import { resolvePiModel } from "./executor.js";
import { renderCheck } from "./preview.js";
import { estimateCost } from "./cost.js";
import { getModel } from "./models.js";
import { addSessionCost } from "./session-cost.js";
import { recordActual } from "./calibration.js";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ---- role prompts ----

const ROLE_INTRO: Record<Capability, string> = {
  plan: "You are the PLANNER. Produce a concise plan or decision for this task as text.",
  design:
    "You are the DESIGNER. Produce a clear, concrete design spec (layout, components, colours, states) as text. " +
    "If the product spans multiple files, also specify the intended FILE STRUCTURE — name each file and say what it holds (e.g. index.html, styles.css, app.js, or a src/ tree). Do not write code files.",
  code:
    "You are the DEVELOPER. Write real, working files into the working directory — minimal, correct, no placeholders, no TODO stubs. " +
    "This is often a MULTI-FILE project: FIRST inspect what already exists (use ls, then read the relevant files) and BUILD ON it — " +
    "reuse and extend existing files, follow the file structure the design spec defines, and make sure files reference each other with correct paths " +
    "(imports/requires, <script src> and <link href>, relative paths). Create only the files this task needs; never delete or clobber files unrelated to your task.",
  test: "You are the TESTER. For a web app, FIRST call check_app to actually run it in a headless browser — confirm it renders, shows the expected content, and has no JavaScript/console errors. Then inspect the files against the task and check multi-file wiring (referenced files exist, paths/imports resolve). Then call submit_verdict with pass/fail and any bugs. A blank render or a JS error is a high-severity bug. Do not fix anything yourself.",
  ops: "You are OPS. Perform the operational task (build, config, deploy prep) using your tools. Report what you did as text.",
};

export function buildRolePrompt(task: Task, contextText: string): string {
  const lines = [
    ROLE_INTRO[task.capability],
    "",
    `Task ${task.id}: ${task.title}`,
    contextText ? `\n${contextText}` : "",
    "",
    task.capability === "test"
      ? "When finished, call submit_verdict exactly once."
      : "Complete the task, then stop. Do not explain at length.",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

// ---- tester verdict tool (forced structured output) ----

const VerdictSchema = Type.Object({
  passed: Type.Boolean({ description: "true if the build satisfies the task with no serious bugs" }),
  bugs: Type.Array(
    Type.Object({
      severity: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
      description: Type.String(),
      file: Type.Optional(Type.String()),
    }),
    { description: "empty if passed" },
  ),
});
type VerdictRaw = Static<typeof VerdictSchema>;

// ---- tester "run the app" tool: headless render + error capture ----

function buildCheckTool(workspace: string) {
  return defineTool({
    name: "check_app",
    label: "Run the app",
    description:
      "Render a built web page in a headless browser and report its title, the visible text, " +
      "and any JavaScript/console errors or failed asset requests. Use this on web apps to confirm " +
      "the app actually RUNS and renders before you judge it — do not rely on reading the code alone.",
    parameters: Type.Object(
      { file: Type.Optional(Type.String({ description: "HTML entry file to load; default index.html" })) },
      { additionalProperties: true },
    ),
    execute: async (_id, params: { file?: string }) => {
      try {
        const r = await renderCheck(workspace, params.file || "index.html");
        const text = [
          `rendered: ${r.ok ? "OK (no JS errors)" : "with errors"}`,
          `title: ${r.title || "(none)"}`,
          `errors: ${r.errors.length ? "\n  - " + r.errors.join("\n  - ") : "none"}`,
          `visible text:\n${r.text || "(empty page — nothing rendered)"}`,
        ].join("\n");
        return { content: [{ type: "text", text }], details: {} };
      } catch (e) {
        return {
          content: [{ type: "text", text: `check_app could not run (${e instanceof Error ? e.message : e}). If this isn't a web app with an HTML page, inspect the files directly instead.` }],
          details: {},
        };
      }
    },
  });
}

function buildVerdictTool() {
  let captured: Verdict | undefined;
  const tool = defineTool({
    name: "submit_verdict",
    label: "Submit Verdict",
    description: "Submit your pass/fail judgement and any bugs found.",
    parameters: VerdictSchema,
    execute: async (_id, params: VerdictRaw) => {
      captured = { passed: params.passed, bugs: params.bugs };
      return {
        content: [{ type: "text", text: `Verdict: ${params.passed ? "PASS" : "FAIL"} (${params.bugs.length} bugs)` }],
        details: {},
      };
    },
  });
  return { tool, get: () => captured };
}

// ---- provider lock: run the whole pipeline on one provider ----
// Useful when you hold a key for only one provider. Maps each capability+tier to
// that provider's sensible model, so route() resolves everything to it.

const PROVIDER_MODELS: Record<Provider, { strong: string; mid: string; cheap: string }> = {
  anthropic: { strong: "claude-opus-4-8", mid: "claude-sonnet-4-6", cheap: "claude-haiku-4-5" },
  openai: { strong: "gpt-5.6-sol", mid: "gpt-5.6-terra", cheap: "gpt-5.6-luna" },
  google: { strong: "gemini-3.1-pro-preview", mid: "gemini-3.1-pro-preview", cheap: "gemini-3-flash-preview" },
};

const CAP_STRENGTH: Record<Capability, "strong" | "mid" | "cheap"> = {
  plan: "mid",
  design: "strong",
  code: "strong",
  test: "cheap",
  ops: "strong",
};

/** A registry where every capability routes to one provider's models. */
export function lockRegistryToProvider(provider: Provider): RegistryEntry[] {
  const m = PROVIDER_MODELS[provider];
  const caps: Capability[] = ["plan", "design", "code", "test", "ops"];
  const tiers = ["fast", "mid", "high"] as const;
  const out: RegistryEntry[] = [];
  for (const capability of caps) {
    const modelId = m[CAP_STRENGTH[capability]];
    for (const tier of tiers) {
      out.push({
        capability,
        tier,
        byBackend: { web: { provider, model: modelId }, api: { provider, model: modelId } },
        updated: "provider-lock",
      });
    }
  }
  return out;
}

// ---- the real Pi executor ----

export interface PiExecutorOptions {
  workspace: string;
  backend: Backend;
  authStorage?: AuthStorage;
  thinkingLevel?: "off" | "low" | "medium" | "high";
  onEvent?: Parameters<AgentSession["subscribe"]>[0];
}

/** Extract the last assistant text from a session, tolerant of content shape. */
function lastAssistantText(session: AgentSession): string {
  const msgs = session.messages as Array<{ role?: string; content?: unknown }>;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role !== "assistant") continue;
    const c = m.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      return c
        .map((part: unknown) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && "text" in part) return String((part as { text: unknown }).text);
          return "";
        })
        .join("")
        .trim();
    }
  }
  return "";
}

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

/** Build a real RoleExecutor backed by Pi. Each call spends money. */
export function makePiExecutor(opts: PiExecutorOptions): RoleExecutor {
  return async ({ task, decision, contextText }) => {
    const authStorage = opts.authStorage ?? AuthStorage.create();
    const registry = ModelRegistry.create(authStorage);
    const model = resolvePiModel(registry, decision.provider, decision.model.id);

    const isTest = task.capability === "test";
    const verdictTool = isTest ? buildVerdictTool() : undefined;
    const checkTool = isTest ? buildCheckTool(opts.workspace) : undefined;

    const { session } = await createAgentSession({
      model,
      cwd: opts.workspace,
      authStorage,
      modelRegistry: registry,
      thinkingLevel: opts.thinkingLevel ?? "medium",
      ...(isTest
        ? { customTools: [verdictTool!.tool, checkTool!], tools: ["read", "bash", "ls", "grep", "find", "check_app", "submit_verdict"] }
        : { tools: ["read", "write", "edit", "bash", "ls", "grep", "find"] }),
    });

    const unsub = opts.onEvent ? session.subscribe(opts.onEvent) : undefined;
    try {
      // Give code/test the WHOLE current file tree (not just direct-dep files), so a
      // dev building one file knows every other file that already exists to wire into.
      let fullContext = contextText;
      if (task.capability === "code" || task.capability === "test") {
        const existing = listFiles(opts.workspace);
        if (existing.length) {
          fullContext = [contextText, `Files already in the working directory:\n${existing.map((f) => `  ${f}`).join("\n")}`]
            .filter(Boolean)
            .join("\n\n");
        }
      }
      await session.prompt(buildRolePrompt(task, fullContext));

      let verdict = verdictTool?.get();
      if (isTest && !verdict) {
        await session.followUp("Call submit_verdict now with your judgement.");
        verdict = verdictTool?.get();
      }

      const stats = session.getSessionStats();
      addSessionCost(stats.cost);
      // Feed the real usage back so estimates for this bucket sharpen over time.
      const inputTotal = stats.tokens.input + stats.tokens.cacheRead;
      recordActual(task.capability, task.difficulty, inputTotal, stats.tokens.output, inputTotal > 0 ? stats.tokens.cacheRead / inputTotal : 0);
      const result: RoleResult = {
        finalText: lastAssistantText(session),
        files: listFiles(opts.workspace),
        cost: round2(stats.cost),
        verdict,
      };
      return result;
    } finally {
      unsub?.();
      session.dispose();
    }
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// exported for tests
export { buildVerdictTool, VerdictSchema, estimateCost, getModel };
