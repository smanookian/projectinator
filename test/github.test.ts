// GitHub integration with NO network and NO real gh: a local bare repo stands in for
// origin (real pushes), and a fake runner records what gh would have been asked to do.
// Pins the two safety rules: repos we created push to main; imported remotes only get
// branches + PRs.

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRepo, commitTask, currentBranch, remoteUrl, commitsAhead } from "../src/git.js";
import { ghStatus, publish, openPullRequest, startChangeBranch, changeBranchName, repoSlug, prBody, exportIssues, githubInfo, type Runner } from "../src/github.js";
import { newBuildState, saveState, loadState } from "../src/build-state.js";
import { importProject } from "../src/tui/engine.js";

const hasGit = spawnSync("git", ["--version"]).status === 0;
const git = (dir: string, ...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });

/** A fake gh: records calls; `repo create` wires a local bare remote and pushes, like the real one. */
function fakeGh(): { run: Runner; calls: string[][]; bare: string } {
  const bare = mkdtempSync(join(tmpdir(), "pi-bare-"));
  git(bare, "init", "--bare", "-q", "-b", "main");
  const calls: string[][] = [];
  const run: Runner = (args, cwd) => {
    calls.push(args);
    if (args[0] === "--version") return { ok: true, out: "gh version 2.100.0" };
    if (args[0] === "auth") return { ok: true, out: "Logged in to github.com account tester (keyring)" };
    if (args[0] === "repo" && args[1] === "create") {
      git(cwd!, "remote", "add", "origin", bare);
      const p = git(cwd!, "push", "-u", "origin", "HEAD");
      return { ok: p.status === 0, out: `https://github.com/tester/${args[2]}\n${p.stderr}` };
    }
    if (args[0] === "pr") return { ok: true, out: "https://github.com/tester/x/pull/7" };
    if (args[0] === "label") return { ok: true, out: "" };
    if (args[0] === "issue") return { ok: true, out: `https://github.com/tester/x/issues/${calls.filter((c) => c[0] === "issue").length}` };
    return { ok: false, out: `unexpected gh ${args.join(" ")}` };
  };
  return { run, calls, bare };
}

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-gh-"));
  writeFileSync(join(dir, "index.html"), "<h1>v1</h1>");
  const s = newBuildState("p", [
    { id: "C-1", title: "Build index.html", capability: "code", difficulty: "low", dependsOn: [], epic: "Site", estTokens: { input: 1, output: 1 } },
    { id: "T-1", title: "Test it", capability: "test", difficulty: "low", dependsOn: ["C-1"], epic: "Site", estTokens: { input: 1, output: 1 } },
  ], "my landing page");
  s.outcomes = [
    { taskId: "C-1", capability: "code", provider: "anthropic", modelId: "m", round: 0, cost: 0.3, finalText: "", files: ["index.html"] },
    { taskId: "T-1", capability: "test", provider: "google", modelId: "m", round: 0, cost: 0.05, finalText: "", files: ["index.html"], verdict: { passed: true, bugs: [], runtimeChecked: true } },
  ];
  s.status = "complete";
  saveState(s, join(dir, "build-state.json"));
  initRepo(dir);
  commitTask(dir, "C-1", "Build index.html");
  return dir;
}

describe("ghStatus", () => {
  it("reports the account, or a clear error when gh is missing / logged out", () => {
    const { run } = fakeGh();
    expect(ghStatus(run)).toEqual({ ok: true, user: "tester" });
    expect(ghStatus(() => ({ ok: false, out: "" }))).toMatchObject({ ok: false, error: expect.stringMatching(/not found/) });
    expect(ghStatus((a) => ({ ok: a[0] === "--version", out: "" }))).toMatchObject({ ok: false, error: expect.stringMatching(/not logged in/) });
  });
});

describe.skipIf(!hasGit)("publish + push (repo we created)", () => {
  it("creates the repo, pushes main, remembers ownership; a second publish just pushes", () => {
    const dir = project();
    const { run, calls, bare } = fakeGh();
    try {
      const r = publish(dir, "My Landing Page!", "private", run);
      expect(r).toMatchObject({ ok: true, action: "created" });
      expect(calls.find((c) => c[1] === "create")).toEqual(["repo", "create", "my-landing-page", "--private", "--source", ".", "--remote", "origin", "--push"]);
      expect(githubInfo(dir)).toMatchObject({ createdByProjectinator: true, base: currentBranch(dir) });
      // the bare "origin" really received the commits
      expect(currentBranch(dir)).toBe("main"); // regardless of the machine's init.defaultBranch
      expect(git(bare, "log", "--oneline", "main").stdout).toMatch(/C-1: Build index.html/);
      // exclude list keeps bookkeeping out of what was pushed
      expect(git(bare, "ls-tree", "-r", "--name-only", "main").stdout).not.toMatch(/build-state\.json/);
      // second call: a new commit, publish again → plain push, no repo create
      writeFileSync(join(dir, "index.html"), "<h1>v2</h1>");
      commitTask(dir, "C-2", "Update");
      const again = publish(dir, "whatever", "private", run);
      expect(again).toMatchObject({ ok: true, action: "pushed" });
      expect(calls.filter((c) => c[1] === "create")).toHaveLength(1);
      expect(git(bare, "log", "--oneline", "main").stdout).toMatch(/C-2: Update/);
    } finally {
      rmSync(dir, { recursive: true, force: true }); rmSync(bare, { recursive: true, force: true });
    }
  });

  it("build-state.json and .checks never reach the remote (info/exclude)", () => {
    const dir = project();
    mkdirSync(join(dir, ".checks")); writeFileSync(join(dir, ".checks", "x.png"), "png");
    commitTask(dir, "T-1", "Test it"); // git add -A after the exclude was written
    expect(git(dir, "ls-files").stdout.split("\n")).not.toContain("build-state.json");
    expect(git(dir, "ls-files").stdout).not.toMatch(/\.checks/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe.skipIf(!hasGit)("imported repo with its own remote (branch + PR only)", () => {
  function importedWithRemote(): { dir: string; bare: string; src: string } {
    // A "user repo": has main with a commit and an origin.
    const bare = mkdtempSync(join(tmpdir(), "pi-bare-")); git(bare, "init", "--bare", "-q", "-b", "main");
    const src = mkdtempSync(join(tmpdir(), "pi-src-"));
    git(src, "init", "-q", "-b", "main"); git(src, "config", "user.email", "u@x"); git(src, "config", "user.name", "u");
    writeFileSync(join(src, "index.html"), "<h1>theirs</h1>"); git(src, "add", "-A"); git(src, "commit", "-q", "-m", "their initial");
    git(src, "remote", "add", "origin", bare); git(src, "push", "-q", "-u", "origin", "main");
    const r = importProject(src, "their site");
    if (!r.ok) throw new Error(r.error);
    return { dir: r.dir, bare, src };
  }

  it("import keeps .git and the remote; publish refuses; a change build gets a branch; PR pushes only that branch", () => {
    const { dir, bare, src } = importedWithRemote();
    const { run, calls } = fakeGh();
    try {
      expect(remoteUrl(dir)).toBe(bare);
      expect(githubInfo(dir)).toMatchObject({ createdByProjectinator: false, base: "main" });
      expect(publish(dir, "x", "private", run)).toMatchObject({ ok: false, error: expect.stringMatching(/never pushes to its main/) });

      const branch = startChangeBranch(dir, "add a contact form")!;
      expect(branch).toMatch(/^projectinator\/add-a-contact-form-\d{8}-\d{4}$/);
      expect(currentBranch(dir)).toBe(branch);
      // before any commit, a PR is refused
      expect(openPullRequest(dir, "t", "b", run)).toMatchObject({ ok: false, error: expect.stringMatching(/no commits beyond main/) });

      writeFileSync(join(dir, "contact.html"), "<form></form>");
      commitTask(dir, "C-9", "Add contact form");
      expect(commitsAhead(dir, "main")).toBe(1);
      const pr = openPullRequest(dir, "Projectinator: add a contact form", "body", run);
      expect(pr).toEqual({ ok: true, url: "https://github.com/tester/x/pull/7" });
      expect(calls.at(-1)).toEqual(["pr", "create", "--base", "main", "--head", branch, "--title", "Projectinator: add a contact form", "--body", "body"]);
      // origin/main untouched; the branch arrived
      expect(git(bare, "log", "--oneline", "main").stdout.trim()).toMatch(/their initial$/);
      expect(git(bare, "log", "--oneline", branch).stdout).toMatch(/C-9: Add contact form/);
    } finally {
      for (const d of [dir, bare, src]) rmSync(d, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasGit)("issues + PR body", () => {
  it("exports one issue per task with the epic as label, records URLs, and skips them on re-run", () => {
    const dir = project();
    const { run, calls, bare } = fakeGh();
    try {
      publish(dir, "p", "private", run);
      const first = exportIssues(dir, run);
      expect(first).toEqual({ ok: true, created: 2, skipped: 0 });
      const issueCalls = calls.filter((c) => c[0] === "issue");
      expect(issueCalls[0]).toEqual(expect.arrayContaining(["--title", "[C-1] Build index.html", "--label", "Site"]));
      expect(calls.filter((c) => c[0] === "label")).toHaveLength(1); // one label create per epic
      expect(loadState(join(dir, "build-state.json"))!.githubIssues).toEqual({ "C-1": "https://github.com/tester/x/issues/1", "T-1": "https://github.com/tester/x/issues/2" });
      expect(exportIssues(dir, run)).toEqual({ ok: true, created: 0, skipped: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true }); rmSync(bare, { recursive: true, force: true });
    }
  });

  it("prBody lists the tasks with results and the cost", () => {
    const dir = project();
    try {
      const body = prBody(loadState(join(dir, "build-state.json"))!, ["C-1", "T-1"]);
      expect(body).toContain("| `C-1` | code | Build index.html | ✓  |");
      expect(body).toContain("| `T-1` | test | Test it | ✓ PASS |");
      expect(body).toContain("Cost: $0.35");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("repoSlug and changeBranchName are GitHub-safe", () => {
    expect(repoSlug("My Cool App (v2)!")).toBe("my-cool-app-v2");
    expect(changeBranchName("Add dark mode", new Date("2026-09-15T13:07:00Z"))).toBe("projectinator/add-dark-mode-20260915-1307");
  });
});
