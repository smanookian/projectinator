// Engine glue for the TUI — keeps all orchestration out of the React components.
// The UI calls these; they reuse the same core the CLI does.

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import type { Capability, Provider, RegistryEntry, Task, TaskLimits, TaskOutcome, Tier } from "../types.js";
import { DEFAULT_POLICY, route } from "../router.js";
import { REGISTRY } from "../registry.js";
import { MODELS } from "../models.js";
import { loadRegistry, saveOverrides, OVERRIDES_FILENAME } from "../registry-store.js";
import { loadConfig } from "./config.js";
import { getLocalModels } from "../local-models.js";
import { lockRegistryToProvider, makePiExecutor } from "../roles.js";
import { runBacklog, createBuildControl, type BuildControl, type OrchestratorEvent } from "../orchestrator.js";
export type { BuildControl };
import { initRepo, commitTask, undoLastCommit, history as gitHistory, remoteUrl, addWorktree, mergeWorktree, removeWorktree, pruneWorktrees, type Commit } from "../git.js";
import { startChangeBranch } from "../github.js";
import { computeRetro, type RetroReport } from "../retro.js";
import { computeBurndown, type Burndown } from "../burndown.js";
import { narrateRetro } from "../narrate.js";
import { decomposeIdea } from "../pm.js";
import { assessIntake, type IntakeQuestion } from "../intake.js";
import { councilEpics, type Epic, type CouncilResult } from "../council.js";
import { newBuildState, loadState, saveState, completedIds, type BuildState } from "../build-state.js";
import { PROFILES, profileWithScripts, type StackProfile, type StackProfileId } from "../stack.js";

const PROVIDER_KEYS: Record<Exclude<Provider, "local">, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
};

export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  google: "Google (Gemini)",
  openrouter: "OpenRouter",
  local: "Local (Ollama / LM Studio)",
};

/** Which providers are usable right now: a key present (cloud) or a configured local server. */
export function availableProviders(): Provider[] {
  const keyed = (Object.keys(PROVIDER_KEYS) as Exclude<Provider, "local">[]).filter((p) =>
    PROVIDER_KEYS[p].some((k) => !!process.env[k]),
  );
  return getLocalModels() ? [...keyed, "local"] : keyed;
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
  { capability: "review", tier: "fast", label: "Reviewer" },
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
  const cloud = Object.values(MODELS).map((m) => ({ id: m.id, provider: m.provider, name: m.name }));
  const local = (getLocalModels()?.models ?? []).map((id) => ({ id, provider: "local" as const, name: `${id} (local, $0)` }));
  return [...cloud, ...local];
}

/** Friendly model name for display (e.g. "claude-opus-4-8" -> "Claude Opus 4.8"). */
export function modelLabel(id: string): string {
  return MODELS[id]?.name ?? (getLocalModels()?.models.includes(id) ? `${id} (local)` : id);
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

export interface CostOption {
  label: string;
  provider?: Provider;
  total: number;
  /** True for the option the build will actually use. */
  current: boolean;
}

/** The same backlog priced under each available choice: the current roster, and each
 *  key-holding provider locked. Pure — reads only the estimates and the registry. */
export function costMatrix(tasks: Task[], current: RegistryEntry[], providers: Provider[], currentLock?: Provider): CostOption[] {
  const rows: CostOption[] = [{ label: currentLock ? `${PROVIDER_LABEL[currentLock]} (locked)` : "Best model per role", total: estimateTasks(tasks, current).total, current: true }];
  for (const p of providers) {
    if (p === currentLock) continue;
    rows.push({ label: PROVIDER_LABEL[p], provider: p, total: estimateTasks(tasks, lockedRegistry(p)).total, current: false });
  }
  return rows.sort((a, b) => a.total - b.total);
}

/** Drop dependsOn refs to tasks that no longer exist (after removals). */
export function cleanDeps(tasks: Task[]): Task[] {
  const valid = new Set(tasks.map((t) => t.id));
  return tasks.map((t) => ({ ...t, dependsOn: (t.dependsOn ?? []).filter((d) => valid.has(d)) }));
}

/** Decompose an idea and estimate the whole build's cost. Spends money (PM call). */
function planModelOverride(providers: Provider[]) {
  const { registry, lock } = chooseRegistry(providers);
  const modelOverride = lock
    ? { provider: lock, model: registry.find((e) => e.capability === "plan")!.byBackend.api.model }
    : undefined;
  return { registry, lock, modelOverride };
}

/** PM intake: clarifying questions for a vague request ([] = clear enough). */
export async function assessBuild(idea: string, providers: Provider[]): Promise<IntakeQuestion[]> {
  return assessIntake(idea, { backend: "api", modelOverride: planModelOverride(providers).modelOverride });
}

/** Council: propose + synthesize epics for a "deep plan". */
export async function councilBuild(idea: string, providers: Provider[]): Promise<CouncilResult> {
  return councilEpics(idea, { backend: "api", modelOverride: planModelOverride(providers).modelOverride });
}

export async function planBuild(
  idea: string,
  providers: Provider[],
  scope: "full" | "change" = "full",
  workspace?: string,
  epics?: Epic[],
): Promise<PlanResult> {
  const { registry, lock, modelOverride } = planModelOverride(providers);

  // On a change, hand the PM the existing project so it plans against what's really there.
  const projectContext = scope === "change" && workspace ? buildProjectContext(workspace) : undefined;
  const res = await decomposeIdea(idea, { backend: "api", modelOverride, scope, projectContext, epics });
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
  const done = completedIds(state);
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
      if (t.notes) md.push(`  - ✎ ${t.notes}`);
    }
    md.push("");
  }

  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const csv = [
    "id,epic,capability,difficulty,status,cost,dependsOn,title,notes",
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
        esc(t.notes ?? ""),
      ].join(","),
    ),
  ].join("\n");

  const mdPath = join(dir, "export.md");
  const csvPath = join(dir, "export.csv");
  writeFileSync(mdPath, md.join("\n") + "\n");
  writeFileSync(csvPath, csv + "\n");
  return { md: mdPath, csv: csvPath };
}

// Shared: load state + a done-set + per-task cost, or throw.
function projectRows(dir: string) {
  const state = loadState(join(dir, "build-state.json"));
  if (!state) throw new Error("No project data to export.");
  const done = completedIds(state);
  const cost = new Map<string, number>();
  for (const o of state.outcomes) cost.set(o.taskId, (cost.get(o.taskId) ?? 0) + o.cost);
  return { state, done, cost };
}

const csvEsc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;

/** Export the backlog as a Jira-importable CSV (one Epic row per epic + linked
 *  Task rows). Import via Jira → System → External System Import → CSV. */
export function exportJira(dir: string): string {
  const { state, done, cost } = projectRows(dir);
  const epics = [...new Set(state.tasks.map((t) => t.epic || "General"))];
  const header = "Issue Type,Summary,Epic Name,Epic Link,Status,Labels,Description";
  const rows: string[] = [header];
  // Epic rows first so Epic Link resolves by name on import.
  for (const e of epics) {
    rows.push(["Epic", csvEsc(e), csvEsc(e), "", "To Do", "projectinator", ""].join(","));
  }
  for (const t of state.tasks) {
    const epic = t.epic || "General";
    const deps = (t.dependsOn ?? []).length ? `Depends on: ${(t.dependsOn ?? []).join(", ")}. ` : "";
    const c = cost.has(t.id) ? `Cost: $${cost.get(t.id)!.toFixed(2)}. ` : "";
    const desc = `${deps}${c}[${t.id}]`;
    rows.push(
      [
        "Task",
        csvEsc(t.title),
        "",
        csvEsc(epic),
        done.has(t.id) ? "Done" : "To Do",
        csvEsc(`${t.capability} ${t.difficulty}`),
        csvEsc(desc),
      ].join(","),
    );
  }
  const p = join(dir, "jira-import.csv");
  writeFileSync(p, rows.join("\n") + "\n");
  return p;
}

/** Export the backlog as a Trello-importable CSV (lists = epics, one card per
 *  task). Import via a Trello CSV-import Power-Up / board import. */
export function exportTrello(dir: string): string {
  const { state, done, cost } = projectRows(dir);
  const header = "List Name,Card Name,Card Description,Labels";
  const rows: string[] = [header];
  for (const t of state.tasks) {
    const epic = t.epic || "General";
    const deps = (t.dependsOn ?? []).length ? `Depends on: ${(t.dependsOn ?? []).join(", ")}. ` : "";
    const c = cost.has(t.id) ? `Cost: $${cost.get(t.id)!.toFixed(2)}. ` : "";
    const name = `${done.has(t.id) ? "✓ " : ""}${t.title}`;
    rows.push(
      [
        csvEsc(epic),
        csvEsc(name),
        csvEsc(`${deps}${c}[${t.id}]`),
        csvEsc(`${t.capability},${t.difficulty},${done.has(t.id) ? "done" : "todo"}`),
      ].join(","),
    );
  }
  const p = join(dir, "trello-import.csv");
  writeFileSync(p, rows.join("\n") + "\n");
  return p;
}

/** Per-task git history for a project (newest first). Empty if not versioned. */
export function projectHistory(dir: string): Commit[] {
  return gitHistory(dir);
}

/** Data-driven retro for a finished build, or null if there's no state. */
export function projectRetro(dir: string): RetroReport | null {
  const state = loadState(join(dir, "build-state.json"));
  return state ? computeRetro(state) : null;
}

/** Burndown series (tasks remaining + cumulative cost per step), or null. */
export function projectBurndown(dir: string): Burndown | null {
  const state = loadState(join(dir, "build-state.json"));
  return state ? computeBurndown(state) : null;
}

/** Cached AI retro narrative for a project (null if never generated). */
export function getRetroNarrative(dir: string): string | null {
  return loadState(join(dir, "build-state.json"))?.retroNarrative ?? null;
}

/** Generate (or regenerate) the AI retro narrative and cache it on the state. */
export async function generateRetroNarrative(dir: string, providers: Provider[]): Promise<string> {
  const statePath = join(dir, "build-state.json");
  const state = loadState(statePath);
  if (!state) throw new Error("No build data to narrate.");
  const { registry, lock } = chooseRegistry(providers);
  const modelOverride = lock
    ? { provider: lock, model: registry.find((e) => e.capability === "plan")!.byBackend.api.model }
    : undefined;
  const text = await narrateRetro(computeRetro(state), { backend: "api", modelOverride });
  state.retroNarrative = text;
  saveState(state, statePath);
  return text;
}

/** Set (or clear, when undefined) a project's per-build budget cap. */
export function setProjectBudget(dir: string, cap: number | undefined): void {
  const statePath = join(dir, "build-state.json");
  const state = loadState(statePath);
  if (!state) return;
  state.budgetCapUSD = cap;
  saveState(state, statePath);
}

/** Per-project opt-in for npm install scripts (STACKS.md decision 1). */
export function setAllowInstallScripts(dir: string, allow: boolean): void {
  const statePath = join(dir, "build-state.json");
  const state = loadState(statePath);
  if (!state) return;
  state.allowInstallScripts = allow || undefined;
  saveState(state, statePath);
  rmSync(join(dir, ".checks", "prepare.json"), { force: true }); // force a fresh install next time
}

/** Undo the last task: revert its file changes (git reset) AND roll back the
 *  build-state so the task is no longer "done" and can be rebuilt via Resume. */
export function undoLastTask(dir: string): { ok: boolean; taskId?: string; error?: string } {
  const { ok, taskId } = undoLastCommit(dir);
  if (!ok) return { ok: false, error: "Nothing to undo (only the initial commit, or git isn't available)." };
  const statePath = join(dir, "build-state.json");
  const state = loadState(statePath);
  if (state) {
    // Drop EVERY outcome for the reverted task — a task that went through the
    // Tester→Developer loop has several (rounds 0,1,…); leaving any behind keeps
    // its id in the resume done-set, so Resume would skip it while its files are
    // already gone. If we couldn't parse a task id, fall back to the last outcome.
    state.outcomes = taskId
      ? state.outcomes.filter((o) => o.taskId !== taskId)
      : state.outcomes.slice(0, -1);
    state.totalCost = Math.round(state.outcomes.reduce((a, o) => a + o.cost, 0) * 100) / 100;
    state.status = "halted";
    state.haltReason = `undid ${taskId ?? "last task"} — resume to rebuild`;
    saveState(state, statePath);
  }
  return { ok: true, taskId };
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

/** Terminals wrap dragged paths in quotes or backslash-escape special chars
 *  (space, ~, parens, &, …). Strip quotes, un-escape "\x" -> "x", expand ~. */
function normalizeUserPath(raw: string): string {
  let p = raw.trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) p = p.slice(1, -1);
  else p = p.replace(/\\(.)/g, "$1");
  if (p.startsWith("~")) p = homedir() + p.slice(1);
  return p;
}

/** Copy a file from anywhere on the computer into a project's folder, so the
 *  build can use it (images, logos, fonts…). Returns the copied filename. */
export function addAsset(dir: string, rawSrc: string): { ok: true; name: string } | { ok: false; error: string } {
  const src = normalizeUserPath(rawSrc);
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

/** Folders never worth copying into a project (huge or regenerable). `.git` IS copied when
 *  present: the imported project keeps its history and remote, so changes can become pull
 *  requests against the user's real repository (github.ts never pushes to its base branch). */
const IMPORT_SKIP = new Set(["node_modules", "dist", ".next", ".cache", ".workspace"]);

/** Bring an existing folder in as a project: copy its files into a fresh workspace,
 *  write an empty backlog (the PM plans changes against the real files via
 *  buildProjectContext), and version it. Returns the new project dir. */
export function importProject(rawSrc: string, idea?: string): { ok: true; dir: string; files: number; remote?: string } | { ok: false; error: string } {
  const src = normalizeUserPath(rawSrc);
  try {
    if (!existsSync(src)) return { ok: false, error: `Folder not found: ${src}` };
    if (!statSync(src).isDirectory()) return { ok: false, error: "That's a file — pick the project folder." };
    if (existsSync(join(src, "build-state.json"))) return { ok: false, error: "That folder is already a Projectinator project — open it from Projects." };
    const label = (idea ?? "").trim() || `Imported: ${basename(src)}`;
    const dir = uniqueDir(slugify(label));
    mkdirSync(dir, { recursive: true });
    let files = 0;
    cpSync(src, dir, {
      recursive: true,
      filter: (p) => {
        const name = basename(p);
        if (IMPORT_SKIP.has(name)) return false;
        if (p !== src && !p.includes("/.git/") && name !== ".git" && !statSync(p).isDirectory()) files++;
        return true;
      },
    });
    const state = newBuildState(basename(dir), [], label, "auto");
    state.status = "complete"; // nothing to build yet; "Add to backlog" plans the first change
    saveState(state, join(dir, "build-state.json"));
    initRepo(dir); // keeps an imported repo as is (adds our exclude list), else inits one
    return { ok: true, dir, files, remote: remoteUrl(dir) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Archive a project's built files for sharing: `<slug>.zip` when the system has `zip`,
 *  else `<slug>.tar.gz` (stdlib tar via the system `tar`, present on every OS we support).
 *  Excludes build-state, git, deploy staging and node_modules. Written next to the project. */
export function shareBuild(dir: string): { ok: true; path: string; format: "zip" | "tar.gz" } | { ok: false; error: string } {
  const slug = basename(dir);
  const exclude = ["build-state.json", ".git", ".deploy", ".checks", ".worktrees", "node_modules", "dist", ".venv", "export.md", "export.csv"];
  const out = join(dirname(dir), `${slug}.zip`);
  const zip = spawnSync("zip", ["-r", "-q", out, ".", ...exclude.flatMap((e) => ["-x", e, `${e}/*`])], { cwd: dir, encoding: "utf8" });
  if (zip.status === 0) return { ok: true, path: out, format: "zip" };
  const tgz = join(dirname(dir), `${slug}.tar.gz`);
  const tar = spawnSync("tar", ["-czf", tgz, ...exclude.flatMap((e) => ["--exclude", e]), "-C", dir, "."], { encoding: "utf8" });
  if (tar.status === 0) return { ok: true, path: tgz, format: "tar.gz" };
  return { ok: false, error: `Could not create an archive (zip: ${zip.error?.message ?? zip.stderr?.trim() ?? "not available"}; tar: ${tar.error?.message ?? tar.stderr?.trim() ?? "failed"})` };
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

/** Mid-build: turn a one-line request into tasks that fit the running backlog (ids after the
 *  existing ones, deps on existing tasks allowed, review after every code task). Spends one
 *  PM call. */
export async function planExtraTasks(
  request: string,
  current: Task[],
  providers: Provider[],
  workspace?: string,
): Promise<Task[]> {
  const { registry, lock } = chooseRegistry(providers);
  const modelOverride = lock
    ? { provider: lock, model: registry.find((e) => e.capability === "plan")!.byBackend.api.model }
    : undefined;
  const existing = current.map((t) => `- ${t.id} [${t.capability}/${t.difficulty}] ${t.title}`).join("\n");
  const nextN = Math.max(0, ...current.map((t) => Number(/(\d+)$/.exec(t.id)?.[1] ?? 0))) + 1;
  const prompt = [
    `A build is ALREADY RUNNING with these tasks (some done, some in progress):`,
    existing,
    "",
    `The user wants to ADD this while it runs: "${request}"`,
    `Produce only the NEW tasks needed (usually 1–3). Use ids T-${String(nextN).padStart(2, "0")} onwards.`,
    `A new task may dependsOn existing task ids when it builds on their output. Add a review task after every new code task.`,
  ].join("\n");
  const projectContext = workspace ? buildProjectContext(workspace) : undefined;
  const res = await decomposeIdea(prompt, { backend: "api", modelOverride, scope: "change", projectContext });
  const taken = new Set(current.map((t) => t.id));
  return res.tasks.filter((t) => !taken.has(t.id));
}

export interface RunHandle {
  workspace: string;
  /** Set when the build runs on its own git branch (change to a published project). */
  branch?: string;
  /** Mid-build steering: pause / resume / inject / remove / stop. */
  control: BuildControl;
  promise: Promise<{ totalCost: number; halted: boolean; haltReason?: string; files: string[] }>;
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
    taskLimits: TaskLimits;
    onEvent: (e: OrchestratorEvent) => void;
    workspace?: string;
    seedOutcomes?: TaskOutcome[];
    mode?: "auto" | "approval";
    onGate?: (info: { stage: string }) => Promise<"continue" | "stop">;
    /** A change to an existing project. On a project with a GitHub remote the build runs on
     *  its own branch so it can become a pull request (never straight onto the base). */
    changeIdea?: string;
    /** Stack profile for a NEW project. Existing projects keep the one in their state. */
    stack?: StackProfileId;
    /** Independent code tasks build in parallel git worktrees (merged back per task). */
    parallelCode?: boolean;
  },
): RunHandle {
  const workspace = opts.workspace ?? join(projectRoot(), ".workspace", "tui", slugify(idea));
  mkdirSync(workspace, { recursive: true });
  const statePath = join(workspace, "build-state.json");
  // Reuse the existing state when resuming/changing an existing project so we keep
  // its id and cached retro narrative; only start fresh for a brand-new build.
  const prior = opts.workspace ? loadState(statePath) : undefined;
  const state = prior ?? newBuildState(slugify(idea), plan.tasks, idea, opts.mode);
  if (prior) {
    state.tasks = plan.tasks; // authoritative backlog for this run
    state.status = "running";
    state.haltReason = undefined;
    state.mode = opts.mode ?? state.mode;
  }
  state.budgetCapUSD = opts.budgetCapUSD; // remember this project's cap
  if (!prior && opts.stack) state.stack = opts.stack;
  const profile = state.allowInstallScripts ? profileWithScripts(PROFILES[state.stack ?? "static"]) : PROFILES[state.stack ?? "static"];

  const executor = makePiExecutor({ workspace, backend: "api", profile });
  const policy = { ...DEFAULT_POLICY, backendMode: "api" as const, budgetCapUSD: opts.budgetCapUSD, taskLimits: opts.taskLimits };

  // Version the workspace: init a repo, then commit after each finished task.
  initRepo(workspace, profile.exclude);
  const branch = opts.changeIdea ? startChangeBranch(workspace, opts.changeIdea) : undefined;
  pruneWorktrees(workspace); // leftovers from a crashed parallel build
  const titleById = new Map(plan.tasks.map((t) => [t.id, t.title]));
  const onProgress = (e: OrchestratorEvent) => {
    opts.onEvent(e);
    // Worktree tasks are committed by the merge itself; everything else commits here.
    if (e.type === "task_done") commitTask(workspace, e.outcome.taskId, titleById.get(e.outcome.taskId) ?? e.outcome.taskId);
  };
  const isolate = opts.parallelCode
    ? (task: Task) => {
        const wt = addWorktree(workspace, `${task.id}-${Date.now().toString(36)}`);
        if (!wt) return undefined;
        return { dir: wt.dir, merge: (msg: string) => mergeWorktree(workspace, wt, msg), discard: () => removeWorktree(workspace, wt) };
      }
    : undefined;

  const control = createBuildControl();
  const promise = runBacklog(plan.tasks, {
    policy,
    control,
    execute: executor,
    registry: plan.registry,
    concurrency: opts.concurrency,
    seedOutcomes: opts.seedOutcomes,
    onGate: opts.onGate,
    isolate,
    onProgress,
    onCheckpoint: (outcomes, totalCost) => {
      state.outcomes = outcomes;
      state.totalCost = totalCost;
      saveState(state, statePath);
    },
  }).then((result) => {
    state.tasks = result.tasks; // steering may have added/removed tasks
    state.outcomes = result.outcomes;
    state.totalCost = result.totalCost;
    state.status = result.halted ? "halted" : "complete";
    state.haltReason = result.haltReason; // keep why it stopped (budget cap / gate)
    saveState(state, statePath);
    if (!result.halted) ensureRunInstructions(workspace, profile); // finished builds ship with how-to-run
    return {
      totalCost: result.totalCost,
      halted: result.halted,
      haltReason: result.haltReason,
      files: (result.outcomes.at(-1)?.files ?? []).filter((f) => f !== "build-state.json"),
    };
  });

  return { workspace, branch, control, promise };
}

/** After a static web build, make sure the folder ships with how-to-run notes.
 *  A user who just double-clicks index.html hits a blank page when the app uses
 *  ES modules / fetches local files (browsers block those on file://). We can't
 *  rewrite their code here, but we can guarantee the folder tells them how to run
 *  it — so the export is never a mystery. No-op if there's no index.html or a
 *  README already exists. */
function ensureRunInstructions(workspace: string, profile: StackProfile = PROFILES.static): void {
  const hasReadme = ["README.md", "readme.md", "README.txt"].some((n) => existsSync(join(workspace, n)));
  if (hasReadme) return; // the developer/tester already documented it
  if (profile.id !== "static") {
    const cmds = [profile.install, profile.build ? ["npm", "run", "dev"] : profile.serve].filter((c): c is string[] => !!c).map((c) => c.join(" ").replace(" --ignore-scripts --no-audit --no-fund", ""));
    writeFileSync(join(workspace, "README.md"), ["# Your app", "", `Built by Projectinator (${profile.label}).`, "", "## Run it", "", "```", ...cmds, "```", ""].join("\n"));
    return;
  }
  const index = join(workspace, "index.html");
  if (!existsSync(index)) return; // not a static site → nothing to say

  let usesModules = false;
  try {
    const html = readFileSync(index, "utf8");
    usesModules = /<script[^>]+type=["']module["']/.test(html);
  } catch { /* unreadable → fall through with the generic note */ }

  const serverNote = [
    "## Run it",
    "",
    usesModules
      ? "This app uses ES modules, so it must be served over http — opening `index.html` directly (double-click) will show a blank page. From this folder, run one of:"
      : "Open `index.html` in your browser (double-click works). If anything looks off, serve it over http instead — from this folder run one of:",
    "",
    "```",
    "python3 -m http.server 8000    # then open http://localhost:8000",
    "npx serve .                    # if you have Node installed",
    "```",
    "",
  ].join("\n");

  const body = [
    "# Your app",
    "",
    "Built by Projectinator.",
    "",
    serverNote,
  ].join("\n");

  try {
    writeFileSync(join(workspace, "README.md"), body);
  } catch { /* best-effort; never fail a build over docs */ }
}
