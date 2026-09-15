// Regression: the transcript viewer must fit the 24-row frame. When the page size
// ignored the frame chrome, Yoga squeezed a row and the first two lines of text
// rendered on top of each other ("Used a gradient background.tered card."). Drive the
// real <App/> to the viewer with an on-disk fixture project and assert both lines
// survive and the pager reports a page that fits.

import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import App from "../src/tui/App.js";
import { projectRoot } from "../src/tui/engine.js";

const DOWN = "\u001b[B";
const ENTER = "\r";
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

describe("transcript viewer", () => {
  it("renders every line intact inside the frame and pages", async () => {
    const dir = join(projectRoot(), ".workspace", "tui", "test-transcript-fixture");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "build-state.json"), JSON.stringify({
      id: "test-transcript-fixture", idea: "transcript fixture", status: "complete", totalCost: 0.25,
      tasks: [{ id: "C-1", title: "Build index.html", capability: "code", difficulty: "low", dependsOn: [], estTokens: { input: 1, output: 1 } }],
      outcomes: [{
        taskId: "C-1", capability: "code", provider: "anthropic", modelId: "claude-opus-5", round: 0, cost: 0.25, files: ["index.html"],
        finalText: ["FIRST-LINE-MARKER centered card.", "SECOND-LINE-MARKER gradient.", ...Array.from({ length: 40 }, (_, i) => `detail ${i + 1}`)].join("\n"),
      }],
    }));
    const prevKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY ||= "test"; // any key → the "Ready" setup screen
    const { lastFrame, stdin, unmount } = render(<App />);
    const frame = () => lastFrame() ?? "";
    // Walk a menu until `label` is the highlighted row, then press Enter.
    const pick = async (label: string) => {
      for (let i = 0; i < 20; i++) {
        const line = frame().split("\n").find((l) => l.includes(label));
        if (line && line.includes("❯")) { stdin.write(ENTER); await tick(); return; }
        stdin.write(DOWN); await tick(20);
      }
      throw new Error(`menu item not reachable: ${label}\n${frame()}`);
    };
    try {
      await tick(150);
      await pick("Start a build");
      await pick("Projects (");
      await pick("transcript fixture");
      await pick("Transcripts (what each role said)");
      await pick("C-1");
      const f = frame();
      expect(f).toContain("FIRST-LINE-MARKER centered card.");
      expect(f).toContain("SECOND-LINE-MARKER gradient.");
      expect(f).not.toContain("gradient.tered"); // the overlap symptom
      expect(f.split("\n").length).toBeLessThanOrEqual(24);
      const m = f.match(/lines 1–(\d+) of 44/); // 42 text lines + blank + "Files after this run"
      expect(m).not.toBeNull();
      stdin.write("\u001b[6~"); // PgDn
      await tick();
      expect(frame()).toContain(`lines ${Number(m![1]) + 1}–`);
    } finally {
      unmount();
      rmSync(dir, { recursive: true, force: true });
      if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY;
    }
  });
});
