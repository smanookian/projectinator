// Persistent app config — API keys + preferences — so the TUI is self-contained
// (no ~/.zshenv editing). Stored at ~/.projectinator/config.json with 0600 perms.
// Keys are applied to process.env on launch so Pi's auth picks them up.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Provider } from "../types.js";

export type WorkflowMode = "auto" | "approval";

export interface AppConfig {
  keys: Partial<Record<Provider, string>>;
  budgetCapUSD?: number;
  concurrency?: number;
  /** Warn (not halt) once spend crosses this % of the cap. Default 80. */
  budgetAlertPct?: number;
  /** If set, always route to this provider (when it has a key), ignoring the others. */
  preferredProvider?: Provider;
  /** Default workflow for new builds: auto-run, or require PM approval before building. */
  defaultMode?: WorkflowMode;
  /** Desktop notification + sound when a build finishes. Default on. */
  notify?: boolean;
  /** Default target stack for new web builds; "ask" prompts each time. */
  preferredStack?: "ask" | "vanilla" | "react" | "ai";
}

export const ENV_VAR: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
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
  for (const p of Object.keys(cfg.keys) as Provider[]) {
    const v = cfg.keys[p];
    if (v && !process.env[ENV_VAR[p]]) process.env[ENV_VAR[p]] = v;
  }
}

/** Save a key both to disk and live env so availableProviders() updates immediately. */
export function setKey(provider: Provider, key: string): void {
  const cfg = loadConfig();
  cfg.keys[provider] = key;
  saveConfig(cfg);
  process.env[ENV_VAR[provider]] = key;
}

export function getPrefs(): { budgetCapUSD: number; concurrency: number; budgetAlertPct: number } {
  const cfg = loadConfig();
  return {
    budgetCapUSD: cfg.budgetCapUSD ?? 25,
    concurrency: cfg.concurrency ?? 3,
    budgetAlertPct: cfg.budgetAlertPct ?? 80,
  };
}

export function setPrefs(prefs: { budgetCapUSD?: number; concurrency?: number; budgetAlertPct?: number }): void {
  const cfg = loadConfig();
  if (prefs.budgetCapUSD !== undefined) cfg.budgetCapUSD = prefs.budgetCapUSD;
  if (prefs.concurrency !== undefined) cfg.concurrency = prefs.concurrency;
  if (prefs.budgetAlertPct !== undefined) cfg.budgetAlertPct = prefs.budgetAlertPct;
  saveConfig(cfg);
}
