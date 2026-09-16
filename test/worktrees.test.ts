// Parallel code tasks in git worktrees. git.ts: two worktrees touching different files
// merge cleanly; touching the same lines conflicts, the merge is aborted (main tree
// intact), the worktree is removed. Orchestrator: with `isolate`, two ready code tasks
// really overlap; a conflict triggers exactly one serial rerun on the merged tree; without
// `isolate` they still serialize.

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRepo, addWorktree, mergeWorktree, pruneWorktrees, history, commitsAhead } from "../src/git.js";
import { runBacklog, type Isolation } from "../src/orchestrator.js";
import { lockRegistryToProvider } from "../src/roles.js";
import { DEFAULT_POLICY } from "../src/router.js";
import type { RoleExecutor, RoutingPolicy, Task } from "../src/types.js";

const hasGit = spawnSync("git", ["--version"]).status === 0;
const anthropic = lockRegistryToProvider("anthropic");
const policy = (o: Partial<RoutingPolicy> = {}): RoutingPolicy => ({ ...DEFAULT_POLICY, backendMode: "api", ...o });
const t = (id: string, capability: Task["capability"], dependsOn: string[] = []): Task => ({
  id, title: `${capability} ${id}`, capability, difficulty: "low", dependsOn, estTokens: { input: 5_000, output: 2_000 },
});
const tick = () => new Promise<void>((r) => setImmediate(r));

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-wt-"));
  writeFileSync(join(dir, "index.html"), "<h1>base</h1>\n");
  initRepo(dir);
  return dir;
}

describe.skipIf(!hasGit)("git worktrees", () => {
  it("disjoint changes from two worktrees merge into main; worktrees are gone afterwards", () => {
    const dir = repo();
    try {
      const a = addWorktree(dir, "A")!, b = addWorktree(dir, "B")!;
      writeFileSync(join(a.dir, "a.js"), "A");
      writeFileSync(join(b.dir, "b.js"), "B");
      expect(mergeWorktree(dir, a, "A: add a.js")).toEqual({ ok: true });
      expect(mergeWorktree(dir, b, "B: add b.js")).toEqual({ ok: true });
      expect(existsSync(join(dir, "a.js")) && existsSync(join(dir, "b.js"))).toBe(true);
      expect(history(dir).map((c) => c.msg)).toEqual(expect.arrayContaining(["A: add a.js", "B: add b.js"]));
      expect(existsSync(join(dir, ".worktrees", "A"))).toBe(false);
      expect(spawnSync("git", ["branch", "--list", "wt/*"], { cwd: dir, encoding: "utf8" }).stdout.trim()).toBe("");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("same-line edits conflict: merge aborted, main tree untouched, conflict paths reported", () => {
    const dir = repo();
    try {
      const a = addWorktree(dir, "A")!, b = addWorktree(dir, "B")!;
      writeFileSync(join(a.dir, "index.html"), "<h1>from A</h1>\n");
      writeFileSync(join(b.dir, "index.html"), "<h1>from B</h1>\n");
      expect(mergeWorktree(dir, a, "A")).toEqual({ ok: true });
      const r = mergeWorktree(dir, b, "B");
      expect(r).toEqual({ ok: false, conflicts: ["index.html"] });
      expect(readFileSync(join(dir, "index.html"), "utf8")).toBe("<h1>from A</h1>\n"); // A's merge kept, no conflict markers
      expect(spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout.trim()).toBe("");
      expect(existsSync(join(dir, ".worktrees", "B"))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("pruneWorktrees clears leftovers from a crash", () => {
    const dir = repo();
    try {
      addWorktree(dir, "stale");
      pruneWorktrees(dir);
      expect(spawnSync("git", ["worktree", "list"], { cwd: dir, encoding: "utf8" }).stdout.trim().split("\n")).toHaveLength(1);
      expect(commitsAhead(dir, "main")).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

/** Executor that tracks overlap and records the directory each task ran in. */
function tracker() {
  let active = 0, max = 0;
  const dirs: Record<string, string[]> = {};
  const exec: RoleExecutor = async ({ task, workspace }) => {
    (dirs[task.id] ??= []).push(workspace ?? "shared");
    active++; max = Math.max(max, active);
    await tick(); await tick();
    active--;
    return { finalText: `did ${task.id}`, files: [], cost: 0.1 };
  };
  return { exec, max: () => max, dirs };
}

describe("orchestrator with isolation", () => {
  const tasks = [t("A", "code"), t("B", "code"), t("C", "code")];

  it("without isolate, code tasks never overlap (the old guarantee)", async () => {
    const tr = tracker();
    await runBacklog(tasks, { policy: policy(), execute: tr.exec, registry: anthropic, concurrency: 3 });
    expect(tr.max()).toBe(1);
  });

  it("with isolate, code tasks overlap, run in their own dirs, and every result is merged", async () => {
    const tr = tracker();
    const merged: string[] = [];
    const isolate = (task: Task): Isolation => ({ dir: `/wt/${task.id}`, merge: (m) => { merged.push(m); return { ok: true }; }, discard: () => {} });
    const res = await runBacklog(tasks, { policy: policy(), execute: tr.exec, registry: anthropic, concurrency: 3, isolate });
    expect(tr.max()).toBe(3);
    expect(res.outcomes.map((o) => o.taskId).sort()).toEqual(["A", "B", "C"]);
    // The first launched code task keeps the shared dir; the ones launched alongside it are isolated.
    const isolated = Object.entries(tr.dirs).filter(([, d]) => d[0]!.startsWith("/wt/")).map(([id]) => id);
    expect(isolated).toHaveLength(2);
    expect(merged).toHaveLength(2);
  });

  it("a merge conflict discards the worktree result and reruns that task once, serially, with a note", async () => {
    const tr = tracker();
    const contexts: Record<string, string[]> = {};
    const exec: RoleExecutor = async (input) => { (contexts[input.task.id] ??= []).push(input.contextText); return tr.exec(input); };
    const events: string[] = [];
    let first = true;
    const isolate = (task: Task): Isolation => ({
      dir: `/wt/${task.id}`,
      merge: () => { if (first) { first = false; return { ok: false, conflicts: ["index.html"] }; } return { ok: true }; },
      discard: () => {},
    });
    const res = await runBacklog(tasks, { policy: policy(), execute: exec, registry: anthropic, concurrency: 3, isolate, onProgress: (e) => events.push(e.type) });
    expect(events.filter((e) => e === "merge_conflict")).toHaveLength(1);
    const rerun = Object.entries(tr.dirs).find(([, d]) => d.length === 2)!;
    expect(rerun[1]).toEqual([expect.stringMatching(/^\/wt\//), "shared"]); // worktree first, then the shared tree
    expect(contexts[rerun[0]]![1]).toMatch(/a parallel task changed index\.html/);
    expect(res.outcomes.filter((o) => o.taskId === rerun[0])).toHaveLength(2); // both attempts recorded
    expect(res.halted).toBe(false);
  });
});
