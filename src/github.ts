// GitHub — publish a build, open a pull request, export the backlog as issues. All through
// the `gh` CLI (your login, no tokens stored here), like deploy.ts does with vendor CLIs.
//
// Two rules, enforced here, so nothing surprising ever hits your account:
//   1. A repo WE created (Publish) is pushed to on `main`.
//   2. A repo with a pre-existing remote (an imported clone) is never pushed to on its base
//      branch: builds go on a `projectinator/...` branch and you open a PR.
//
// `gh` is invoked through an injectable runner so the logic is testable offline.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { BuildState } from "./build-state.js";
import { loadState, saveState, completedIds } from "./build-state.js";
import { checkoutNewBranch, currentBranch, push, remoteUrl, commitsAhead, isRepo } from "./git.js";

export interface CmdOut { ok: boolean; out: string }
export type Runner = (args: string[], cwd?: string) => CmdOut;

/** Default runner: the real `gh`. */
export const ghRun: Runner = (args, cwd) => {
  try {
    const r = spawnSync("gh", args, { cwd, encoding: "utf8" });
    return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
  } catch (e) {
    return { ok: false, out: e instanceof Error ? e.message : String(e) };
  }
};

export const GH_INSTALL_HINT = "install GitHub CLI (https://cli.github.com) and run `gh auth login`";

/** Is `gh` installed and logged in? Returns the account name when it is. */
export function ghStatus(run: Runner = ghRun): { ok: true; user: string } | { ok: false; error: string } {
  const v = run(["--version"]);
  if (!v.ok) return { ok: false, error: `GitHub CLI not found — ${GH_INSTALL_HINT}` };
  const s = run(["auth", "status"]);
  if (!s.ok) return { ok: false, error: `GitHub CLI is not logged in — run \`gh auth login\`` };
  const m = /account (\S+)/.exec(s.out) ?? /as (\S+)/.exec(s.out);
  return { ok: true, user: m?.[1] ?? "you" };
}

export interface GithubInfo {
  url: string;
  /** Created by Publish (we own it → push to main). False for a pre-existing remote (branch + PR only). */
  createdByProjectinator: boolean;
  /** The branch PRs target. */
  base: string;
}

function statePath(dir: string): string {
  return join(dir, "build-state.json");
}

function rememberGithub(dir: string, info: GithubInfo): void {
  const s = loadState(statePath(dir));
  if (!s) return;
  s.github = info;
  saveState(s, statePath(dir));
}

/** What we know about a project's GitHub repo. For an imported clone it is derived from
 *  the remote the FIRST time we look — and remembered, so the base branch is the one the
 *  user had checked out on import, not whatever branch a change build later switches to. */
export function githubInfo(dir: string): GithubInfo | undefined {
  const s = loadState(statePath(dir));
  if (s?.github) return s.github;
  const url = remoteUrl(dir);
  if (!url) return undefined;
  const info: GithubInfo = { url, createdByProjectinator: false, base: currentBranch(dir) ?? "main" };
  rememberGithub(dir, info);
  return info;
}

/** Repo name from a project label: lowercase, dashes, ≤ 64 chars. */
export function repoSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "projectinator-app";
}

/** Publish: create a GitHub repo from the workspace and push `main`. Idempotent for repos
 *  we created (a second call pushes). Refuses for a pre-existing remote — use a PR. */
export function publish(
  dir: string,
  name: string,
  visibility: "private" | "public",
  run: Runner = ghRun,
): { ok: true; url: string; action: "created" | "pushed" } | { ok: false; error: string } {
  if (!isRepo(dir)) return { ok: false, error: "This project has no git history yet — build something first." };
  const info = githubInfo(dir);
  if (info && !info.createdByProjectinator) {
    return { ok: false, error: `This project came with its own remote (${info.url}). Projectinator never pushes to its ${info.base} — use “Open a pull request” instead.` };
  }
  const branch = currentBranch(dir) ?? "main";
  if (info) {
    const p = push(dir, branch);
    return p.ok ? { ok: true, url: info.url, action: "pushed" } : { ok: false, error: `git push failed: ${p.out}` };
  }
  const r = run(["repo", "create", repoSlug(name), `--${visibility}`, "--source", ".", "--remote", "origin", "--push"], dir);
  if (!r.ok) return { ok: false, error: `gh repo create failed: ${r.out}` };
  const url = (remoteUrl(dir) ?? (/(https:\/\/github\.com\/\S+)/.exec(r.out)?.[1] ?? "")).replace(/\.git$/, "");
  rememberGithub(dir, { url, createdByProjectinator: true, base: branch });
  return { ok: true, url, action: "created" };
}

/** Branch name for a change build: projectinator/<slug>-<yyyymmdd-hhmm>. */
export function changeBranchName(idea: string, now = new Date()): string {
  const ts = now.toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
  return `projectinator/${repoSlug(idea).slice(0, 32)}-${ts}`;
}

/** Start a change build on its own branch (only meaningful when a remote exists). */
export function startChangeBranch(dir: string, idea: string): string | undefined {
  if (!githubInfo(dir)) return undefined;
  const name = changeBranchName(idea);
  return checkoutNewBranch(dir, name) ? name : undefined;
}

/** Markdown PR body from the build state: what was built, cost, verdicts. */
export function prBody(state: BuildState, branchTasks: string[]): string {
  const done = completedIds(state);
  const rows = state.tasks
    .filter((t) => branchTasks.includes(t.id))
    .map((t) => {
      const last = [...state.outcomes].reverse().find((o) => o.taskId === t.id);
      const verdict = last?.verdict ? (last.verdict.passed ? "PASS" : "FAIL") : "";
      return `| \`${t.id}\` | ${t.capability} | ${t.title} | ${done.has(t.id) ? "✓" : "✗"} ${verdict} |`;
    });
  const cost = state.outcomes.filter((o) => branchTasks.includes(o.taskId)).reduce((a, o) => a + o.cost, 0);
  return [
    `Built by [Projectinator](https://github.com/smanookian/projectinator) — one commit per task.`,
    "",
    `**Request:** ${state.idea ?? state.id}`,
    "",
    "| Task | Role | Title | Result |",
    "|---|---|---|---|",
    ...rows,
    "",
    `Cost: $${cost.toFixed(2)} · Status: ${state.status}${state.haltReason ? ` (${state.haltReason})` : ""}`,
  ].join("\n");
}

/** Push the current branch and open a PR against the base. */
export function openPullRequest(
  dir: string,
  title: string,
  body: string,
  run: Runner = ghRun,
): { ok: true; url: string } | { ok: false; error: string } {
  const info = githubInfo(dir);
  if (!info) return { ok: false, error: "No GitHub remote — Publish the project first." };
  const branch = currentBranch(dir);
  if (!branch || branch === info.base) return { ok: false, error: `You're on ${info.base}; a pull request needs a branch. Change builds on published projects get one automatically.` };
  if (commitsAhead(dir, info.base, branch) === 0) return { ok: false, error: `Branch ${branch} has no commits beyond ${info.base}.` };
  const p = push(dir, branch);
  if (!p.ok) return { ok: false, error: `git push failed: ${p.out}` };
  const r = run(["pr", "create", "--base", info.base, "--head", branch, "--title", title, "--body", body], dir);
  if (!r.ok) return { ok: false, error: `gh pr create failed: ${r.out}` };
  const url = /(https:\/\/github\.com\/\S+\/pull\/\d+)/.exec(r.out)?.[1] ?? r.out.trim();
  return { ok: true, url };
}

/** Export the backlog as issues: one per task not yet exported, epic as a label. Records
 *  issue URLs on the state so re-running only adds new tasks. */
export function exportIssues(
  dir: string,
  run: Runner = ghRun,
): { ok: true; created: number; skipped: number } | { ok: false; error: string } {
  if (!githubInfo(dir)) return { ok: false, error: "No GitHub remote — Publish the project first." };
  const s = loadState(statePath(dir));
  if (!s) return { ok: false, error: "No project data." };
  const done = completedIds(s);
  const issues = { ...(s.githubIssues ?? {}) };
  const labels = new Set<string>();
  let created = 0, skipped = 0;
  for (const t of s.tasks) {
    if (issues[t.id]) { skipped++; continue; }
    const label = t.epic || "General";
    if (!labels.has(label)) { run(["label", "create", label, "--force", "--color", "e0a72d"], dir); labels.add(label); }
    const body = [
      `**Role:** ${t.capability} · **Difficulty:** ${t.difficulty}${t.dependsOn?.length ? ` · **After:** ${t.dependsOn.join(", ")}` : ""}`,
      `**Status:** ${done.has(t.id) ? "done" : "todo"}`,
      ...(t.notes ? ["", `> ${t.notes}`] : []),
      "", "_Exported from Projectinator._",
    ].join("\n");
    const r = run(["issue", "create", "--title", `[${t.id}] ${t.title}`, "--body", body, "--label", label], dir);
    if (!r.ok) return { ok: false, error: `gh issue create failed on ${t.id}: ${r.out}` };
    issues[t.id] = /(https:\/\/github\.com\/\S+\/issues\/\d+)/.exec(r.out)?.[1] ?? r.out.trim();
    created++;
    s.githubIssues = issues;
    saveState(s, statePath(dir)); // after each, so a mid-way failure doesn't duplicate on retry
  }
  return { ok: true, created, skipped };
}
