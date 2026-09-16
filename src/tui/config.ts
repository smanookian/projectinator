// Persistent app config — API keys + preferences — so the TUI is self-contained
// (no ~/.zshenv editing). Stored at ~/.projectinator/config.json with 0600 perms.
// Keys are applied to process.env on launch so Pi's auth picks them up.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Provider } from "../types.js";
import type { ThemeId } from "./theme.js";

export type WorkflowMode = "auto" | "approval";

export interface AppConfig {
  keys: Partial<Record<Provider, string>>;
  budgetCapUSD?: number;
  concurrency?: number;
  /** Warn (not halt) once spend crosses this % of the cap. Default 80. */
  budgetAlertPct?: number;
  /** Per-task limits; 0 = unlimited. Defaults: 10 min, $3. */
  taskTimeoutMin?: number;
  taskCostCapUSD?: number;
  /** Run independent code tasks in parallel, each in its own git worktree, merged back per task.
   *  Off by default: conflicts cost a serial re-run. */
  parallelCode?: boolean;
  /** If set, always route to this provider (when it has a key), ignoring the others. */
  preferredProvider?: Provider;
  /** POST a JSON summary here when a build finishes or halts. Empty = off. */
  webhookUrl?: string;
  defaultMode?: WorkflowMode;
  /** Desktop notification + sound when a build finishes. Default on. */
  notify?: boolean;
  /** Default target stack for new web builds; "ask" prompts each time. */
  preferredStack?: "ask" | "vanilla" | "react" | "ai";
  /** Color theme (Settings → Appearance). Default dark. */
  theme?: ThemeId;
  /** Role icon style: Nerd Font glyphs or portable ASCII. Default nerd. */
  icons?: "nerd" | "ascii";
}

/** Providers that authenticate with an API key. "local" is configured under Settings → Local models. */
export type KeyedProvider = Exclude<Provider, "local">;

export const ENV_VAR: Record<KeyedProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

function dir(): string {
  return join(homedir(), ".projectinator");
}
export function configPath(): string {
  return join(dir(), "config.json");
}

export function loadConfig(): AppConfig {
  try {
    if (!existsSync(configPath())) return { keys: {} };
    const parsed = JSON.parse(readFileSync(configPath(), "utf-8")) as AppConfig;
    return {
      keys: parsed.keys ?? {},
      budgetCapUSD: parsed.budgetCapUSD,
      concurrency: parsed.concurrency,
      budgetAlertPct: parsed.budgetAlertPct,
      preferredProvider: parsed.preferredProvider,
      defaultMode: parsed.defaultMode,
      notify: parsed.notify,
      preferredStack: parsed.preferredStack,
      theme: parsed.theme,
      icons: parsed.icons,
    };
  } catch {
    return { keys: {} };
  }
}

export function getNotify(): boolean {
  return loadConfig().notify ?? true;
}
export function setNotify(v: boolean): void {
  const cfg = loadConfig();
  cfg.notify = v;
  saveConfig(cfg);
}

export function getWebhookUrl(): string {
  return loadConfig().webhookUrl ?? "";
}
export function setWebhookUrl(url: string): void {
  const cfg = loadConfig();
  const v = url.trim();
  if (v) cfg.webhookUrl = v;
  else delete cfg.webhookUrl;
  saveConfig(cfg);
}

export function getTheme(): ThemeId {
  return loadConfig().theme ?? "dark";
}
export function setTheme(v: ThemeId): void {
  const cfg = loadConfig();
  cfg.theme = v;
  saveConfig(cfg);
}

export function getIconMode(): "nerd" | "ascii" {
  return loadConfig().icons ?? "nerd";
}
export function setIconMode(v: "nerd" | "ascii"): void {
  const cfg = loadConfig();
  cfg.icons = v;
  saveConfig(cfg);
}

export function getPreferredStack(): "ask" | "vanilla" | "react" | "ai" {
  return loadConfig().preferredStack ?? "ask";
}
export function setPreferredStack(v: "ask" | "vanilla" | "react" | "ai"): void {
  const cfg = loadConfig();
  cfg.preferredStack = v;
  saveConfig(cfg);
}

export function setPreferredProvider(p: Provider | undefined): void {
  const cfg = loadConfig();
  cfg.preferredProvider = p;
  saveConfig(cfg);
}

export function getDefaultMode(): WorkflowMode {
  return loadConfig().defaultMode ?? "auto";
}
export function setDefaultMode(m: WorkflowMode): void {
  const cfg = loadConfig();
  cfg.defaultMode = m;
  saveConfig(cfg);
}

export function saveConfig(cfg: AppConfig): void {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + "\n");
  try {
    chmodSync(configPath(), 0o600); // keys are secrets — owner-only
  } catch {
    /* best effort */
  }
}

/** Put stored keys into process.env (without clobbering ones already set in the shell). */
export function applyKeysToEnv(cfg: AppConfig = loadConfig()): void {
  for (const p of Object.keys(cfg.keys) as KeyedProvider[]) {
    const v = cfg.keys[p];
    if (v && ENV_VAR[p] && !process.env[ENV_VAR[p]]) process.env[ENV_VAR[p]] = v;
  }
}

/** Save a key both to disk and live env so availableProviders() updates immediately. */
export function setKey(provider: KeyedProvider, key: string): void {
  const cfg = loadConfig();
  cfg.keys[provider] = key;
  saveConfig(cfg);
  process.env[ENV_VAR[provider]] = key;
}

export interface Prefs {
  budgetCapUSD: number;
  concurrency: number;
  budgetAlertPct: number;
  taskTimeoutMin: number;
  taskCostCapUSD: number;
  parallelCode: boolean;
}

export function getPrefs(): Prefs {
  const cfg = loadConfig();
  return {
    budgetCapUSD: cfg.budgetCapUSD ?? 25,
    concurrency: cfg.concurrency ?? 3,
    budgetAlertPct: cfg.budgetAlertPct ?? 80,
    taskTimeoutMin: cfg.taskTimeoutMin ?? 10,
    taskCostCapUSD: cfg.taskCostCapUSD ?? 3,
    parallelCode: cfg.parallelCode ?? false,
  };
}

export function setPrefs(prefs: Partial<Prefs>): void {
  const cfg = loadConfig();
  if (prefs.budgetCapUSD !== undefined) cfg.budgetCapUSD = prefs.budgetCapUSD;
  if (prefs.concurrency !== undefined) cfg.concurrency = prefs.concurrency;
  if (prefs.budgetAlertPct !== undefined) cfg.budgetAlertPct = prefs.budgetAlertPct;
  if (prefs.taskTimeoutMin !== undefined) cfg.taskTimeoutMin = prefs.taskTimeoutMin;
  if (prefs.taskCostCapUSD !== undefined) cfg.taskCostCapUSD = prefs.taskCostCapUSD;
  if (prefs.parallelCode !== undefined) cfg.parallelCode = prefs.parallelCode;
  saveConfig(cfg);
}
