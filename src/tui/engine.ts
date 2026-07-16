// Engine glue for the TUI — keeps all orchestration out of the React components.
// The UI calls these; they reuse the same core the CLI does.

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import type { Capability, Provider, RegistryEntry, Task, TaskOutcome, Tier } from "../types.js";
import { DEFAULT_POLICY, route } from "../router.js";
import { REGISTRY } from "../registry.js";
import { MODELS } from "../models.js";
import { loadRegistry, saveOverrides, OVERRIDES_FILENAME } from "../registry-store.js";
import { loadConfig } from "./config.js";
import { lockRegistryToProvider, makePiExecutor } from "../roles.js";
import { runBacklog, type OrchestratorEvent } from "../orchestrator.js";
import { decomposeIdea } from "../pm.js";
import { newBuildState, loadState, saveState, type BuildState } from "../build-state.js";

const PROVIDER_KEYS: Record<Provider, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
};

export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  google: "Google (Gemini)",
};

/** Which providers have a usable API key right now (presence only). */
export function availableProviders(): Provider[] {
  return (Object.keys(PROVIDER_KEYS) as Provider[]).filter((p) =>
    PROVIDER_KEYS[p].some((k) => !!process.env[k]),
  );
}

/** A locked-to-one-provider registry that still honors per-role model overrides
 *  (from Settings) when the chosen model belongs to that provider. */
function lockedRegistry(provider: Provider): RegistryEntry[] {
  const base = lockRegistryToProvider(provider);
  const overrides = loadRegistry(join(projectRoot(), OVERRIDES_FILENAME), REGISTRY);
  return base.map((e) => {
    const o = overrides.find((x) => x.capability === e.capability && x.tier === e.tier);
    if (o && o.byBackend.api.provider === provider) {
      const pick = { provider, model: o.byBackend.api.model };
      return { ...e, byBackend: { web: pick, api: pick } };
    }
    return e;
  });
}

/** Preferred provider wins (if it has a key); else one provider locks; else best-of-breed. */
export function chooseRegistry(providers: Provider[]): { registry: RegistryEntry[]; lock?: Provider } {
  const root = projectRoot();
  const seed = loadRegistry(join(root, OVERRIDES_FILENAME), REGISTRY);
  const pref = loadConfig().preferredProvider;
  if (pref && providers.includes(pref)) return { registry: lockedRegistry(pref), lock: pref };
  if (providers.length === 1) return { registry: lockedRegistry(providers[0]!), lock: providers[0] };
  return { registry: seed };
}

export function projectRoot(): string {
  // dist-agnostic: this file lives at <root>/src/tui/engine.ts
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

// ---- role -> model assignments (Settings) ----

/** The headline role slots shown in Settings (each capability at its main tier). */
export const ROLE_TIERS: { capability: Capability; tier: Tier; label: string }[] = [
  { capability: "plan", tier: "mid", label: "Project manager" },
  { capability: "design", tier: "high", label: "Designer" },
  { capability: "code", tier: "high", label: "Developer" },
  { capability: "test", tier: "fast", label: "Tester" },
  { capability: "ops", tier: "high", label: "Runner / ops" },
];

function overridesPath(): string {
  return join(projectRoot(), OVERRIDES_FILENAME);
}

export interface RoleAssignment {
  capability: Capability;
  tier: Tier;
  label: string;
  provider?: Provider;
  model?: string;
}

export function roleAssignments(): RoleAssignment[] {
  const reg = loadRegistry(overridesPath(), REGISTRY);
  return ROLE_TIERS.map((rt) => {
    const e = reg.find((x) => x.capability === rt.capability && x.tier === rt.tier);
    return { ...rt, provider: e?.byBackend.api.provider, model: e?.byBackend.api.model };
  });
}

/** The team as it will ACTUALLY run — honors the preferred/locked provider. */
export function effectiveRoster(): RoleAssignment[] {
  const { registry } = chooseRegistry(availableProviders());
  return ROLE_TIERS.map((rt) => {
    const e = registry.find((x) => x.capability === rt.capability && x.tier === rt.tier);
    return { ...rt, provider: e?.byBackend.api.provider, model: e?.byBackend.api.model };
  });
}

export function allModels(): { id: string; provider: Provider; name: string }[] {
  return Object.values(MODELS).map((m) => ({ id: m.id, provider: m.provider, name: m.name }));
}

/** Friendly model name for display (e.g. "claude-opus-4-8" -> "Claude Opus 4.8"). */
export function modelLabel(id: string): string {
  return MODELS[id]?.name ?? id;
}

/** Reassign a role's model across ALL tiers of that capability (so the role uses one
 *  model regardless of task difficulty) and persist to registry.overrides.json. */
export function setRoleModel(capability: Capability, _tier: Tier, modelId: string): void {
  const m = MODELS[modelId];
  if (!m) return;
  const reg: RegistryEntry[] = loadRegistry(overridesPath(), REGISTRY).map((e) => ({
    ...e,
    byBackend: { web: { ...e.byBackend.web }, api: { ...e.byBackend.api } },
  }));
  const pick = { provider: m.provider, model: modelId };
  for (const tier of ["fast", "mid", "high"] as Tier[]) {
    const entry = reg.find((x) => x.capability === capability && x.tier === tier);
    if (entry) {
      entry.byBackend.api = { ...pick };
      entry.evidence = "set in Settings";
    } else {
      reg.push({ capability, tier, byBackend: { web: { ...pick }, api: { ...pick } }, evidence: "set in Settings" });
    }
  }
  saveOverrides(reg, overridesPath());
}

export function slugify(idea: string): string {
  return idea.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "build";
}

export interface PlanResult {
  tasks: Task[];
  provider: Provider;
  modelId: string;
  estCost: number;
  registry: RegistryEntry[];
  lock?: Provider;
}

/** Per-task + total cost estimate for a set of tasks against a registry. */
export function estimateTasks(tasks: Task[], registry: RegistryEntry[]): { total: number; per: Map<string, number> } {
  const per = new Map<string, number>();
  let total = 0;
  for (const t of tasks) {
    const d = route(t, { policy: { ...DEFAULT_POLICY, backendMode: "api" }, registry, runningTotalBefore: total });
    per.set(t.id, d.cost);
    total = d.runningTotal;
  }
  return { total, per };
}

/** Drop dependsOn refs to tasks that no longer exist (after removals). */
export function cleanDeps(tasks: Task[]): Task[] {
  const valid = new Set(tasks.map((t) => t.id));
  return tasks.map((t) => ({ ...t, dependsOn: (t.dependsOn ?? []).filter((d) => valid.has(d)) }));
}

/** Decompose an idea and estimate the whole build's cost. Spends money (PM call). */
export async function planBuild(
  idea: string,
  providers: Provider[],
  scope: "full" | "change" = "full",
  workspace?: string,
): Promise<PlanResult> {
  const { registry, lock } = chooseRegistry(providers);
  const modelOverride = lock
    ? { provider: lock, model: registry.find((e) => e.capability === "plan")!.byBackend.api.model }
    : undefined;

  // On a change, hand the PM the existing project so it plans against what's really there.
  const projectContext = scope === "change" && workspace ? buildProjectContext(workspace) : undefined;
  const res = await decomposeIdea(idea, { backend: "api", modelOverride, scope, projectContext });
  const { total } = estimateTasks(res.tasks, registry);
  return { tasks: res.tasks, provider: res.provider, modelId: res.modelId, estCost: total, registry, lock };
}

// ---- past projects (the start-screen list + resume) ----

export interface ProjectInfo {
  slug: string;
  dir: string;
  idea: string;
  status: "running" | "complete" | "halted";
  totalCost: number;
  taskCount: number;
  files: string[];
  mtimeMs: number;
  state: BuildState;
}

function tuiRoot(): string {
  return join(projectRoot(), ".workspace", "tui");
}

/** List past builds, newest first. */
export function listProjects(): ProjectInfo[] {
  const root = tuiRoot();
  let slugs: string[];
  try {
    slugs = readdirSync(root);
  } catch {
    return [];
  }
  const out: ProjectInfo[] = [];
  for (const slug of slugs) {
    const dir = join(root, slug);
    const statePath = join(dir, "build-state.json");
    let state: BuildState | undefined;
    try {
      if (!statSync(dir).isDirectory()) continue;
      state = loadState(statePath);
    } catch {
      continue;
    }
    if (!state) continue;
    out.push({
      slug,
      dir,
      idea: state.idea ?? slug,
      status: state.status,
      totalCost: state.totalCost,
      taskCount: state.tasks.length,
      files: projectFiles(dir),
      mtimeMs: safeMtime(statePath),
      state,
    });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function safeMtime(p: string): number {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/** Built files in a project (excludes the state file). */
export function projectFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f !== "build-state.json" && !f.startsWith("."));
  } catch {
    return [];
  }
}

// ---- projects CRUD ----

/** Rename a project's display name (its idea/label). Keeps the folder + files. */
export function renameProject(dir: string, newIdea: string): void {
  const p = join(dir, "build-state.json");
  const s = loadState(p);
  if (s) {
    s.idea = newIdea.trim() || s.idea;
    saveState(s, p);
  }
}

function uniqueDir(baseSlug: string): string {
  const root = tuiRoot();
  let slug = baseSlug || "build";
  let n = 2;
  while (existsSync(join(root, slug))) slug = `${baseSlug}-${n++}`;
  return join(root, slug);
}

/** Copy a project into a new folder so changes don't touch the original. */
export function duplicateProject(dir: string): string {
  const s = loadState(join(dir, "build-state.json"));
  const newIdea = (s?.idea ?? basename(dir)) + " (copy)";
  const newDir = uniqueDir(slugify(newIdea));
  cpSync(dir, newDir, { recursive: true });
  const np = join(newDir, "build-state.json");
  const ns = loadState(np);
  if (ns) {
    ns.idea = newIdea;
    ns.id = basename(newDir);
    saveState(ns, np);
  }
  return newDir;
}

/** Persist an edited task list back to a project's build-state (keeps outcomes/status). */
export function saveProjectTasks(dir: string, tasks: Task[]): void {
  const p = join(dir, "build-state.json");
  const s = loadState(p);
  if (s) {
    s.tasks = tasks;
    saveState(s, p);
  }
}

/** Export a project's backlog as Markdown + CSV into its folder. Returns the paths. */
export function exportProject(dir: string): { md: string; csv: string } {
  const state = loadState(join(dir, "build-state.json"));
  if (!state) throw new Error("No project data to export.");
  const done = new Set(state.outcomes.map((o) => o.taskId));
  const cost = new Map<string, number>();
  for (const o of state.outcomes) cost.set(o.taskId, (cost.get(o.taskId) ?? 0) + o.cost);

  // group by epic, first-seen order
  const order: string[] = [];
  const byEpic = new Map<string, typeof state.tasks>();
  for (const t of state.tasks) {
    const e = t.epic || "General";
    if (!byEpic.has(e)) { byEpic.set(e, []); order.push(e); }
    byEpic.get(e)!.push(t);
  }

  const md: string[] = [
    `# ${state.idea ?? state.id}`,
    "",
    `**Status:** ${state.status}  ·  **Total:** $${state.totalCost.toFixed(2)}  ·  **Tasks:** ${state.tasks.length}`,
    "",
  ];
  for (const epic of order) {
    md.push(`## ${epic}`);
    for (const t of byEpic.get(epic)!) {
      const mark = done.has(t.id) ? "x" : " ";
      const c = cost.has(t.id) ? ` — $${cost.get(t.id)!.toFixed(2)}` : "";
      const dep = (t.dependsOn ?? []).length ? ` _(after ${(t.dependsOn ?? []).join(", ")})_` : "";
      md.push(`- [${mark}] \`${t.id}\` **${t.capability}/${t.difficulty}** — ${t.title}${c}${dep}`);
    }
    md.push("");
  }

  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const csv = [
    "id,epic,capability,difficulty,status,cost,dependsOn,title",
    ...state.tasks.map((t) =>
      [
        t.id,
        esc(t.epic || "General"),
        t.capability,
        t.difficulty,
        done.has(t.id) ? "done" : "todo",
        (cost.get(t.id) ?? 0).toFixed(2),
        esc((t.dependsOn ?? []).join(" ")),
        esc(t.title),
      ].join(","),
    ),
  ].join("\n");

  const mdPath = join(dir, "export.md");
  const csvPath = join(dir, "export.csv");
  writeFileSync(mdPath, md.join("\n") + "\n");
  writeFileSync(csvPath, csv + "\n");
  return { md: mdPath, csv: csvPath };
}

/** Permanently delete a project's folder. */
export function deleteProject(dir: string): void {
  // Safety: only ever delete inside our own tui workspace root.
  if (!dir.startsWith(tuiRoot())) throw new Error("refusing to delete outside the projects folder");
  rmSync(dir, { recursive: true, force: true });
}

/** Summarize an existing project for the PM: original idea + files + their contents.
 *  Gives the (otherwise blind) PM real context when planning a change. */
export function buildProjectContext(dir: string): string {
  const files = projectFiles(dir);
  const parts: string[] = [];
  try {
    const state = loadState(join(dir, "build-state.json"));
    if (state?.idea) parts.push(`This project was originally: "${state.idea}"`);
  } catch {
    /* ignore */
  }
  parts.push(`Files currently in the project: ${files.join(", ") || "(none)"}`);
  const TEXT = /\.(html|css|js|jsx|ts|tsx|md|json|txt|svg)$/i;
  let budget = 8000; // cap total context chars
  for (const f of files) {
    if (!TEXT.test(f) || budget <= 0) continue;
    try {
      const content = readFileSync(join(dir, f), "utf-8");
      const snippet = content.slice(0, Math.min(2000, budget));
      budget -= snippet.length;
      parts.push(`--- ${f} ---\n${snippet}${content.length > snippet.length ? "\n…[truncated]" : ""}`);
    } catch {
      /* ignore unreadable file */
    }
  }
  return parts.join("\n\n");
}

/** The file to open when viewing a project (index.html preferred, else first html, else the folder). */
export function mainFileOf(dir: string): string {
  const files = projectFiles(dir);
  const index = files.find((f) => f === "index.html");
  const html = files.find((f) => f.endsWith(".html"));
  return join(dir, index ?? html ?? "");
}

/** Copy a file from anywhere on the computer into a project's folder, so the
 *  build can use it (images, logos, fonts…). Returns the copied filename. */
export function addAsset(dir: string, rawSrc: string): { ok: true; name: string } | { ok: false; error: string } {
  let src = rawSrc.trim();
  // Terminals wrap dragged paths in quotes or backslash-escape special chars
  // (space, ~, parens, &, …). Strip quotes, then un-escape every "\x" -> "x".
  if ((src.startsWith('"') && src.endsWith('"')) || (src.startsWith("'") && src.endsWith("'"))) src = src.slice(1, -1);
  else src = src.replace(/\\(.)/g, "$1");
  if (src.startsWith("~")) src = homedir() + src.slice(1);
  try {
    if (!existsSync(src)) return { ok: false, error: `File not found: ${src}` };
    if (statSync(src).isDirectory()) return { ok: false, error: "That's a folder — pick a single file." };
    const name = basename(src);
    mkdirSync(dir, { recursive: true });
    copyFileSync(src, join(dir, name));
    return { ok: true, name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Open a file or folder in the OS default app (macOS `open`). Fire-and-forget. */
export function openInBrowser(target: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  const child = spawn(cmd, [target], { detached: true, stdio: "ignore" });
  child.unref();
}

/** Break an epic into more tasks via the PM. Returns new tasks tagged with the epic. */
export async function breakdownEpic(
  epic: string,
  current: Task[],
  providers: Provider[],
  workspace?: string,
): Promise<Task[]> {
  const { registry, lock } = chooseRegistry(providers);
  const modelOverride = lock
    ? { provider: lock, model: registry.find((e) => e.capability === "plan")!.byBackend.api.model }
    : undefined;
  const existing = current
    .map((t) => `- ${t.id} [${t.capability}/${t.difficulty}] ${t.title} (epic: ${t.epic || "General"})`)
    .join("\n");
  const request = [
    `Break the epic "${epic}" into concrete, atomic tasks for this project.`,
    `Set every new task's epic field to "${epic}".`,
    `Do NOT repeat any of these existing tasks:`,
    existing || "(none yet)",
  ].join("\n");
  const projectContext = workspace ? buildProjectContext(workspace) : undefined;
  const res = await decomposeIdea(request, { backend: "api", modelOverride, scope: "full", projectContext });
  return res.tasks.map((t) => ({ ...t, epic }));
}

export interface RunHandle {
  workspace: string;
  promise: Promise<{ totalCost: number; halted: boolean; files: string[] }>;
}

/** Run a planned build, streaming orchestrator events to the UI. Spends money.
 *  Pass `workspace` to build into an existing project (changes/resume); pass
 *  `seedOutcomes` to resume a halted run without re-paying for finished tasks. */
export function startBuild(
  idea: string,
  plan: PlanResult,
  opts: {
    concurrency: number;
    budgetCapUSD: number;
    onEvent: (e: OrchestratorEvent) => void;
    workspace?: string;
    seedOutcomes?: TaskOutcome[];
    mode?: "auto" | "approval";
    onGate?: (info: { stage: string }) => Promise<"continue" | "stop">;
  },
): RunHandle {
  const workspace = opts.workspace ?? join(projectRoot(), ".workspace", "tui", slugify(idea));
  mkdirSync(workspace, { recursive: true });
  const statePath = join(workspace, "build-state.json");
  const state = newBuildState(slugify(idea), plan.tasks, idea, opts.mode);

  const executor = makePiExecutor({ workspace, backend: "api" });
  const policy = { ...DEFAULT_POLICY, backendMode: "api" as const, budgetCapUSD: opts.budgetCapUSD };

  const promise = runBacklog(plan.tasks, {
    policy,
    execute: executor,
    registry: plan.registry,
    concurrency: opts.concurrency,
    seedOutcomes: opts.seedOutcomes,
    onGate: opts.onGate,
    onProgress: opts.onEvent,
    onCheckpoint: (outcomes, totalCost) => {
      state.outcomes = outcomes;
      state.totalCost = totalCost;
      saveState(state, statePath);
    },
  }).then((result) => {
    state.outcomes = result.outcomes;
    state.totalCost = result.totalCost;
    state.status = result.halted ? "halted" : "complete";
    saveState(state, statePath);
    return {
      totalCost: result.totalCost,
      halted: result.halted,
      files: (result.outcomes.at(-1)?.files ?? []).filter((f) => f !== "build-state.json"),
    };
  });

  return { workspace, promise };
}
