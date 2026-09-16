// Prepare a build-stack project for testing: install (npm ci --ignore-scripts), build
// (vite build), cached by a hash of package.json + lockfile so the Tester's repeated
// check_app calls and feedback rounds don't pay the install twice. A failure returns the
// command's output tail — that IS the bug the Tester needs to see. Static = no-op.
// Design: docs/STACKS.md.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StackProfile } from "./stack.js";

export interface PrepareResult {
  ok: boolean;
  /** Which directory to serve for the tester (the project, or its outDir after a build). */
  serveDir: string;
  /** What ran, for the check_app reply. Empty when nothing was needed. */
  log: string[];
  /** On failure: which step and the last lines of its output. */
  failedStep?: "install" | "build";
  output?: string;
  /** True when the failure smells like a blocked install script (STACKS.md decision 1). */
  scriptsBlocked?: boolean;
}

const TAIL = 40;
const STEP_TIMEOUT_MS = 3 * 60_000;

function tail(s: string): string {
  return s.trim().split("\n").slice(-TAIL).join("\n");
}

function run(dir: string, cmd: string[]): { ok: boolean; out: string } {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd: dir, encoding: "utf8", timeout: STEP_TIMEOUT_MS, env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { ok: r.status === 0 && !r.error, out: r.error ? `${out}\n${r.error.message}` : out };
}

/** Hash of the inputs that decide whether install/build must run again. */
function inputsHash(dir: string, profile: StackProfile): string {
  const h = createHash("sha1").update(profile.id);
  for (const f of ["package.json", "package-lock.json", "npm-shrinkwrap.json", "vite.config.ts", "vite.config.js", "tsconfig.json", "requirements.txt", "pyproject.toml"]) {
    const p = join(dir, f);
    if (existsSync(p)) h.update(f).update(readFileSync(p));
  }
  h.update(String(profile.install?.join(" ")));
  return h.digest("hex");
}

/** Source files whose change invalidates a build (not an install). Cheap: mtimes of src/ + index.html. */
function sourceStamp(dir: string): string {
  const h = createHash("sha1");
  const walk = (d: string, depth: number) => {
    if (depth > 4 || !existsSync(d)) return;
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name === "dist" || name === "__pycache__" || name.startsWith(".")) continue;
      const p = join(d, name);
      try {
        const st = statSync(p);
        if (st.isDirectory()) walk(p, depth + 1);
        else h.update(p).update(String(st.mtimeMs)).update(String(st.size));
      } catch { /* skip */ }
    }
  };
  walk(dir, 0);
  return h.digest("hex");
}

/** Run install/build if needed. Never throws. */
export function prepareForTest(dir: string, profile: StackProfile): PrepareResult {
  if (!profile.install && !profile.build) return { ok: true, serveDir: dir, log: [] };
  const serveDir = profile.outDir ? join(dir, profile.outDir) : dir;
  const stampDir = join(dir, ".checks");
  mkdirSync(stampDir, { recursive: true });
  const stampPath = join(stampDir, "prepare.json");
  let stamp: { inputs?: string; source?: string } = {};
  try { stamp = JSON.parse(readFileSync(stampPath, "utf8")); } catch { /* first run */ }
  const inputs = inputsHash(dir, profile);
  const log: string[] = [];

  if (profile.install) {
    const manifest = profile.manifest ?? "package.json";
    if (!existsSync(join(dir, manifest))) {
      return { ok: false, serveDir, log, failedStep: "install", output: manifest === "package.json" ? "package.json is missing — the project must be a real npm project (package.json + package-lock.json)." : `${manifest} is missing — the project must list its dependencies there (pinned versions).` };
    }
    if (stamp.inputs !== inputs || !existsSync(join(dir, profile.installDir ?? "node_modules"))) {
      const r = run(dir, profile.install);
      log.push(`${profile.install.at(-1)!.length > 40 ? profile.install.at(-1) : profile.install.join(" ")} → ${r.ok ? "ok" : "FAILED"}`);
      if (!r.ok) {
        const scriptsBlocked = /postinstall|prepare script|install script|gyp|node-pre-gyp|husky/i.test(r.out);
        return { ok: false, serveDir, log, failedStep: "install", output: tail(r.out), scriptsBlocked };
      }
      stamp = { inputs }; // invalidate any build
      writeFileSync(stampPath, JSON.stringify(stamp));
    } else log.push("install: up to date (cached)");
  }

  if (profile.build) {
    const source = sourceStamp(dir);
    if (stamp.source !== source || !existsSync(serveDir)) {
      const r = run(dir, profile.build);
      log.push(`${profile.build.join(" ")} → ${r.ok ? "ok" : "FAILED"}`);
      if (!r.ok) return { ok: false, serveDir, log, failedStep: "build", output: tail(r.out) };
      writeFileSync(stampPath, JSON.stringify({ ...stamp, source }));
    } else log.push("build: up to date (cached)");
    if (!existsSync(join(serveDir, profile.entry || "index.html"))) {
      return { ok: false, serveDir, log, failedStep: "build", output: `build finished but ${profile.outDir}/${profile.entry || "index.html"} does not exist — check vite.config build.outDir.` };
    }
  }
  return { ok: true, serveDir, log };
}
