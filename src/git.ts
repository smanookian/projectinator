// Git-per-build: init a repo in the build workspace and commit after each task,
// so every build has history + diffs (and a foundation for undo). Best-effort —
// if git isn't available or a command fails, builds carry on uninterrupted.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface GitOut { ok: boolean; out: string; }

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

/** Files that are project bookkeeping, never source. Kept out of every project repo via
 *  .git/info/exclude (per-clone, never committed) so an imported repo's own .gitignore is
 *  left alone and a pushed repo never carries build-state or screenshots. */
const EXCLUDE = [".deploy/", ".checks/", ".worktrees/", "build-state.json", "export.md", "export.csv", "export-jira.csv", "export-trello.csv"];

function writeExclude(dir: string, extra: string[] = []): void {
  try {
    const p = join(dir, ".git", "info", "exclude");
    mkdirSync(join(dir, ".git", "info"), { recursive: true });
    const cur = existsSync(p) ? readFileSync(p, "utf8") : "";
    const missing = [...EXCLUDE, ...extra].filter((l) => !cur.split("\n").includes(l));
    if (missing.length) writeFileSync(p, `${cur.trimEnd()}\n# projectinator\n${missing.join("\n")}\n`);
  } catch { /* best effort */ }
}

/** git init + a local identity + an initial commit. Idempotent: an existing repo (e.g. an
 *  imported one) is kept as is, only the exclude list is added. Returns success. */
export function initRepo(dir: string, extraExclude: string[] = []): boolean {
  if (isRepo(dir)) { writeExclude(dir, extraExclude); return true; }
  const gi = join(dir, ".gitignore");
  if (!existsSync(gi)) writeFileSync(gi, ".deploy/\n.checks/\nbuild-state.json\nnode_modules/\n");
  if (!git(dir, ["init", "-b", "main"]).ok) return false; // GitHub's default; ignore the machine's init.defaultBranch
  writeExclude(dir, extraExclude);
  // Local identity so commits work even when the user has no global git config.
  git(dir, ["config", "user.email", "bot@projectinator.local"]);
  git(dir, ["config", "user.name", "Projectinator"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "chore: initial workspace", "--allow-empty"]);
  return true;
}

/** Name of the checked-out branch, or undefined (no repo / detached). */
export function currentBranch(dir: string): string | undefined {
  const r = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return r.ok && r.out && r.out !== "HEAD" ? r.out : undefined;
}

/** Create and switch to a new branch at HEAD. Returns success. */
export function checkoutNewBranch(dir: string, name: string): boolean {
  return git(dir, ["checkout", "-b", name]).ok;
}

/** URL of the `origin` remote, or undefined. */
export function remoteUrl(dir: string): string | undefined {
  const r = git(dir, ["remote", "get-url", "origin"]);
  return r.ok && r.out ? r.out : undefined;
}

/** `git push -u origin <branch>`. */
export function push(dir: string, branch: string): GitOut {
  return git(dir, ["push", "-u", "origin", branch]);
}

/** Commits on `branch` that aren't on `base` (both local refs). 0 when unknown. */
export function commitsAhead(dir: string, base: string, branch = "HEAD"): number {
  const r = git(dir, ["rev-list", "--count", `${base}..${branch}`]);
  return r.ok ? Number(r.out) || 0 : 0;
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

/** Hard-reset one commit back (undo the last task's file changes). Returns the
 *  reverted task id parsed from the commit message. Refuses to undo past the
 *  initial commit. */
export function undoLastCommit(dir: string): { ok: boolean; taskId?: string } {
  if (!isRepo(dir)) return { ok: false };
  const commits = history(dir);
  if (commits.length <= 1) return { ok: false }; // nothing but the initial commit
  const taskId = (commits[0]?.msg.split(":")[0] ?? "").trim() || undefined;
  const r = git(dir, ["reset", "--hard", "HEAD~1"]);
  return { ok: r.ok, taskId };
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

export interface CommitDiff { stat: string[]; patch: string[]; }

/** `--stat` summary + the full patch for one commit (vs its parent). Untracked
 *  binaries show as "Binary files differ". Lines, not one blob, so the TUI can page. */
export function commitDiff(dir: string, hash: string): CommitDiff {
  if (!isRepo(dir)) return { stat: [], patch: [] };
  const stat = git(dir, ["show", "--stat", "--format=", "--no-color", hash]);
  const patch = git(dir, ["show", "--format=", "--no-color", hash]);
  const lines = (o: GitOut) => (o.ok && o.out ? o.out.split("\n") : []);
  return { stat: lines(stat), patch: lines(patch) };
}

// ---- worktrees: parallel code tasks without sharing a working directory ----

export interface Worktree { dir: string; branch: string }

/** A throwaway branch + worktree at HEAD, under <repo>/.worktrees/<name>. */
export function addWorktree(dir: string, name: string): Worktree | undefined {
  const branch = `wt/${name}`;
  const wtDir = join(dir, ".worktrees", name);
  mkdirSync(join(dir, ".worktrees"), { recursive: true });
  const r = git(dir, ["worktree", "add", "-b", branch, wtDir, "HEAD"]);
  if (!r.ok) return undefined;
  git(wtDir, ["config", "user.email", "bot@projectinator.local"]);
  git(wtDir, ["config", "user.name", "Projectinator"]);
  return { dir: wtDir, branch };
}

/** Commit everything in the worktree, merge its branch into the main checkout, and remove
 *  it. On a conflict the merge is aborted and the conflicting paths returned — the caller
 *  decides (Projectinator re-runs the task serially on the merged tree). */
export function mergeWorktree(dir: string, wt: Worktree, message: string): { ok: true } | { ok: false; conflicts: string[] } {
  git(wt.dir, ["add", "-A"]);
  git(wt.dir, ["commit", "-q", "-m", message, "--allow-empty"]);
  const m = git(dir, ["merge", "--no-ff", "--no-edit", "-m", message, wt.branch]);
  if (!m.ok) {
    const conflicts = git(dir, ["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean);
    git(dir, ["merge", "--abort"]);
    removeWorktree(dir, wt);
    return { ok: false, conflicts };
  }
  removeWorktree(dir, wt);
  return { ok: true };
}

export function removeWorktree(dir: string, wt: Worktree): void {
  git(dir, ["worktree", "remove", "--force", wt.dir]);
  git(dir, ["branch", "-D", wt.branch]);
}

/** Drop any leftover worktrees (e.g. after a crash). */
export function pruneWorktrees(dir: string): void {
  const list = git(dir, ["worktree", "list", "--porcelain"]).out;
  for (const line of list.split("\n")) {
    const m = /^worktree (.+\/\.worktrees\/.+)$/.exec(line);
    if (m) git(dir, ["worktree", "remove", "--force", m[1]!]);
  }
  git(dir, ["worktree", "prune"]);
  for (const b of git(dir, ["branch", "--list", "wt/*", "--format=%(refname:short)"]).out.split("\n").filter(Boolean)) git(dir, ["branch", "-D", b]);
}
