// Phase 4 entry — run a whole build end to end.
//
//   npm run build -- "an idea"                 dry: decompose + toposort + routing plan, NO spend
//   npm run build -- --mini                     dry: tiny fixed 3-task backlog (design->code->test)
//   npm run build -- --live --mini              LIVE: run the mini backlog (cheap end-to-end)
//   npm run build -- --live --lock anthropic "an idea"   LIVE: full pipeline on one provider
//
// --lock <provider> routes every role to one provider (use the one you hold a key for).
// Default lock is anthropic.

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { Provider, Task } from "./types.js";
import { DEFAULT_POLICY } from "./router.js";
import { toposort, runBacklog, type OrchestratorEvent } from "./orchestrator.js";
import { lockRegistryToProvider, makePiExecutor } from "./roles.js";
import { estimateTokens } from "./estimate.js";
import { route } from "./router.js";
import { decomposeIdea } from "./pm.js";
import { newBuildState, saveState, loadState, type BuildState } from "./build-state.js";
import { initRepo, commitTask } from "./git.js";

const args = process.argv.slice(2);
const live = args.includes("--live");
const mini = args.includes("--mini");
const fan = args.includes("--fan");
const resume = args.includes("--resume");
const lockIdx = args.indexOf("--lock");
const lockProvider = (lockIdx >= 0 ? args[lockIdx + 1] : "anthropic") as Provider;
const concIdx = args.indexOf("--concurrency");
const concurrency = Math.max(1, parseInt((concIdx >= 0 ? args[concIdx + 1] : "1") ?? "1", 10) || 1);
const consumed = new Set(
  ["--live", "--mini", "--fan", "--resume", "--lock", lockIdx >= 0 ? args[lockIdx + 1] : "",
    "--concurrency", concIdx >= 0 ? args[concIdx + 1] : ""].filter(Boolean),
);
const idea = args.filter((a) => !consumed.has(a)).join(" ").trim() ||
  "A one-page site with a headline and a contact form.";

const money = (n: number) => `$${n.toFixed(2)}`;
const registry = lockRegistryToProvider(lockProvider);
const policy = { ...DEFAULT_POLICY, backendMode: "api" as const, budgetCapUSD: mini ? 10 : 25 };

// --- a tiny fixed backlog for cheap end-to-end proof ---
function miniBacklog(): Task[] {
  const mk = (id: string, cap: Task["capability"], diff: Task["difficulty"], title: string, deps: string[] = []): Task => ({
    id, title, capability: cap, difficulty: diff, dependsOn: deps, estTokens: estimateTokens(cap, diff),
  });
  return [
    mk("D-1", "design", "low", "Write a short design spec for a centered card that says 'Hello from Projectinator' on a soft gradient background."),
    mk("C-1", "code", "low", "Create index.html implementing the design spec exactly. Single self-contained file with embedded CSS.", ["D-1"]),
    mk("T-1", "test", "trivial", "Open/read index.html and verify it is valid HTML and matches the design spec (centered card, the headline text, a gradient).", ["C-1"]),
  ];
}

// A fan-out backlog with independent branches, to show parallel execution:
// two design tasks (independent) -> two code tasks -> one test that joins them.
function fanBacklog(): Task[] {
  const mk = (id: string, cap: Task["capability"], diff: Task["difficulty"], title: string, deps: string[] = []): Task => ({
    id, title, capability: cap, difficulty: diff, dependsOn: deps, estTokens: estimateTokens(cap, diff),
  });
  return [
    mk("DA", "design", "low", "Design spec for a 'Newsletter signup' card (email input + button)."),
    mk("DB", "design", "low", "Design spec for an 'FAQ' accordion (3 questions)."),
    mk("CA", "code", "low", "Create newsletter.html from the newsletter design spec.", ["DA"]),
    mk("CB", "code", "low", "Create faq.html from the FAQ design spec.", ["DB"]),
    mk("TJ", "test", "trivial", "Verify newsletter.html and faq.html are valid and match their specs.", ["CA", "CB"]),
  ];
}

async function getTasks(): Promise<Task[]> {
  if (fan) return fanBacklog();
  if (mini) return miniBacklog();
  if (!live) {
    // Dry + full idea: we can't call the PM without spending, so show the mini path.
    console.log("  (Full-idea decomposition needs the PM model. Use --mini for a dry preview, or add --live.)\n");
    return miniBacklog();
  }
  console.log("  Decomposing idea with PM...\n");
  const res = await decomposeIdea(idea, {
    backend: "api",
    modelOverride: { provider: lockProvider, model: lockRegistryToProvider(lockProvider).find((e) => e.capability === "plan")!.byBackend.api.model },
  });
  console.log(`  PM produced ${res.tasks.length} tasks.\n`);
  return res.tasks;
}

const variant = fan ? " / fan" : mini ? " / mini" : "";
console.log(`\n  Projectinator — Phase 4 full build   [${live ? "LIVE" : "DRY"}${variant}]   lock=${lockProvider}   concurrency=${concurrency}\n`);
if (!mini && !fan) console.log(`  Idea: ${idea}\n`);

let tasks = await getTasks();

// Dry: show plan only.
if (!live) {
  const ordered = toposort(tasks);
  console.log("  Execution order (toposorted):");
  let est = 0;
  for (const t of ordered) {
    const d = route(t, { policy, registry, runningTotalBefore: est });
    est = d.runningTotal;
    const dep = t.dependsOn?.length ? ` <- ${t.dependsOn.join(",")}` : "";
    console.log(`    ${t.id.padEnd(6)} [${t.capability}/${t.difficulty}] -> ${d.model.name.padEnd(20)} ${money(d.cost)}${dep}`);
  }
  console.log(`\n  Estimated total: ${money(est)}   (cap ${money(policy.budgetCapUSD)})`);
  console.log("  Dry run. Add --live to actually build.\n");
  process.exit(0);
}

// Live: key check.
const envKey: Record<Provider, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
};
if (!(envKey[lockProvider] ?? []).some((k) => process.env[k])) {
  console.error(`  No API key for ${lockProvider}. Set: ${(envKey[lockProvider] ?? []).join(", ")}\n`);
  process.exit(1);
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspace = join(projectRoot, ".workspace", fan ? "fan-build" : mini ? "mini-build" : "build");
mkdirSync(workspace, { recursive: true });
const statePath = join(workspace, "build-state.json");

// Resume: load prior state, reuse its saved backlog, seed finished outcomes.
let state: BuildState;
let seedOutcomes = undefined;
const prior = resume ? loadState(statePath) : undefined;
if (prior) {
  state = prior;
  state.status = "running";
  tasks = prior.tasks; // authoritative backlog from the interrupted run
  seedOutcomes = prior.outcomes;
  const doneCount = new Set(prior.outcomes.map((o) => o.taskId)).size;
  console.log(`  Resuming: ${doneCount} task(s) already done, restored ${money(prior.totalCost)}.`);
} else {
  if (resume) console.log("  (No prior state found — starting fresh.)");
  state = newBuildState(fan ? "fan-build" : mini ? "mini-build" : "build", tasks);
}
console.log(`  Workspace: ${workspace}\n  Building...\n`);

// Version the workspace + commit after each task.
initRepo(workspace);
const titleById = new Map(tasks.map((t) => [t.id, t.title]));

const onEvent = (_e: AgentSessionEvent) => {};
const executor = makePiExecutor({
  workspace,
  backend: "api",
  onEvent,
  onFallback: (info) => console.log(`    ↪ ${info.taskId}: ${info.from} failed — fell back to ${info.to}/${info.model}`),
});

const onProgress = (e: OrchestratorEvent) => {
  if (e.type === "task_start") console.log(`  ▶ ${e.task.id} [${e.task.capability}] -> ${e.provider}/${e.modelId} (round ${e.round})`);
  else if (e.type === "task_done") {
    const hash = commitTask(workspace, e.outcome.taskId, titleById.get(e.outcome.taskId) ?? e.outcome.taskId);
    console.log(`    ✓ ${e.outcome.taskId} ${money(e.outcome.cost)}  running ${money(e.runningTotal)}${e.outcome.verdict ? `  verdict=${e.outcome.verdict.passed ? "PASS" : "FAIL"}` : ""}${hash ? `  [${hash}]` : ""}`);
  }
  else if (e.type === "task_skipped") console.log(`    · ${e.taskId} skipped (already done)`);
  else if (e.type === "test_failed") console.log(`    ✗ ${e.taskId} FAILED (${e.bugs} bugs) — round ${e.round}`);
  else if (e.type === "retry_dev") console.log(`    ↻ re-running ${e.taskId} to fix ${e.forTest}`);
  else if (e.type === "budget_halt") console.log(`    ⚠ BUDGET HALT at ${money(e.runningTotal)} (cap ${money(e.cap)})`);
};

// Checkpoint after every task so a crash/cancel loses at most one task.
const onCheckpoint = (outcomes: typeof state.outcomes, totalCost: number) => {
  state.outcomes = outcomes;
  state.totalCost = totalCost;
  saveState(state, statePath);
};

const result = await runBacklog(tasks, { policy, execute: executor, registry, onProgress, seedOutcomes, onCheckpoint, concurrency });

state.outcomes = result.outcomes;
state.totalCost = result.totalCost;
state.status = result.halted ? "halted" : "complete";
state.haltReason = result.haltReason;
saveState(state, statePath);

console.log(`\n  --- BUILD ${result.halted ? "HALTED" : "COMPLETE"} ---`);
console.log(`  Steps run: ${result.outcomes.length}`);
console.log(`  Total cost: ${money(result.totalCost)}`);
if (result.haltReason) console.log(`  Halt reason: ${result.haltReason}  (re-run with --resume to continue)`);
const finalFiles = result.outcomes.at(-1)?.files ?? [];
console.log(`  Files in workspace: ${finalFiles.join(", ") || "(none)"}`);
console.log(`  State saved: ${statePath}\n`);
