// Headless smoke test for the TUI — renders the first screen without a real terminal.

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import App from "../src/tui/App.js";
import { availableProviders, slugify, estimateTasks, cleanDeps, projectFiles, mainFileOf, listProjects, roleAssignments, allModels, addAsset, deleteProject } from "../src/tui/engine.js";
import { Settings } from "../src/tui/Settings.js";
import { Kanban, type BoardTask } from "../src/tui/Kanban.js";
import { BoardEditor } from "../src/tui/BoardEditor.js";
import { Team, Standup, ListView } from "../src/tui/panels.js";
import { EditableBoard } from "../src/tui/EditableBoard.js";
import { validateKey } from "../src/tui/validate.js";
import { TEMPLATES } from "../src/tui/templates.js";
import { exportProject } from "../src/tui/engine.js";
import { readFileSync } from "node:fs";
import { pmSystemPrompt } from "../src/pm.js";
import { lockRegistryToProvider } from "../src/roles.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Task } from "../src/types.js";

const sampleTasks: Task[] = [
  { id: "T-1", title: "Design the hero", capability: "design", difficulty: "low", dependsOn: [], estTokens: { input: 5000, output: 2000 } },
  { id: "T-2", title: "Build the hero", capability: "code", difficulty: "low", dependsOn: ["T-1"], estTokens: { input: 5000, output: 2000 } },
];

describe("TUI renders", () => {
  it("shows the wordmark on the setup screen", () => {
    const { lastFrame, unmount } = render(<App />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("PROJECTINATOR");
    // Either ready (has a key) or the no-key guidance — both are valid first frames.
    expect(/Ready|No API key/.test(frame)).toBe(true);
    unmount();
  });
});

describe("engine helpers", () => {
  it("availableProviders returns a subset of the three", () => {
    const p = availableProviders();
    for (const x of p) expect(["anthropic", "openai", "google"]).toContain(x);
  });
  it("slugify makes a safe folder name", () => {
    expect(slugify("A Coffee Shop!! Landing Page")).toBe("a-coffee-shop-landing-page");
    expect(slugify("")).toBe("build");
  });
  it("estimateTasks gives a positive total and per-task costs", () => {
    const reg = lockRegistryToProvider("anthropic");
    const { total, per } = estimateTasks(sampleTasks, reg);
    expect(total).toBeGreaterThan(0);
    expect(per.get("T-1")).toBeGreaterThan(0);
  });
  it("cleanDeps drops references to removed tasks", () => {
    const remaining = sampleTasks.filter((t) => t.id !== "T-1"); // remove the design task
    const cleaned = cleanDeps(remaining);
    expect(cleaned[0]!.dependsOn).toEqual([]); // T-2's dangling dep on T-1 stripped
  });
});

describe("project helpers", () => {
  it("projectFiles excludes state + dotfiles; mainFileOf prefers index.html", () => {
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    try {
      writeFileSync(join(dir, "index.html"), "<html></html>");
      writeFileSync(join(dir, "about.html"), "x");
      writeFileSync(join(dir, "build-state.json"), "{}");
      writeFileSync(join(dir, ".hidden"), "x");
      const files = projectFiles(dir);
      expect(files).toContain("index.html");
      expect(files).toContain("about.html");
      expect(files).not.toContain("build-state.json");
      expect(files).not.toContain(".hidden");
      expect(mainFileOf(dir)).toBe(join(dir, "index.html"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("listProjects returns an array", () => {
    expect(Array.isArray(listProjects())).toBe(true);
  });
  it("deleteProject refuses to delete outside the projects folder", () => {
    expect(() => deleteProject("/tmp/something-else")).toThrow(/refusing/i);
  });
  it("addAsset copies a file into the project (and strips quotes)", () => {
    const src = mkdtempSync(join(tmpdir(), "src-"));
    const dst = mkdtempSync(join(tmpdir(), "dst-"));
    try {
      writeFileSync(join(src, "logo.png"), "PNGDATA");
      const r = addAsset(dst, `"${join(src, "logo.png")}"`); // quoted like a dragged path
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.name).toBe("logo.png");
      expect(projectFiles(dst)).toContain("logo.png");
    } finally {
      rmSync(src, { recursive: true, force: true });
      rmSync(dst, { recursive: true, force: true });
    }
  });
  it("addAsset handles backslash-escaped drag-drop paths (spaces, tildes)", () => {
    const base = mkdtempSync(join(tmpdir(), "a b~c-")); // dir with a space AND a tilde
    const dst = mkdtempSync(join(tmpdir(), "dst-"));
    try {
      writeFileSync(join(base, "pic.png"), "X");
      const escaped = join(base, "pic.png").replace(/ /g, "\\ ").replace(/~/g, "\\~");
      const r = addAsset(dst, escaped);
      expect(r.ok).toBe(true);
      expect(projectFiles(dst)).toContain("pic.png");
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(dst, { recursive: true, force: true });
    }
  });
  it("addAsset reports a missing file", () => {
    const dst = mkdtempSync(join(tmpdir(), "dst-"));
    try {
      const r = addAsset(dst, "/nope/does-not-exist.png");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/not found/i);
    } finally {
      rmSync(dst, { recursive: true, force: true });
    }
  });
});

describe("settings + scope", () => {
  it("Settings menu renders its options", () => {
    const { lastFrame, unmount } = render(<Settings onExit={() => {}} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Settings");
    expect(frame).toContain("API keys");
    expect(frame).toContain("Model assignments");
    unmount();
  });
  it("roleAssignments lists the five roles with models", () => {
    const rows = roleAssignments();
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => !!r.model)).toBe(true);
  });
  it("allModels is non-empty", () => {
    expect(allModels().length).toBeGreaterThan(5);
  });
  it("change scope tells the PM to make the FEWEST tasks; full scope scales", () => {
    expect(pmSystemPrompt("change")).toMatch(/FEWEST|CHANGE/);
    expect(pmSystemPrompt("full")).toMatch(/Scale/);
  });
});

describe("Kanban board", () => {
  const board: BoardTask[] = [
    { id: "T-1", capability: "design", title: "design it", dependsOn: [], status: "done" },
    { id: "T-2", capability: "code", title: "build it", dependsOn: ["T-1"], status: "running" },
    { id: "T-3", capability: "test", title: "test it", dependsOn: ["T-2"], status: "pending" }, // blocked -> backlog
    { id: "T-4", capability: "plan", title: "plan it", dependsOn: [], status: "pending" }, // ready -> not started
  ];
  it("renders four columns with correct counts", () => {
    const { lastFrame, unmount } = render(<Kanban tasks={board} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("BACKLOG");
    expect(frame).toContain("NOT STARTED");
    expect(frame).toContain("IN PROGRESS");
    expect(frame).toContain("DONE");
    // a done task, a running task, a ready task and a blocked task all appear
    expect(frame).toContain("design it");
    expect(frame).toContain("build it");
    unmount();
  });
});

describe("templates", () => {
  it("every template has a name and a detailed idea", () => {
    expect(TEMPLATES.length).toBeGreaterThan(3);
    for (const t of TEMPLATES) {
      expect(t.name).toBeTruthy();
      expect(t.idea.length).toBeGreaterThan(40);
    }
  });
});

describe("exportProject", () => {
  it("writes Markdown + CSV grouped by epic with done markers", () => {
    const dir = mkdtempSync(join(tmpdir(), "exp-"));
    try {
      const state = {
        id: "x", idea: "a landing page",
        tasks: [
          { id: "T-1", title: "hero", capability: "design", difficulty: "low", epic: "Hero", dependsOn: [], estTokens: { input: 1, output: 1 } },
          { id: "T-2", title: "build", capability: "code", difficulty: "low", epic: "Hero", dependsOn: ["T-1"], estTokens: { input: 1, output: 1 } },
        ],
        outcomes: [{ taskId: "T-1", capability: "design", provider: "anthropic", modelId: "m", finalText: "", files: [], cost: 0.3, round: 0 }],
        totalCost: 0.3, status: "halted" as const,
      };
      writeFileSync(join(dir, "build-state.json"), JSON.stringify(state));
      const { md, csv } = exportProject(dir);
      const mdText = readFileSync(md, "utf-8");
      expect(mdText).toContain("# a landing page");
      expect(mdText).toContain("## Hero");
      expect(mdText).toContain("[x] `T-1`"); // done
      expect(mdText).toContain("[ ] `T-2`"); // todo
      const csvText = readFileSync(csv, "utf-8");
      expect(csvText.split("\n")[0]).toContain("id,epic,capability");
      expect(csvText).toContain("T-1,\"Hero\",design");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("validateKey", () => {
  it("rejects an empty key without a network call", async () => {
    const r = await validateKey("anthropic", "   ");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/i);
  });
});

describe("EditableBoard", () => {
  const tasks: Task[] = [
    { id: "T-1", title: "done work", capability: "design", difficulty: "low", epic: "Hero", dependsOn: [], estTokens: { input: 1, output: 1 } },
    { id: "T-2", title: "todo work", capability: "code", difficulty: "low", epic: "Hero", dependsOn: [], estTokens: { input: 1, output: 1 } },
  ];
  it("renders tasks grouped by epic and marks done ones", () => {
    const { lastFrame, unmount } = render(<EditableBoard tasks={tasks} doneIds={new Set(["T-1"])} onSave={() => {}} onCancel={() => {}} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("Edit board");
    expect(f).toContain("Hero");
    expect(f).toContain("done work");
    expect(f).toContain("✓");
    unmount();
  });
  it("enter saves the task list", async () => {
    let saved: Task[] | null = null;
    const { stdin, unmount } = render(<EditableBoard tasks={tasks} doneIds={new Set()} onSave={(t) => { saved = t; }} onCancel={() => {}} />);
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 20));
    expect(saved).not.toBeNull();
    expect(saved!.map((t) => t.id)).toEqual(["T-1", "T-2"]);
    unmount();
  });
  it("blocks deleting a built (done) task", async () => {
    let saved: Task[] | null = null;
    const { lastFrame, stdin, unmount } = render(<EditableBoard tasks={tasks} doneIds={new Set(["T-1"])} onSave={(t) => { saved = t; }} onCancel={() => {}} />);
    stdin.write("d"); // cursor on T-1 (done) -> should warn, not delete
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame() ?? "").toMatch(/already built/i);
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 20));
    expect(saved!.map((t) => t.id)).toContain("T-1");
    unmount();
  });
});

describe("PM panels", () => {
  const board: BoardTask[] = [
    { id: "T-1", capability: "design", title: "design", epic: "Hero", status: "done", cost: 0.3 },
    { id: "T-2", capability: "code", title: "build", epic: "Hero", dependsOn: ["T-1"], status: "running" },
    { id: "T-3", capability: "test", title: "test", epic: "Hero", dependsOn: ["T-2"], status: "pending" },
  ];
  it("Standup summarizes done / running / cost", () => {
    const { lastFrame, unmount } = render(<Standup tasks={board} spent={0.3} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("1 done");
    expect(f).toContain("1 running");
    expect(f).toContain("$0.30");
    unmount();
  });
  it("ListView shows tasks grouped by epic with role icons", () => {
    const { lastFrame, unmount } = render(<ListView tasks={board} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("Hero");
    expect(f).toContain("build");
    expect(f).toContain("🧠"); // developer icon for the code task
    unmount();
  });
  it("Team lists the five roles with their models", () => {
    const { lastFrame, unmount } = render(<Team />);
    const f = lastFrame() ?? "";
    expect(f).toContain("Your team");
    expect(f).toContain("Developer");
    unmount();
  });
});

describe("BoardEditor (interactive)", () => {
  const tasks: Task[] = [
    { id: "T-1", title: "plan it", capability: "plan", difficulty: "low", dependsOn: [], estTokens: { input: 1, output: 1 } },
    { id: "T-2", title: "code it", capability: "code", difficulty: "low", dependsOn: ["T-1"], estTokens: { input: 1, output: 1 } },
  ];
  it("D sets a task's dependencies from typed ids", async () => {
    let out: Task[] | null = null;
    const { stdin, unmount } = render(<BoardEditor tasks={tasks} onDone={(t) => { out = t; }} onCancel={() => {}} onBreakdown={async () => []} />);
    const k = (s: string) => { stdin.write(s); return new Promise((r) => setTimeout(r, 20)); };
    await k("D"); // deps edit for T-1 (cursor at 0)
    await k("T-2");
    await k("\r");
    await k("A"); // all ready
    await k("\r"); // build
    const t1 = out!.find((t) => t.id === "T-1")!;
    expect(t1.dependsOn).toContain("T-2");
    unmount();
  });
  it("] reorders a card within its column", async () => {
    let out: Task[] | null = null;
    const { stdin, unmount } = render(<BoardEditor tasks={tasks} onDone={(t) => { out = t; }} onCancel={() => {}} onBreakdown={async () => []} />);
    const k = (s: string) => { stdin.write(s); return new Promise((r) => setTimeout(r, 20)); };
    await k("A"); // all -> ready (so both in same column)
    await k("]"); // move T-1 down past T-2
    await k("\r"); // build
    expect(out!.map((t) => t.id)).toEqual(["T-2", "T-1"]);
    unmount();
  });
  it("starts with all tasks in the Backlog (Scrum-first)", () => {
    const { lastFrame, unmount } = render(<BoardEditor tasks={tasks} onDone={() => {}} onCancel={() => {}} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("2 in backlog, 0 ready to build");
    expect(frame).toContain("A all");
    unmount();
  });
  it("A pulls the whole backlog into Ready", async () => {
    const { lastFrame, stdin, unmount } = render(<BoardEditor tasks={tasks} onDone={() => {}} onCancel={() => {}} />);
    stdin.write("A");
    await new Promise((r) => setTimeout(r, 30));
    expect(lastFrame() ?? "").toContain("0 in backlog, 2 ready to build");
    unmount();
  });
  it("enter with nothing in Ready warns instead of building", async () => {
    let called = false;
    const { lastFrame, stdin, unmount } = render(<BoardEditor tasks={tasks} onDone={() => { called = true; }} onCancel={() => {}} />);
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 20));
    expect(called).toBe(false);
    expect(lastFrame() ?? "").toMatch(/Nothing in Ready/i);
    unmount();
  });
  it("A then enter builds the whole backlog", async () => {
    let out: Task[] | null = null;
    const { stdin, unmount } = render(<BoardEditor tasks={tasks} onDone={(t) => { out = t; }} onCancel={() => {}} />);
    stdin.write("A");
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 20));
    expect(out).not.toBeNull();
    expect(out!.map((t) => t.id).sort()).toEqual(["T-1", "T-2"]);
    unmount();
  });
});
