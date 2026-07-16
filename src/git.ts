// Git-per-build: init a repo in the build workspace and commit after each task,
// so every build has history + diffs (and a foundation for undo). Best-effort —
// if git isn't available or a command fails, builds carry on uninterrupted.

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface GitOut { ok: boolean; out: string; }

function git(dir: string, args: string[]): GitOut {
  try {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
  } catch {
    return { ok: false, out: "" };
  }
}

export function isRepo(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

/** git init + a local identity + an initial commit. Idempotent. Returns success. */
export function initRepo(dir: string): boolean {
  if (isRepo(dir)) return true;
  const gi = join(dir, ".gitignore");
  if (!existsSync(gi)) writeFileSync(gi, ".deploy/\nbuild-state.json\nnode_modules/\n");
  if (!git(dir, ["init"]).ok) return false;
  // Local identity so commits work even when the user has no global git config.
  git(dir, ["config", "user.email", "bot@projectinator.local"]);
  git(dir, ["config", "user.name", "Projectinator"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "chore: initial workspace", "--allow-empty"]);
  return true;
}

/** Commit whatever a task produced. Returns the short hash, or null on failure. */
export function commitTask(dir: string, taskId: string, title: string): string | null {
  if (!isRepo(dir)) return null;
  git(dir, ["add", "-A"]);
  const msg = `${taskId}: ${title}`.replace(/\s+/g, " ").slice(0, 72);
  const c = git(dir, ["commit", "-m", msg, "--allow-empty"]);
  if (!c.ok) return null;
  const h = git(dir, ["rev-parse", "--short", "HEAD"]);
  return h.ok ? h.out : null;
}

export interface Commit { hash: string; msg: string; }

/** Commit log, newest first. */
export function history(dir: string): Commit[] {
  if (!isRepo(dir)) return [];
  const r = git(dir, ["log", "--oneline", "--no-decorate", "--no-color"]);
  if (!r.ok || !r.out) return [];
  return r.out.split("\n").filter(Boolean).map((line) => {
    const i = line.indexOf(" ");
    return i < 0 ? { hash: line, msg: "" } : { hash: line.slice(0, i), msg: line.slice(i + 1) };
  });
}
