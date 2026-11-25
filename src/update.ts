// Updates, the Musinator way: once a day (if you said yes at the first start) ask npm whether a
// new version is out; the status bar says so; `U` shows what's new and installs it; `r`
// restarts into it. Only a global npm install replaces itself — every other kind of install
// gets the command to run instead. `projectinator update` is the same thing from a terminal.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dataHome } from "./tui/config.js";

const REGISTRY_URL = "https://registry.npmjs.org/projectinator/latest";
const CHANGELOG_URL = "https://raw.githubusercontent.com/smanookian/projectinator/main/CHANGELOG.md";
const DAY_MS = 24 * 60 * 60 * 1000;

/** True when version `a` ≥ `b` (major.minor.patch, numeric). */
export function semverGte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return true;
}

/** True when `latest` is a newer stable version than `current`. Pre-releases are never offered. */
export function isNewer(latest: string, current: string): boolean {
  if (latest.includes("-") || !/^\d+\.\d+\.\d+$/.test(latest)) return false;
  return !semverGte(current.split("-")[0]!, latest);
}

/** How this copy was installed, which decides how it can be upgraded. */
export type InstallKind = "npm-global" | "npm-local" | "npx" | "mise" | "clone" | "docker";

export function installKind(modulePath: string, opts: { docker?: boolean; globalRoot?: string } = {}): InstallKind {
  if (opts.docker) return "docker";
  // `npm root -g` is the global node_modules; anything under it is the global install.
  if (opts.globalRoot && modulePath.startsWith(opts.globalRoot + sep)) return "npm-global";
  if (modulePath.includes(`${sep}_npx${sep}`)) return "npx";
  if (modulePath.includes(`${sep}mise${sep}installs${sep}`)) return "mise";
  return modulePath.includes(`${sep}node_modules${sep}`) ? "npm-local" : "clone";
}

/** For every kind except a global install: why we can't replace ourselves, and what to run. */
export const MANUAL: Record<Exclude<InstallKind, "npm-global">, { why: string; cmd: string }> = {
  clone: { why: "You're running a git clone.", cmd: "git pull && npm install && npm run compile" },
  "npm-local": { why: "Projectinator is a dependency of a project here.", cmd: "npm install projectinator@latest" },
  npx: { why: "You started it with npx.", cmd: "npx projectinator@latest" },
  mise: { why: "It was installed with mise, so mise updates it.", cmd: "mise upgrade npm:projectinator" },
  docker: { why: "You're in the Docker image.", cmd: "docker build -t projectinator ." },
};

/** How the running copy was installed (this file lives in the same package). */
export function detectInstall(): InstallKind {
  return installKind(fileURLToPath(import.meta.url), {
    docker: existsSync("/.dockerenv"),
    globalRoot: spawnSync("npm", ["root", "-g"], { encoding: "utf8" }).stdout?.trim() || undefined,
  });
}

/** The version running now. */
export function currentVersion(root: string): string {
  const pkg: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const v = pkg && typeof pkg === "object" && "version" in pkg ? pkg.version : undefined;
  if (typeof v !== "string") throw new Error("package.json has no version");
  return v;
}

/** The newest published version, or null when npm can't be reached. */
export async function latestVersion(): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return typeof body.version === "string" ? body.version : null;
  } catch { return null; }
}

/** One version's section of a CHANGELOG as plain lines: no `#`, `**` or backticks, "•" bullets. */
export function notesFor(changelog: string, version: string): string[] {
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^##\\s+v?${version.replace(/\./g, "\\.")}\\b`).test(l));
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  const out: string[] = [];
  for (const raw of lines.slice(start + 1, end < 0 ? undefined : end)) {
    const l = raw.trimEnd().replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/`/g, "").replace(/^(\s*)[-*] /, "$1• ");
    if (!l.trim() && (!out.length || !out[out.length - 1]!.trim())) continue;
    out.push(l);
  }
  while (out.length && !out[out.length - 1]!.trim()) out.pop();
  return out;
}

/** What's new in `version`, from the CHANGELOG on GitHub; empty when it can't be fetched. */
export async function releaseNotes(version: string): Promise<string[]> {
  try {
    const res = await fetch(CHANGELOG_URL, { signal: AbortSignal.timeout(8000) });
    return res.ok ? notesFor(await res.text(), version) : [];
  } catch { return []; }
}

/** `npm install -g projectinator@<version>`, quietly; the last lines of output on failure. */
export function installGlobal(version: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn("npm", ["install", "-g", `projectinator@${version}`], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => { output += d; });
    child.stderr.on("data", (d) => { output += d; });
    child.on("error", (e) => resolve({ ok: false, output: e.message }));
    child.on("close", (code) => resolve({ ok: code === 0, output: output.trim().split("\n").slice(-4).join("\n") }));
  });
}

// ---- when to check: kept apart from config.json, so the config doesn't change on every check ----

interface State {
  lastCheck?: number;
  skipped?: string;
}

const statePath = () => join(dataHome(), "update.json");

function load(): State {
  try { return existsSync(statePath()) ? (JSON.parse(readFileSync(statePath(), "utf8")) as State) : {}; } catch { return {}; }
}

function store(s: State): void {
  try { mkdirSync(dataHome(), { recursive: true }); writeFileSync(statePath(), JSON.stringify(s)); } catch { /* best effort */ }
}

/** The daily check is due — and noting that it ran, so it runs once a day. */
export function takeDue(now = Date.now()): boolean {
  const s = load();
  const due = now - (s.lastCheck ?? 0) >= DAY_MS;
  if (due) store({ ...s, lastCheck: now });
  return due;
}

export function skipVersion(version: string): void {
  store({ ...load(), skipped: version });
}

export function isSkipped(version: string): boolean {
  return load().skipped === version;
}

// ---- restart into the new version ----

let restart = false;
/** Ask the TUI entry to start the program again after the app exits (`r` after an update). */
export function requestRestart(): void {
  restart = true;
}
export function restartRequested(): boolean {
  return restart;
}
