// Drive the real <App/> to the two pagers (Transcripts, History → diff) with on-disk
// fixture projects. Both live in ONE file on purpose: they mutate the shared
// .workspace/tui directory, and vitest runs files in parallel — a sibling's cleanup
// mid-navigation re-renders the Projects list and resets the cursor.
//
// Regression pinned here: the pagers must fit the 24-row frame. When the page size
// ignored the frame chrome, Yoga squeezed a row and two lines rendered on top of each
// other ("Used a gradient background.tered card.").

import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import App from "../src/tui/App.js";
import { projectRoot } from "../src/tui/engine.js";
import { initRepo, commitTask, history, commitDiff } from "../src/git.js";

const DOWN = "\u001b[B";
const ENTER = "\r";
const PGDN = "\u001b[6~";
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
/** Poll until `pred` holds (Ink processes stdin asynchronously; under parallel-worker
 *  load a fixed delay is not enough and a walker would overshoot the menu row). */
async function until(pred: () => boolean, frame: () => string, timeoutMs = 2000): Promise<boolean> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeoutMs) {
      if (timeoutMs >= 2000) throw new Error(`timed out waiting for the UI\n${frame()}`);
      return false;
    }
    await tick(10);
  }
  return true;
}
const hasGit = spawnSync("git", ["--version"]).status === 0;

/** Mount the app with a key present (→ "Ready" setup screen) and a menu walker. */
function mountApp() {
  const prevKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY ||= "test";
  const { lastFrame, stdin, unmount } = render(<App />);
  const frame = () => lastFrame() ?? "";
  const highlighted = () => frame().split("\n").find((l) => l.includes("❯")) ?? "";
  /** Move down until `label` is the highlighted row, press Enter, wait for the screen to change. */
  const pick = async (label: string) => {
    await until(() => highlighted() !== "", frame); // a menu is on screen (rows may scroll)
    // A menu's useInput subscribes one tick after it renders; a keypress sent before
    // that is dropped, so resend DOWN whenever the highlight doesn't move.
    for (let i = 0; i < 40 && !highlighted().includes(label); i++) {
      const before = highlighted();
      stdin.write(DOWN);
      await until(() => highlighted() !== before, frame, 150);
    }
    if (!highlighted().includes(label)) throw new Error(`menu item not reachable: ${label}\n${frame()}`);
    const before = frame();
    for (let i = 0; i < 10 && frame() === before; i++) {
      stdin.write(ENTER);
      await until(() => frame() !== before, frame, 150);
    }
    if (frame() === before) throw new Error(`Enter did nothing on: ${label}\n${frame()}`);
  };
  const close = () => { unmount(); if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY; };
  return { frame, stdin, pick, close };
}

const fixtureDir = (slug: string) => join(projectRoot(), ".workspace", "tui", slug);

describe("transcript viewer", () => {
  it("renders every line intact inside the frame and pages", async () => {
    const dir = fixtureDir("test-transcript-fixture");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "build-state.json"), JSON.stringify({
      id: "test-transcript-fixture", idea: "transcript fixture", status: "complete", totalCost: 0.25,
      tasks: [{ id: "C-1", title: "Build index.html", capability: "code", difficulty: "low", dependsOn: [], estTokens: { input: 1, output: 1 } }],
      outcomes: [{
        taskId: "C-1", capability: "code", provider: "anthropic", modelId: "claude-opus-5", round: 0, cost: 0.25, files: ["index.html"],
        finalText: ["FIRST-LINE-MARKER centered card.", "SECOND-LINE-MARKER gradient.", ...Array.from({ length: 40 }, (_, i) => `detail ${i + 1}`)].join("\n"),
      }],
    }));
    const app = mountApp();
    try {
      await tick(150);
      await app.pick("Start a build");
      await app.pick("Projects (");
      await app.pick("transcript fixture");
      await app.pick("Transcripts (what each role said)");
      await app.pick("C-1");
      const f = app.frame();
      expect(f).toContain("FIRST-LINE-MARKER centered card.");
      expect(f).toContain("SECOND-LINE-MARKER gradient.");
      expect(f).not.toContain("gradient.tered"); // the overlap symptom
      expect(f.split("\n").length).toBeLessThanOrEqual(24);
      const m = f.match(/lines 1–(\d+) of 44/); // 42 text lines + blank + "Files after this run"
      expect(m).not.toBeNull();
      app.stdin.write(PGDN);
      await tick();
      expect(app.frame()).toContain(`lines ${Number(m![1]) + 1}–`);
    } finally {
      app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasGit)("commit diff", () => {
  const dir = fixtureDir("test-diff-fixture");

  function fixture(): string {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "build-state.json"), JSON.stringify({
      id: "test-diff-fixture", idea: "diff fixture", status: "complete", totalCost: 0.1,
      tasks: [{ id: "C-1", title: "Build index.html", capability: "code", difficulty: "low", dependsOn: [], estTokens: { input: 1, output: 1 } }],
      outcomes: [],
    }));
    initRepo(dir);
    writeFileSync(join(dir, "index.html"), "<h1>ADDED-LINE-MARKER</h1>\n");
    return commitTask(dir, "C-1", "Build index.html")!;
  }

  it("commitDiff returns the stat and the patch for a task commit", () => {
    const hash = fixture();
    try {
      const d = commitDiff(dir, hash);
      expect(d.stat.join("\n")).toMatch(/index\.html.*\|/);
      expect(d.patch).toContain("+<h1>ADDED-LINE-MARKER</h1>");
      expect(history(dir)[0]!.hash).toBe(hash);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("History → pick a commit → the diff renders inside the frame", async () => {
    fixture();
    const app = mountApp();
    try {
      await tick(150);
      await app.pick("Start a build");
      await app.pick("Projects (");
      await app.pick("diff fixture");
      await app.pick("History (per-task commits)");
      await app.pick("C-1: Build index.html");
      const first = app.frame();
      expect(first).toMatch(/index\.html.*\|/); // the --stat line, page 1
      expect(first.split("\n").length).toBeLessThanOrEqual(24);
      app.stdin.write(PGDN); // → the hunk
      await tick();
      expect(app.frame()).toContain("+<h1>ADDED-LINE-MARKER</h1>");
    } finally {
      app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("import an existing folder", () => {
  it("Home → Import → path → lands on the project screen with Add-to-backlog available", async () => {
    const src = join(projectRoot(), ".workspace", "tui-import-src");
    rmSync(src, { recursive: true, force: true });
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "index.html"), "<h1>hi</h1>");
    const app = mountApp();
    let dir: string | undefined;
    try {
      await tick(150);
      await app.pick("Start a build");
      await app.pick("Import an existing folder");
      await until(() => app.frame().includes("Import an existing folder as a project"), app.frame);
      // Same race as menus: the input subscribes a tick after render. Type, verify, retry.
      for (let i = 0; i < 10 && !app.frame().includes(src.slice(-12)); i++) {
        app.stdin.write(src);
        await until(() => app.frame().includes(src.slice(-12)), app.frame, 150);
      }
      expect(app.frame()).toContain(src.slice(-12));
      app.stdin.write(ENTER);
      await until(() => app.frame().includes("Imported 1 file"), app.frame);
      const f = app.frame();
      expect(f).toContain("Add to backlog");
      expect(f).toContain("Imported: tui-import-src");
      dir = join(projectRoot(), ".workspace", "tui", "imported-tui-import-src");
      expect(existsSync(join(dir, "index.html"))).toBe(true);
    } finally {
      app.close();
      rmSync(src, { recursive: true, force: true });
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sprints & burndown", () => {
  it("shows one row per sprint with velocity, and ←/→ switches the burndown between sprints", async () => {
    const dir = fixtureDir("test-sprints-fixture");
    mkdirSync(dir, { recursive: true });
    const task = (id: string) => ({ id, title: id, capability: "code", difficulty: "low", dependsOn: [], estTokens: { input: 1, output: 1 } });
    const out = (taskId: string, cost: number) => ({ taskId, capability: "code", provider: "anthropic", modelId: "m", round: 0, cost, files: [], finalText: "" });
    writeFileSync(join(dir, "build-state.json"), JSON.stringify({
      id: "test-sprints-fixture", idea: "sprints fixture", status: "complete", totalCost: 0.3,
      tasks: [task("S1-A"), task("S1-B"), task("S2-C")],
      outcomes: [out("S1-A", 0.1), out("S1-B", 0.1), out("S2-C", 0.1)],
      sprints: [
        { n: 1, startedAt: 1000, endedAt: 121_000, taskIds: ["S1-A", "S1-B", "S2-C"], outcomeStart: 0, outcomeEnd: 2, status: "halted" },
        { n: 2, startedAt: 200_000, endedAt: 230_000, taskIds: ["S2-C"], outcomeStart: 2, outcomeEnd: 3, status: "complete" },
      ],
    }));
    const app = mountApp();
    try {
      await tick(150);
      await app.pick("Start a build");
      await app.pick("Projects (");
      await app.pick("sprints fixture");
      await app.pick("Sprints & burndown");
      const f = app.frame();
      expect(f).toMatch(/S1\s+3\s+2\s+0\s+\$0\.20\s+2m\s+halted/);
      expect(f).toMatch(/❯ S2\s+1\s+1\s+0\s+\$0\.10\s+30s/);
      expect(f).toContain("Velocity: 1.5 tasks per sprint");
      expect(f).toContain("Burndown — sprint 2"); // latest by default
      expect(f).toContain("S2-C");
      app.stdin.write("\u001b[D"); // ←
      await until(() => app.frame().includes("Burndown — sprint 1"), app.frame);
      expect(app.frame()).toContain("S1-B");
      expect(app.frame()).not.toContain("S2-C ");
    } finally {
      app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
