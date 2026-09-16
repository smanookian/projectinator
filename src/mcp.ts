// MCP server — lets other agents (Claude Desktop, Cursor, Pi, …) use Projectinator as a
// tool: plan an idea, start a build, watch it, steer it, list projects and the roster.
//
//   projectinator mcp        stdio transport (what MCP clients launch)
//
// Builds are long: `build` returns at once with the workspace; `build_status` reads the
// persisted build-state (works for builds from the app too); `build_control` steers builds
// started by THIS server process (pause / resume / stop / add work). Every call that
// spends money says so in its description.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { OrchestratorEvent } from "./orchestrator.js";
import { loadState, completedIds } from "./build-state.js";
import { stackInstruction, type StackChoice, type StackProfileId } from "./stack.js";
import { applyKeysToEnv, getPrefs } from "./tui/config.js";
import { availableProviders, planBuild, startBuild, listProjects, effectiveRoster, planExtraTasks, type RunHandle } from "./tui/engine.js";
import { getModel } from "./models.js";

const VERSION = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const json = (o: unknown) => text(JSON.stringify(o, null, 2));
const fail = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });

const stackChoiceFor = (stack: StackProfileId): StackChoice | undefined =>
  stack === "vite" ? { platform: "web", framework: "vite-react" } : stack === "node" ? { platform: "backend", framework: "node" } : undefined;

/** Builds started by this process: workspace → handle + recent events. */
const live = new Map<string, { handle: RunHandle; events: OrchestratorEvent[]; done?: { halted: boolean; haltReason?: string; totalCost: number } }>();

export function createServer(): McpServer {
  const server = new McpServer({ name: "projectinator", version: VERSION });

  server.registerTool("plan", {
    description: "Ask the PM to break an idea into a task backlog with a cost estimate. Spends one PM call (~$0.01). Nothing is built.",
    inputSchema: { idea: z.string().describe("what to build"), stack: z.enum(["static", "vite", "node"]).default("static") },
  }, async ({ idea, stack }) => {
    const providers = availableProviders();
    if (!providers.length) return fail("No API key found — set one in the Projectinator app or export ANTHROPIC_API_KEY / OPENROUTER_API_KEY / …");
    const choice = stackChoiceFor(stack);
    const plan = await planBuild(idea + (choice ? stackInstruction(choice) : ""), providers);
    return json({ provider: plan.provider, modelId: plan.modelId, estCostUSD: plan.estCost, tasks: plan.tasks.map((t) => ({ id: t.id, capability: t.capability, difficulty: t.difficulty, title: t.title, dependsOn: t.dependsOn ?? [], epic: t.epic })) });
  });

  server.registerTool("build", {
    description: "Plan and START building an idea (real spend, up to the budget cap). Returns immediately with the workspace path; poll build_status. Same workspace layout as the app, so the project appears there too.",
    inputSchema: {
      idea: z.string(),
      stack: z.enum(["static", "vite", "node"]).default("static"),
      budgetCapUSD: z.number().positive().optional().describe("default: your prefs"),
      concurrency: z.number().int().min(1).max(8).optional(),
    },
  }, async ({ idea, stack, budgetCapUSD, concurrency }) => {
    const providers = availableProviders();
    if (!providers.length) return fail("No API key found.");
    const prefs = getPrefs();
    const choice = stackChoiceFor(stack);
    const plan = await planBuild(idea + (choice ? stackInstruction(choice) : ""), providers);
    const events: OrchestratorEvent[] = [];
    const handle = startBuild(idea, plan, {
      concurrency: concurrency ?? prefs.concurrency,
      budgetCapUSD: budgetCapUSD ?? prefs.budgetCapUSD,
      taskLimits: { timeoutMs: prefs.taskTimeoutMin * 60_000, costCapUSD: prefs.taskCostCapUSD },
      onEvent: (e) => { events.push(e); if (events.length > 200) events.shift(); },
      mode: "auto",
      stack,
      parallelCode: prefs.parallelCode,
    });
    const entry = { handle, events };
    live.set(handle.workspace, entry);
    handle.promise.then((r) => { live.get(handle.workspace)!.done = { halted: r.halted, haltReason: r.haltReason, totalCost: r.totalCost }; }, (e) => { live.get(handle.workspace)!.done = { halted: true, haltReason: e instanceof Error ? e.message : String(e), totalCost: 0 }; });
    return json({ workspace: handle.workspace, tasks: plan.tasks.length, estCostUSD: plan.estCost, budgetCapUSD: budgetCapUSD ?? prefs.budgetCapUSD });
  });

  server.registerTool("build_status", {
    description: "Progress of a build: per-task status, spend, halt reason. Works for any project folder (from the app or this server).",
    inputSchema: { workspace: z.string().describe("path returned by build, or a project dir from projects") },
  }, async ({ workspace }) => {
    const state = loadState(join(workspace, "build-state.json"));
    if (!state) return fail(`No build-state.json in ${workspace}`);
    const done = completedIds(state);
    const running = new Set<string>();
    const entry = live.get(workspace);
    for (const e of entry?.events ?? []) {
      if (e.type === "task_start") running.add(e.task.id);
      else if (e.type === "task_done" || e.type === "task_failed") running.delete(e.outcome.taskId);
    }
    return json({
      status: state.status, haltReason: state.haltReason, totalCostUSD: state.totalCost,
      tasks: state.tasks.map((t) => ({ id: t.id, capability: t.capability, title: t.title, status: done.has(t.id) ? "done" : running.has(t.id) ? "running" : "pending" })),
      recent: (entry?.events ?? []).slice(-10).map((e) => e.type === "task_start" ? `▶ ${e.task.id} → ${e.provider}/${e.modelId}` : e.type === "task_done" ? `✓ ${e.outcome.taskId} $${e.outcome.cost}${e.outcome.verdict ? ` ${e.outcome.verdict.passed ? "PASS" : "FAIL"}` : ""}` : e.type),
      steerable: !!entry && !entry.done,
    });
  });

  server.registerTool("build_control", {
    description: "Steer a build started by this server: pause (running tasks finish, nothing new starts), resume, stop (halt after running tasks; resumable in the app), or add work (one PM call turns the request into tasks that join the backlog).",
    inputSchema: { workspace: z.string(), action: z.enum(["pause", "resume", "stop", "add"]), request: z.string().optional().describe("for add: what to add") },
  }, async ({ workspace, action, request }) => {
    const entry = live.get(workspace);
    if (!entry || entry.done) return fail("That build is not running in this server process (only builds started here can be steered).");
    const c = entry.handle.control;
    if (action === "pause") { c.pause(); return text("paused"); }
    if (action === "resume") { c.resume(); return text("resumed"); }
    if (action === "stop") { c.stop(); return text("stopping after the running tasks"); }
    if (!request?.trim()) return fail("add needs a request");
    const state = loadState(join(workspace, "build-state.json"));
    const extra = await planExtraTasks(request, state?.tasks ?? [], availableProviders(), workspace);
    if (!extra.length) return text("The PM found nothing new to add.");
    c.inject(extra);
    return json({ added: extra.map((t) => ({ id: t.id, capability: t.capability, title: t.title, dependsOn: t.dependsOn ?? [] })) });
  });

  server.registerTool("projects", { description: "List past builds with status, cost and workspace path." }, async () =>
    json(listProjects().map((p) => ({ slug: p.slug, workspace: p.dir, idea: p.idea, status: p.status, totalCostUSD: p.totalCost, tasks: p.taskCount, done: p.state.outcomes.filter((o) => !o.error).length }))));

  server.registerTool("models", { description: "The roster as it will run now: model per role with prices per 1M tokens." }, async () =>
    json(effectiveRoster().map((r) => { const m = r.model ? getModel(r.model) : undefined; return { role: r.label, model: r.model, provider: r.provider, inputPer1M: m?.cost.input, outputPer1M: m?.cost.output }; })));

  return server;
}

export async function serveStdio(): Promise<void> {
  applyKeysToEnv();
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
