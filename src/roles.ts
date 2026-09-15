// Phase 4 — role definitions + the real Pi-backed executor.
//
// Each capability becomes a role with its own prompt and tool set. The Tester uses
// a forced typebox verdict tool (like the PM) so its pass/fail is structured, which
// the orchestrator's feedback loop depends on.

import {
  createAgentSession,
  defineTool,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  TaskLimitError,
  type Backend,
  type Capability,
  type Provider,
  type RegistryEntry,
  type RoleExecutor,
  type RoleResult,
  type Task,
  type TaskLimits,
  type Verdict,
} from "./types.js";
import { piRuntime, resolvePiModel } from "./executor.js"
import { renderCheck, chromiumAvailable, CHROMIUM_INSTALL_HINT } from "./preview.js";
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
    "If the product spans multiple files, also specify the intended FILE STRUCTURE — name each file and say what it holds (e.g. index.html, styles.css, app.js, or a src/ tree). Do not write code files. " +
    "For a plain static site with no build step, DO NOT spec ES modules with relative imports (`<script type=\"module\">` + `import './x.js'`): browsers block those when the user double-clicks the file (file://), so the app looks dead. Prefer one classic `<script src>` (or a few, loaded in order) so it runs on double-click.",
  code:
    "You are the DEVELOPER. Write real, working files into the working directory — minimal, correct, no placeholders, no TODO stubs. " +
    "This is often a MULTI-FILE project: FIRST inspect what already exists (use ls, then read the relevant files) and BUILD ON it — " +
    "reuse and extend existing files, follow the file structure the design spec defines, and make sure files reference each other with correct paths " +
    "(imports/requires, <script src> and <link href>, relative paths). Create only the files this task needs; never delete or clobber files unrelated to your task. " +
    "MUST-RUN-ON-DOUBLE-CLICK: for a plain static site with no bundler/build step, the app has to work when the user just opens index.html as a file (file://). Do NOT use `<script type=\"module\">` with relative `import`s, and do not `fetch()` local files — browsers block both on file://, leaving a blank page. Split code with several plain `<script src>` tags in dependency order (globals), not ES modules. If the app genuinely needs a server (a real backend, bundler, or framework), write a short README.md with the exact run command.",
  review:
    "You are the REVIEWER. Do NOT edit files and do NOT run the app. Read the task, the design context, and the files in the working directory. " +
    "Check: every file the design named exists; every <script src> / <link href> / import resolves to a real file; nothing is referenced but never defined " +
    "(functions, element ids, CSS classes the JS relies on); a plain static site uses no ES modules or fetch() of local files (both break on double-click / file://); " +
    "and the task's stated deliverable is actually present. Report only real defects a developer must fix — not style. Then call submit_verdict exactly once.",
  test: "You are the TESTER. For a web app, FIRST call check_app to actually run it in a headless browser — it reports how the app renders BOTH served over http AND opened directly as a file (double-click / file://). Confirm it renders, shows the expected content, and has no JavaScript/console errors. The app MUST also work on double-click (file://) UNLESS a README documents how to run it — if check_app says double-click is BROKEN and there is no README with a run command, that is a HIGH-severity bug (report it, describe the file:// failure). Then inspect the files against the task and check multi-file wiring (referenced files exist, paths/imports resolve). Then call submit_verdict with pass/fail and any bugs. A blank render or a JS error is a high-severity bug. Do not fix anything yourself.",
  ops: "You are OPS. Perform the operational task (build, config, deploy prep) using your tools. Report what you did as text.",
};

export function buildRolePrompt(task: Task, contextText: string): string {
  const lines = [
    ROLE_INTRO[task.capability],
    "",
    `Task ${task.id}: ${task.title}`,
    contextText ? `\n${contextText}` : "",
    "",
    task.capability === "test" || task.capability === "review"
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

/** check_app + a flag telling whether a render actually happened this task. */
function buildCheckTool(workspace: string, chromium: boolean) {
  let rendered = false;
  const tool = defineTool({
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
      if (!chromium) {
        return {
          content: [{ type: "text", text: `check_app is UNAVAILABLE: headless Chromium is not installed (${CHROMIUM_INSTALL_HINT}). You cannot run the app. Review the files by reading them, say so in your verdict, and do not claim the app was executed.` }],
          details: {},
        };
      }
      try {
        const r = await renderCheck(workspace, params.file || "index.html");
        rendered = true;
        const doubleClick = r.doubleClickBroken
          ? "BROKEN — renders behind a server but is blank/erroring when opened directly as a file (double-click). "
            + "Most likely ES modules + relative imports (or fetch of local files), which browsers block on file://. "
            + "This is a real defect for a user who just opens the folder. Fix: use a classic non-module <script>, "
            + "or ship a README with a run command (e.g. `python3 -m http.server`)."
          : r.fileOk
            ? "OK (works on double-click too)"
            : `over file://: ${r.fileErrors.length ? r.fileErrors.join("; ") : "(empty page)"}`;
        const text = [
          `rendered (served over http): ${r.ok ? "OK (no JS errors)" : "with errors"}`,
          `title: ${r.title || "(none)"}`,
          `errors: ${r.errors.length ? "\n  - " + r.errors.join("\n  - ") : "none"}`,
          `opened as a file (double-click / file://): ${doubleClick}`,
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
  return { tool, rendered: () => rendered };
}

function buildVerdictTool(runtimeChecked: () => boolean) {
  let captured: Verdict | undefined;
  const tool = defineTool({
    name: "submit_verdict",
    label: "Submit Verdict",
    description: "Submit your pass/fail judgement and any bugs found.",
    parameters: VerdictSchema,
    execute: async (_id, params: VerdictRaw) => {
      captured = { passed: params.passed, bugs: params.bugs, runtimeChecked: runtimeChecked() };
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
  anthropic: { strong: "claude-opus-5", mid: "claude-sonnet-5", cheap: "claude-haiku-4-5" },
  openai: { strong: "gpt-5.6-sol", mid: "gpt-5.6-terra", cheap: "gpt-5.6-luna" },
  google: { strong: "gemini-3.1-pro-preview", mid: "gemini-3.1-pro-preview", cheap: "gemini-3.8-flash" },
  openrouter: { strong: "anthropic/claude-opus-5", mid: "anthropic/claude-sonnet-5", cheap: "google/gemini-3.8-flash" },
};

const CAP_STRENGTH: Record<Capability, "strong" | "mid" | "cheap"> = {
  plan: "mid",
  design: "strong",
  code: "strong",
  review: "cheap",
  test: "cheap",
  ops: "strong",
};

/** A registry where every capability routes to one provider's models. */
export function lockRegistryToProvider(provider: Provider): RegistryEntry[] {
  const m = PROVIDER_MODELS[provider];
  const caps: Capability[] = ["plan", "design", "code", "review", "test", "ops"];
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
  thinkingLevel?: "off" | "low" | "medium" | "high";
  onEvent?: Parameters<AgentSession["subscribe"]>[0];
  /** Called when a task falls back from its routed provider to another one. */
  onFallback?: (info: { taskId: string; from: Provider; to: Provider; model: string }) => void;
}

// Env vars that hold each provider's key (mirrors run-build's check).
const ENV_KEYS: Record<Provider, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
};

function providersWithKeys(): Provider[] {
  return (Object.keys(ENV_KEYS) as Provider[]).filter((p) => ENV_KEYS[p].some((k) => process.env[k]));
}

/** The routed model first, then the same-strength model on every OTHER provider
 *  that has a key — so a 0-token / errored provider falls back automatically. */
function fallbackChain(primary: Provider, primaryModel: string, cap: Capability): { provider: Provider; model: string }[] {
  const chain: { provider: Provider; model: string }[] = [{ provider: primary, model: primaryModel }];
  for (const p of providersWithKeys()) {
    if (p === primary) continue;
    chain.push({ provider: p, model: PROVIDER_MODELS[p][CAP_STRENGTH[cap]] });
  }
  return chain;
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
      // Tolerate broken symlinks / files removed mid-build; skip, don't abort the run.
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else out.push(relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

/** Build a real RoleExecutor backed by Pi. Each call spends money. Falls back to
 *  another key-holding provider when the routed one errors or returns 0 tokens. */
export function makePiExecutor(opts: PiExecutorOptions): RoleExecutor {
  // One attempt on a specific provider/model. Returns the result + total tokens
  // (0 tokens = the provider call didn't really happen → treat as a failure).
  const runOnce = async (
    task: Task,
    contextText: string,
    provider: Provider,
    modelId: string,
    limits: TaskLimits,
  ): Promise<{ result: RoleResult; tokensTotal: number }> => {
    const runtime = await piRuntime();
    const model = resolvePiModel(runtime, provider, modelId);

    const isTest = task.capability === "test";
    const isReview = task.capability === "review";
    const checkTool = isTest ? buildCheckTool(opts.workspace, await chromiumAvailable()) : undefined;
    // A review never runs the app, so its verdict is never "runtime checked".
    const verdictTool = isTest || isReview ? buildVerdictTool(checkTool ? checkTool.rendered : () => false) : undefined;

    const { session } = await createAgentSession({
      model,
      cwd: opts.workspace,
      modelRuntime: runtime,
      thinkingLevel: opts.thinkingLevel ?? "medium",
      ...(isTest
        ? { customTools: [verdictTool!.tool, checkTool!.tool], tools: ["read", "bash", "ls", "grep", "find", "check_app", "submit_verdict"] }
        : isReview
          ? { customTools: [verdictTool!.tool], tools: ["read", "ls", "grep", "find", "submit_verdict"] }
          : { tools: ["read", "write", "edit", "bash", "ls", "grep", "find"] }),
    });

    const unsub = opts.onEvent ? session.subscribe(opts.onEvent) : undefined;

    // Per-task limits. Cost is checked on every session event (Pi updates its stats as
    // each assistant turn lands); time by a timer. On breach the session is aborted and
    // the awaited prompt settles; we then throw so the orchestrator halts the build.
    let breach: TaskLimitError | undefined;
    const trip = (e: TaskLimitError) => {
      if (breach) return;
      breach = e;
      void session.abort();
    };
    const unsubCost = limits.costCapUSD > 0
      ? session.subscribe(() => {
          const spent = session.getSessionStats().cost;
          if (spent > limits.costCapUSD) trip(new TaskLimitError("cost", task.id, round2(spent), `spent $${spent.toFixed(2)} > per-task cap $${limits.costCapUSD}`));
        })
      : undefined;
    const timer = limits.timeoutMs > 0
      ? setTimeout(() => trip(new TaskLimitError("timeout", task.id, round2(session.getSessionStats().cost), `ran longer than ${Math.round(limits.timeoutMs / 60_000)} min`)), limits.timeoutMs)
      : undefined;
    try {
      // Give code/review/test the WHOLE current file tree (not just direct-dep files), so a
      // dev building one file knows every other file that already exists to wire into.
      let fullContext = contextText;
      if (task.capability === "code" || task.capability === "review" || task.capability === "test") {
        const existing = listFiles(opts.workspace);
        if (existing.length) {
          fullContext = [contextText, `Files already in the working directory:\n${existing.map((f) => `  ${f}`).join("\n")}`]
            .filter(Boolean)
            .join("\n\n");
        }
      }
      // An aborted prompt may reject with Pi's own error; the breach is the real cause.
      await session.prompt(buildRolePrompt(task, fullContext)).catch((e: unknown) => { if (!breach) throw e; });
      if (breach) throw breach;

      let verdict = verdictTool?.get();
      if (verdictTool && !verdict) {
        await session.followUp("Call submit_verdict now with your judgement.").catch((e: unknown) => { if (!breach) throw e; });
        verdict = verdictTool?.get();
      }
      if (breach) throw breach;

      const stats = session.getSessionStats();
      // Feed real usage back to sharpen estimates — but only for a real run.
      if (stats.tokens.total > 0) {
        const inputTotal = stats.tokens.input + stats.tokens.cacheRead;
        recordActual(task.capability, task.difficulty, inputTotal, stats.tokens.output, inputTotal > 0 ? stats.tokens.cacheRead / inputTotal : 0, modelId);
      }
      const result: RoleResult = {
        finalText: lastAssistantText(session),
        files: listFiles(opts.workspace),
        cost: round2(stats.cost),
        verdict,
      };
      return { result, tokensTotal: stats.tokens.total };
    } finally {
      clearTimeout(timer);
      unsubCost?.();
      addSessionCost(session.getSessionStats().cost); // bill every attempt, aborted or not
      unsub?.();
      session.dispose();
    }
  };

  return async ({ task, decision, contextText, limits }) => {
    const chain = fallbackChain(decision.provider, decision.model.id, task.capability);
    let lastErr: unknown;
    for (let i = 0; i < chain.length; i++) {
      const cand = chain[i]!;
      try {
        const att = await runOnce(task, contextText, cand.provider, cand.model, limits);
        if (att.tokensTotal > 0) {
          if (i > 0) opts.onFallback?.({ taskId: task.id, from: decision.provider, to: cand.provider, model: cand.model });
          return att.result;
        }
        lastErr = new Error(`${cand.provider}/${cand.model} returned 0 tokens (invalid key, no account credit/balance, or no access to this model)`);
      } catch (e) {
        if (e instanceof TaskLimitError) throw e; // a limit breach is final — never retry elsewhere
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("all providers failed");
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// exported for tests
export { buildCheckTool, buildVerdictTool, VerdictSchema, estimateCost, getModel };
