// Headless CLI — `projectinator <command>`. Same engine as the cockpit (engine.ts),
// same workspace root, so builds started here show up in the TUI's project list.
//
//   doctor                 check Node, keys, Chromium, Pi catalog, git
//   build "<idea>" [...]   plan + build without the TUI
//   projects               list past builds
//   update                 upgrade to the latest published version
//   models                 the roster as it will actually run, with prices
//
// The launcher (bin/projectinator.mjs) handles --version/--help itself and only
// spawns this file for a real command, so those stay instant.

import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { OrchestratorEvent } from "./orchestrator.js";
import type { Provider } from "./types.js";
import { MODELS, getModel } from "./models.js";
import { REGISTRY } from "./registry.js";
import { refreshOpenRouterModels } from "./openrouter.js";
import { scoutFromCatalog, formatScoutReport } from "./scout-feed.js";
import { proposeUpdate, formatProposal } from "./scout.js";
import { writeFileSync } from "node:fs";
import { piRuntime, resolvePiModel } from "./executor.js";
import { chromiumAvailable, CHROMIUM_INSTALL_HINT } from "./preview.js";
import { applyKeysToEnv, configPath, dataHome, getPrefs, getWebhookUrl, loadConfig, ENV_VAR, type KeyedProvider } from "./tui/config.js";
import { getLocalModels } from "./local-models.js";
import { postWebhook } from "./tui/notify.js";
import { stackInstruction, stackChoiceFor, type StackChoice, type StackProfileId } from "./stack.js";
import {
  availableProviders,
  effectiveRoster,
  listProjects,
  planBuild,
  projectRoot,
  tuiRoot,
  startBuild,
  PROVIDER_LABEL,
} from "./tui/engine.js";

const NODE_MIN = "22.19.0";

// `projectinator projects | head` closes our stdout early; that's not an error.
process.stdout.on("error", (e: NodeJS.ErrnoException) => { if (e.code === "EPIPE") process.exit(0); throw e; });
const money = (n: number) => `$${n.toFixed(2)}`;

// ---- tiny argv parser: `--flag value`, `--flag=value`, `--bool`, positionals ----

interface Argv {
  positional: string[];
  flags: Record<string, string | true>;
}

export function parseArgv(args: string[]): Argv {
  const out: Argv = { positional: [], flags: {} };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) { out.positional.push(a); continue; }
    const eq = a.indexOf("=");
    if (eq > 0) { out.flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--")) { out.flags[a.slice(2)] = next; i++; }
    else out.flags[a.slice(2)] = true;
  }
  return out;
}

function num(v: string | true | undefined, fallback: number): number {
  if (v === undefined || v === true) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function semverGte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return true;
}

// ---- doctor ----

type Check = { label: string; ok: boolean; detail: string; fatal?: boolean };

async function doctor(): Promise<number> {
  const checks: Check[] = [];

  const node = process.versions.node;
  checks.push({ label: "Node", ok: semverGte(node, NODE_MIN), detail: `v${node} (need ≥ ${NODE_MIN})`, fatal: true });

  const cfg = loadConfig();
  const providers = availableProviders();
  for (const p of Object.keys(ENV_VAR) as KeyedProvider[]) {
    const has = providers.includes(p);
    const src = cfg.keys[p] ? configPath() : has ? "env" : "";
    checks.push({ label: `Key: ${PROVIDER_LABEL[p]}`, ok: has, detail: has ? `set (${src})` : `not set — Settings → API keys, or export ${ENV_VAR[p]}` });
  }
  const local = getLocalModels();
  checks.push({ label: "Local models", ok: !!local, detail: local ? `${local.models.length} model${local.models.length === 1 ? "" : "s"} at ${local.baseUrl}` : "none — Settings → Local models (Ollama / LM Studio); optional" });
  if (providers.length === 0) checks.push({ label: "Any provider", ok: false, detail: "no keys and no local server — nothing can run", fatal: true });

  try {
    const runtime = await piRuntime();
    const bad: string[] = [];
    for (const e of REGISTRY) for (const b of ["api", "web"] as const) {
      try { resolvePiModel(runtime, e.byBackend[b].provider, e.byBackend[b].model); } catch { bad.push(`${e.capability}/${e.tier}/${b}`); }
    }
    checks.push({ label: "Pi model catalog", ok: bad.length === 0, detail: bad.length ? `unresolved: ${bad.join(", ")}` : `${Object.keys(MODELS).length} models priced, every registry pick resolves`, fatal: true });
  } catch (e) {
    checks.push({ label: "Pi model catalog", ok: false, detail: e instanceof Error ? e.message : String(e), fatal: true });
  }

  const chromium = await chromiumAvailable();
  checks.push({ label: "Headless Chromium", ok: chromium, detail: chromium ? "installed — tester runs the app" : `missing — tests will be code-reading only (PASS*); ${CHROMIUM_INSTALL_HINT}` });

  const npm = spawnSync("npm", ["--version"], { encoding: "utf8" });
  checks.push({ label: "npm", ok: npm.status === 0, detail: npm.status === 0 ? `v${npm.stdout.trim()} — Vite / Node stacks can install and build` : "not found — Vite / Node stacks won't build (static is unaffected)" });
  const py = spawnSync("python3", ["--version"], { encoding: "utf8" });
  checks.push({ label: "python3", ok: py.status === 0, detail: py.status === 0 ? `${py.stdout.trim() || py.stderr.trim()} — Python stack can create its venv` : "not found — the Python stack won't run (other stacks are unaffected)" });
  const git = spawnSync("git", ["--version"], { encoding: "utf8" });
  checks.push({ label: "git", ok: git.status === 0, detail: git.status === 0 ? git.stdout.trim() : "not found — builds won't be versioned (undo/history disabled)" });

  const home = join(homedir(), ".projectinator");
  try { mkdirSync(home, { recursive: true }); accessSync(home, constants.W_OK); checks.push({ label: "Data dir", ok: true, detail: home }); }
  catch { checks.push({ label: "Data dir", ok: false, detail: `${home} not writable`, fatal: true }); }

  const prefs = getPrefs();
  checks.push({ label: "Prefs", ok: true, detail: `budget cap ${money(prefs.budgetCapUSD)} · ${prefs.concurrency} at once · task limits ${prefs.taskTimeoutMin || "∞"} min / ${prefs.taskCostCapUSD ? money(prefs.taskCostCapUSD) : "∞"}` });

  console.log("\n  projectinator doctor\n");
  for (const c of checks) console.log(`  ${c.ok ? "✓" : c.fatal ? "✗" : "!"}  ${c.label.padEnd(22)} ${c.detail}`);
  const fatal = checks.filter((c) => !c.ok && c.fatal);
  const warn = checks.filter((c) => !c.ok && !c.fatal);
  console.log(`\n  ${fatal.length ? `${fatal.length} blocking problem${fatal.length === 1 ? "" : "s"}` : "Ready"}${warn.length ? ` · ${warn.length} warning${warn.length === 1 ? "" : "s"}` : ""}\n`);
  return fatal.length ? 1 : 0;
}

// ---- projects ----

function projects(): number {
  const list = listProjects();
  if (!list.length) { console.log("\n  No projects yet. Run `projectinator` or `projectinator build \"an idea\"`.\n"); return 0; }
  console.log("");
  for (const p of list) {
    const done = p.state.outcomes.filter((o) => !o.error).length;
    const mark = p.status === "complete" ? "✓" : p.status === "halted" ? "⚠" : "…";
    console.log(`  ${mark} ${p.slug.padEnd(40)} ${p.status.padEnd(9)} ${money(p.totalCost).padStart(8)}  ${done}/${p.taskCount} tasks`);
    console.log(`      ${p.idea.slice(0, 90)}${p.idea.length > 90 ? "…" : ""}`);
  }
  console.log(`\n  ${list.length} project${list.length === 1 ? "" : "s"} · ${money(list.reduce((a, p) => a + p.totalCost, 0))} all time · ${tuiRoot()}\n`);
  return 0;
}

// ---- update ----

/** How this copy was installed, which decides how it can be upgraded. */
export type InstallKind = "npm-global" | "npm-local" | "clone" | "docker";

export function installKind(modulePath: string, opts: { docker?: boolean; globalRoot?: string } = {}): InstallKind {
  if (opts.docker) return "docker";
  // `npm root -g` is the global node_modules; anything under it is the global install.
  if (opts.globalRoot && modulePath.startsWith(opts.globalRoot + sep)) return "npm-global";
  return modulePath.includes(`${sep}node_modules${sep}`) ? "npm-local" : "clone";
}

/** Latest published version, or null if npm can't be reached. */
async function latestVersion(): Promise<string | null> {
  try {
    const res = await fetch("https://registry.npmjs.org/projectinator/latest", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return typeof body.version === "string" ? body.version : null;
  } catch { return null; }
}

async function update(argv: Argv): Promise<number> {
  const current = JSON.parse(readFileSync(join(projectRoot(), "package.json"), "utf8")).version as string;
  const checkOnly = argv.flags.check === true;

  console.log(`\n  Installed: ${current}`);
  const latest = await latestVersion();
  if (!latest) { console.error("  Latest:    unknown — couldn't reach registry.npmjs.org\n"); return 1; }
  console.log(`  Latest:    ${latest}`);

  if (semverGte(current, latest)) { console.log("\n  Already up to date.\n"); return 0; }

  const kind = installKind(fileURLToPath(import.meta.url), {
    docker: existsSync("/.dockerenv"),
    globalRoot: spawnSync("npm", ["root", "-g"], { encoding: "utf8" }).stdout?.trim() || undefined,
  });

  // Only a global install can safely replace itself; everything else needs its own workflow.
  if (kind !== "npm-global") {
    const how = {
      clone: "you're running from a git clone — `git pull && npm install && npm run compile`",
      "npm-local": "this is a project dependency — `npm install projectinator@latest` in that project",
      docker: "you're in the Docker image — rebuild it to upgrade",
    }[kind];
    console.log(`\n  ${latest} is available, but ${how}.\n`);
    return 0;
  }

  if (checkOnly) { console.log(`\n  Run \`projectinator update\` to install ${latest}.\n`); return 0; }

  console.log(`\n  Updating to ${latest} …\n`);
  const r = spawnSync("npm", ["install", "-g", `projectinator@${latest}`], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("\n  npm failed. If it's a permissions error, either fix your npm prefix or re-run with sudo.\n");
    return 1;
  }
  console.log(`\n  Updated to ${latest}. Your projects and keys in ${dataHome()} are untouched.\n`);
  return 0;
}

// ---- models ----

function models(): number {
  const providers = availableProviders();
  console.log(`\n  Roster as it will run now${providers.length ? ` (keys: ${providers.join(", ")})` : " (no keys — best-of-breed picks shown)"}\n`);
  for (const r of effectiveRoster()) {
    const m = r.model ? getModel(r.model) : undefined;
    const price = m ? `$${m.cost.input}/$${m.cost.output} per 1M` : "";
    console.log(`  ${r.label.padEnd(18)} ${(r.model ?? "—").padEnd(28)} ${(r.provider ?? "").padEnd(11)} ${price}`);
  }
  console.log("\n  Change in the app: Settings → Models. Prices are from Pi's catalog; actual cost is measured per run.\n");
  return 0;
}

// ---- build ----

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const { promise, resolve } = Promise.withResolvers<string>();
  rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  return promise;
}

async function build(argv: Argv): Promise<number> {
  const idea = argv.positional.join(" ").trim();
  const json = argv.flags.json === true;
  const yes = json || argv.flags.yes === true || argv.flags.y === true;
  const dry = argv.flags["dry-run"] === true;
  const stackFlag = argv.flags.stack;
  const stack: StackProfileId = stackFlag === "vite" || stackFlag === "node" || stackFlag === "python" ? stackFlag : "static";
  if (typeof stackFlag === "string" && stackFlag !== stack) { console.error(`  build: unknown --stack "${stackFlag}" (static | vite | node | python)`); return 2; }
  const stackChoice: StackChoice | undefined = stackChoiceFor(stack);
  const emit = (o: Record<string, unknown>) => { if (json) process.stdout.write(JSON.stringify(o) + "\n"); };
  const say = (s: string) => { if (!json) console.log(s); };

  if (!idea) { console.error("  build: give an idea, e.g. projectinator build \"a tip calculator\""); return 2; }

  let providers = availableProviders();
  const lock = argv.flags.provider;
  if (typeof lock === "string") {
    if (!(lock in PROVIDER_LABEL)) { console.error(`  build: unknown provider "${lock}" (anthropic | openai | google | openrouter | local)`); return 2; }
    if (!providers.includes(lock as Provider)) { console.error(lock === "local" ? "  build: no local models configured — Settings → Local models" : `  build: no key for ${lock} — export ${ENV_VAR[lock as KeyedProvider]} or set it in the app`); return 1; }
    providers = [lock as Provider];
  }
  if (!providers.length) { console.error("  build: no API key found. Run `projectinator doctor`."); return 1; }

  const prefs = getPrefs();
  const budget = num(argv.flags.budget, prefs.budgetCapUSD);
  const concurrency = Math.max(1, Math.floor(num(argv.flags.concurrency, prefs.concurrency)));
  const taskLimits = {
    timeoutMs: num(argv.flags["task-timeout"], prefs.taskTimeoutMin) * 60_000,
    costCapUSD: num(argv.flags["task-cap"], prefs.taskCostCapUSD),
  };

  say(`\n  Planning with the PM (${providers.join("/")})…`);
  const plan = await planBuild(idea + (stackChoice ? stackInstruction(stackChoice) : ""), providers);
  emit({ event: "plan", provider: plan.provider, modelId: plan.modelId, estCost: plan.estCost, tasks: plan.tasks });
  say(`\n  ${plan.tasks.length} tasks · estimated ${money(plan.estCost)} · cap ${money(budget)}${plan.lock ? ` · locked to ${plan.lock}` : ""}\n`);
  for (const t of plan.tasks) {
    const dep = t.dependsOn?.length ? `  ← ${t.dependsOn.join(", ")}` : "";
    say(`    ${t.id.padEnd(6)} ${t.capability.padEnd(7)} ${t.difficulty.padEnd(8)} ${t.title}${dep}`);
  }
  if (plan.estCost > budget) say(`\n  ⚠ Estimate exceeds the cap — the build may halt partway.`);

  if (dry) { say("\n  Dry run — nothing built (the PM call above was the only spend).\n"); return 0; }
  if (!yes) {
    const a = await ask(`\n  Build it for ~${money(plan.estCost)}? [y/N] `);
    if (!/^y(es)?$/i.test(a)) { say("  Cancelled.\n"); return 0; }
  }

  const onEvent = (e: OrchestratorEvent) => {
    emit({ event: e.type, ...e });
    if (json) return;
    if (e.type === "task_start") console.log(`  ▶ ${e.task.id} [${e.task.capability}] → ${e.provider}/${e.modelId}${e.round ? ` (round ${e.round})` : ""}`);
    else if (e.type === "task_done") console.log(`    ✓ ${e.outcome.taskId} ${money(e.outcome.cost)}  running ${money(e.runningTotal)}${e.outcome.verdict ? `  ${e.outcome.verdict.passed ? (e.outcome.verdict.runtimeChecked || e.outcome.capability !== "test" ? "PASS" : "PASS* (app not executed)") : "FAIL"}` : ""}`);
    else if (e.type === "task_failed") console.log(`    ⛔ ${e.outcome.taskId} aborted: ${e.outcome.error} — billed ${money(e.outcome.cost)}`);
    else if (e.type === "task_skipped") console.log(`    · ${e.taskId} skipped`);
    else if (e.type === "merge_conflict") console.log(`    ⇄ ${e.taskId} conflicted with a parallel task on ${e.conflicts.join(", ")} — rebuilding serially`);
    else if (e.type === "task_added") console.log(`    + ${e.task.id} ${e.task.title} (added mid-build)`);
    else if (e.type === "task_removed") console.log(`    − ${e.taskId} removed`);
    else if (e.type === "paused") console.log(`    ‖ paused`);
    else if (e.type === "resumed") console.log(`    ▶ resumed`);
    else if (e.type === "test_failed") console.log(`    ✗ ${e.taskId} failed (${e.bugs} bugs) — round ${e.round}`);
    else if (e.type === "retry_dev") console.log(`    ↻ re-running ${e.taskId} to fix ${e.forTest}`);
    else if (e.type === "escalate") console.log(`    ⇧ ${e.rung === "respec" ? "Designer rewrites the spec" : "PM splits the task"} (${e.taskId}) for ${e.forTask}: ${e.detail}`);
    else if (e.type === "budget_halt") console.log(`    ⚠ budget halt at ${money(e.runningTotal)} (cap ${money(e.cap)})`);
    else if (e.type === "cycle_or_error") console.log(`    ✗ ${e.message}`);
  };

  say(`\n  Building…\n`);
  const parallelCode = argv.flags["parallel-code"] === true || (argv.flags["parallel-code"] === undefined && prefs.parallelCode);
  const handle = startBuild(idea, plan, { concurrency, budgetCapUSD: budget, taskLimits, onEvent, mode: "auto", stack, parallelCode });
  const r = await handle.promise;
  emit({ event: "done", halted: r.halted, haltReason: r.haltReason, totalCost: r.totalCost, files: r.files, workspace: handle.workspace });
  const hook = getWebhookUrl();
  if (hook) {
    const ok = await postWebhook(hook, { event: "build.finished", status: r.halted ? "halted" : "complete", haltReason: r.haltReason, idea, totalCost: r.totalCost, files: r.files, workspace: handle.workspace, at: new Date().toISOString() });
    emit({ event: "webhook", url: hook, ok });
    if (!ok) say(`  (webhook ${hook} did not accept the summary)`);
  }
  say(`\n  ${r.halted ? `⚠ Halted (${r.haltReason ?? "?"})` : "✓ Complete"} · ${money(r.totalCost)} · ${r.files.length} file${r.files.length === 1 ? "" : "s"}`);
  say(`  ${handle.workspace}\n`);
  return r.halted ? 3 : 0;
}

// ---- scout ----

/** Live OpenRouter catalog → price drift + new models from routed vendors + proposed
 *  registry changes. Read-only unless --findings writes the JSON for `npm run scout --from`. */
async function scout(argv: Argv): Promise<number> {
  const catalog = await refreshOpenRouterModels();
  if (!catalog.length) { console.error("  scout: could not fetch the OpenRouter catalog (offline?)."); return 1; }
  const r = scoutFromCatalog(catalog, MODELS, REGISTRY);
  console.log(`\n  projectinator scout — OpenRouter catalog, ${catalog.length} models\n`);
  console.log(formatScoutReport(r));
  const proposal = proposeUpdate(REGISTRY, r.findings);
  console.log("\n  Proposed registry changes (all need a human: new models are unknown to models.ts):");
  console.log(formatProposal(proposal.changes));
  const out = argv.flags["findings"];
  if (typeof out === "string") {
    writeFileSync(out, JSON.stringify({ findings: r.findings }, null, 2) + "\n");
    console.log(`\n  Wrote ${r.findings.length} finding(s) to ${out} — review, then: npm run scout -- --from ${out} --apply`);
  }
  console.log("");
  return 0;
}

// ---- main ----

const USAGE = `Usage: projectinator <command> [options]

  doctor                        check Node, API keys, Chromium, Pi catalog, git
  build "<idea>" [options]      plan + build headless (same workspace as the app)
      --dry-run                 plan and estimate only (spends one PM call)
      --yes, -y                 don't ask before building
      --json                    NDJSON events on stdout (implies --yes)
      --budget <usd>            cap for this build       (default: your prefs)
      --provider <name>         anthropic|openai|google|openrouter (default: prefs / keys)
      --concurrency <n>         tasks at once            (default: your prefs)
      --task-cap <usd>          per-task cost ceiling    (default: your prefs; 0 = off)
      --task-timeout <min>      per-task timeout         (default: your prefs; 0 = off)
      --stack static|vite|node|python   static (default), Vite+React+TS, Node server, Python server
      --parallel-code           independent code tasks build at once in git worktrees (default: prefs)
  projects                      list past builds with status and cost
  models                        the roster as it will run, with prices
  scout [--findings <file>]     live OpenRouter catalog: price drift, new models, proposed registry diff
  update [--check]              upgrade to the latest published version (--check only reports)
  mcp                           MCP server on stdio (tools: plan, build, build_status, build_control, projects, models)

Exit codes: 0 ok · 1 environment problem · 2 bad usage · 3 build halted`;

export async function main(args: string[]): Promise<number> {
  applyKeysToEnv();
  const argv = parseArgv(args);
  const cmd = argv.positional.shift();
  switch (cmd) {
    case "doctor": return doctor();
    case "projects": return projects();
    case "models": return models();
    case "scout": return scout(argv);
    case "mcp": { const { serveStdio } = await import("./mcp.js"); await serveStdio(); await new Promise(() => {}); return 0; }
    case "build": return build(argv);
    case "update": return update(argv);
    case undefined: case "help": console.log(USAGE); return cmd ? 0 : 2;
    default: console.error(`projectinator: unknown command "${cmd}".\n\n${USAGE}`); return 2;
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  process.exitCode = await main(process.argv.slice(2));
}
