// The build flow (plan → building → done) had no App-level coverage, because reaching it for
// real costs money: the PM plans, then every task runs. Here the three engine calls that spend
// (assessBuild, planBuild, startBuild) are mocked, so the SCREENS and their keys are testable
// — including the mid-build steering keys, which shipped with orchestrator tests but none for
// the cockpit that drives them.

import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import type { Task } from "../src/types.js";
import type { OrchestratorEvent } from "../src/orchestrator.js";
import { REGISTRY } from "../src/registry.js";
import { createBuildControl } from "../src/orchestrator.js";

const TASKS: Task[] = [
  { id: "T-01", title: "Build the page", capability: "code", difficulty: "low", dependsOn: [], epic: "Core", estTokens: { input: 5_000, output: 2_000 } },
  { id: "T-02", title: "Review the wiring", capability: "review", difficulty: "low", dependsOn: ["T-01"], epic: "Core", estTokens: { input: 5_000, output: 2_000 } },
];

/** The backlog the mocked PM returns; a test can swap it to stress a screen. */
const planState: { tasks: Task[] } = { tasks: TASKS };

/** Captured so a test can drive the build the way the orchestrator would. */
const live: { emit?: (e: OrchestratorEvent) => void; finish?: (r: unknown) => void; control?: ReturnType<typeof createBuildControl> } = {};

vi.mock("../src/tui/engine.js", async (orig) => {
  const actual = await orig<typeof import("../src/tui/engine.js")>();
  return {
    ...actual,
    assessBuild: async () => [], // a clear request: skip the interview
    planBuild: async () => ({ tasks: planState.tasks, provider: "openrouter" as const, modelId: "anthropic/claude-sonnet-5", estCost: 0.42, registry: REGISTRY }),
    startBuild: (_idea: string, _plan: unknown, opts: { onEvent: (e: OrchestratorEvent) => void }) => {
      const control = createBuildControl();
      live.emit = opts.onEvent;
      live.control = control;
      const { promise, resolve } = Promise.withResolvers<unknown>();
      live.finish = resolve;
      return { workspace: "/tmp/build-flow-test", control, promise };
    },
  };
});

const DOWN = "\u001b[B";
const ENTER = "\r";
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, frame: () => string, timeoutMs = 3000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for the UI\n${frame()}`);
    await tick(10);
  }
}

/** Walk the real App from the setup screen to the plan screen. */
async function toPlanScreen() {
  process.env.OPENROUTER_API_KEY ||= "test";
  const { default: App } = await import("../src/tui/App.js");
  const r = render(<App />);
  const frame = () => r.lastFrame() ?? "";
  const highlighted = () => frame().split("\n").find((l) => l.includes("❯")) ?? "";
  const pick = async (label: string) => {
    await until(() => highlighted() !== "", frame);
    for (let i = 0; i < 40 && !highlighted().includes(label); i++) {
      const before = highlighted();
      r.stdin.write(DOWN);
      await until(() => highlighted() !== before, frame, 200).catch(() => {});
    }
    const before = frame();
    for (let i = 0; i < 10 && frame() === before; i++) {
      r.stdin.write(ENTER);
      await until(() => frame() !== before, frame, 200).catch(() => {});
    }
  };
  await tick(150);
  await pick("Start a build");
  await pick("New build");
  await until(() => frame().includes("What do you want to build?"), frame);
  for (let i = 0; i < 10 && !frame().includes("a tiny page"); i++) {
    r.stdin.write("a tiny page");
    await tick(40);
  }
  // Ink subscribes an input a tick after render, so a single Enter is often dropped: resend
  // until the idea screen is actually behind us.
  for (let i = 0; i < 12 && frame().includes("What do you want to build?"); i++) {
    r.stdin.write(ENTER);
    await tick(60);
  }
  await tick(80);
  if (frame().includes("Target platform")) { await pick("Web"); }
  if (frame().includes("Web framework")) { await pick("Vanilla"); }
  await until(() => frame().includes("How should the team plan this?") || frame().includes("Ready?"), frame, 5000);
  if (frame().includes("How should the team plan this?")) await pick("Quick plan");
  await until(() => frame().includes("Ready?"), frame, 5000);
  return { ...r, frame, pick };
}

/** A realistic backlog: several epics, enough cards to overflow a short terminal. */
const BIG: Task[] = [
  ["E-1", "Scaffold the page", "code", "Core"], ["E-2", "Style the header", "code", "Core"],
  ["E-3", "Review the markup", "review", "Core"], ["E-4", "Contact form", "code", "Forms"],
  ["E-5", "Validate the form", "code", "Forms"], ["E-6", "Review the form", "review", "Forms"],
  ["E-7", "Test the page", "test", "QA"], ["E-8", "Deploy notes", "ops", "QA"],
].map(([id, title, capability, epic]) => ({
  id: id!, title: title!, capability: capability as Task["capability"], difficulty: "low",
  dependsOn: [], epic, estTokens: { input: 5_000, output: 2_000 },
}));

describe("build flow screens", () => {
  it("the plan screen shows the backlog and the estimate the PM returned", async () => {
    const app = await toPlanScreen();
    try {
      const f = app.frame();
      expect(f).toContain("Plan ready");
      expect(f).toContain("2 tasks");
      expect(f).toContain("est $0.42"); // the mocked estimate
      // Labels must arrive INTACT. When this screen overflowed the viewport, Yoga merged rows
      // and these came out as "Budget cap: $25g now  ($0.42)(2 in backlog)" / "Quitch to…".
      expect(f, "the build action is garbled — rows overlapped").toContain("Build everything now");
      expect(f, "a menu row is garbled — rows overlapped").toContain("Switch to approval-gated");
    } finally { app.unmount(); }
  }, 30_000);

  it("building: the board renders, steering keys work, and the done screen follows", async () => {
    const app = await toPlanScreen();
    try {
      await app.pick("Build everything now");
      await until(() => app.frame().includes("Building"), app.frame);
      // the contextual footer advertises the steering keys
      expect(app.frame()).toContain("p pause");

      // a task starts → the board shows it running
      live.emit!({ type: "task_start", task: TASKS[0]!, round: 0, provider: "openrouter", modelId: "anthropic/claude-opus-5" });
      await until(() => app.frame().includes("T-01"), app.frame);

      // p pauses (the orchestrator would then emit `paused`)
      app.stdin.write("p");
      await tick(60);
      expect(live.control!.paused(), "p did not reach the build control").toBe(true);
      live.emit!({ type: "paused" });
      await until(() => app.frame().includes("Paused"), app.frame);

      // p again resumes
      app.stdin.write("p");
      await tick(60);
      expect(live.control!.paused()).toBe(false);
      live.emit!({ type: "resumed" });
      await until(() => app.frame().includes("Building"), app.frame);

      // x asks the build to stop after what is running
      app.stdin.write("x");
      await tick(60);
      expect(live.control!._stop, "x did not reach the build control").toBe(true);

      // the run settles → done screen with the result
      live.finish!({ totalCost: 0.31, halted: false, haltReason: undefined, files: ["index.html"] });
      await until(() => app.frame().includes("$0.31"), app.frame, 5000);
      const done = app.frame();
      expect(done).toContain("Build complete");
      expect(done).toContain("1 file");
      // Again, intact labels: the overflowing done screen merged these into "New builde / image".
      expect(done, "an action row is garbled — rows overlapped").toContain("Add a file / image");
      expect(done, "an action row is garbled — rows overlapped").toContain("New build");
    } finally { app.unmount(); }
  }, 30_000);
});

describe("board editor on a short terminal", () => {
  it("renders its columns, cards and legend without merging rows", async () => {
    planState.tasks = BIG;
    try {
      const app = await toPlanScreen();
      try {
        await app.pick("Plan the sprint on the board");
        await until(() => app.frame().includes("BACKLOG"), app.frame);
        const f = app.frame();
        // column headers, an epic lane and card titles must all arrive intact
        expect(f).toContain("BACKLOG");
        expect(f).toContain("READY");
        expect(f, "epic lane header garbled").toMatch(/[▾▸] 1/);
        // Columns sit side by side, so a title is never at end of line — but it must be
        // followed by whitespace. When rows merged, "Contact form" rendered as "Contact formw",
        // which a plain toContain() happily accepts.
        for (const t of BIG) {
          expect(f, `card title garbled (text ran into it): ${t.title}`).toMatch(new RegExp(`${t.title}(?!\\S)`));
        }
        // the legend is a wrapping row of bordered keycaps; it must not eat the board
        expect(f, "the legend is garbled — rows overlapped").toContain("collapse");
        expect(f.split("\n").length, "frame grew past the viewport").toBeLessThanOrEqual(24);
      } finally { app.unmount(); }
    } finally { planState.tasks = TASKS; }
  }, 30_000);
});
