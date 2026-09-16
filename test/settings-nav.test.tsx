// Settings navigation must never trap you: Esc backs out of a sub-screen, Esc on the menu
// leaves Settings, and the Local-models screen has exactly one live input (its Back item used
// to ALSO submit the URL field, so it probed the server instead of going back).
// HOME is redirected before the imports so the real ~/.projectinator is untouched.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "pi-settings-"));
process.env.HOME = home;

import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, afterAll } from "vitest";
import { Settings } from "../src/tui/Settings.js";

afterAll(() => {
  delete process.env.HOME;
  rmSync(home, { recursive: true, force: true });
});

const DOWN = "\u001b[B";
const ENTER = "\r";
const ESC = "\u001b";

function app() {
  let exited = false;
  const r = render(<Settings onExit={() => { exited = true; }} />);
  const key = async (s: string) => { r.stdin.write(s); await new Promise((res) => setTimeout(res, 40)); };
  const frame = () => r.lastFrame() ?? "";
  /** Walk the grouped menu down to a label, then Enter. */
  const open = async (label: string) => {
    for (let i = 0; i < 20 && !(frame().split("\n").find((l) => l.includes("❯")) ?? "").includes(label); i++) await key(DOWN);
    await key(ENTER);
  };
  return { ...r, key, frame, open, exited: () => exited };
}

/** Every menu row that opens its own screen. Each must render and give Esc back. */
const SUBSCREENS = [
  "API keys", "Preferred provider", "Model assignments", "Estimate accuracy", "Local models",
  "Default workflow", "Default stack", "Budget, speed & alerts", "Webhook", "Theme",
];

describe("Settings sub-screen audit", () => {
  it.each(SUBSCREENS)("%s opens, renders, and Esc returns to the menu", async (label) => {
    const a = app();
    try {
      await a.key(""); // let the menu subscribe to input
      await a.open(label);
      const inside = a.frame();
      expect(inside, `${label} did not open a screen`).not.toContain("MODELS & PROVIDERS");
      expect(inside.trim().length, `${label} rendered (almost) nothing`).toBeGreaterThan(40);
      await a.key(ESC);
      expect(a.frame(), `Esc did not come back from ${label}`).toContain("MODELS & PROVIDERS");
      expect(a.exited(), `Esc escaped Settings entirely from ${label}`).toBe(false);
    } finally { a.unmount(); }
  }, 20_000);
});

describe("Settings navigation", () => {
  it("Esc backs out of Local models, then out of Settings", async () => {
    const a = app();
    try {
      await a.key(""); // let the menu subscribe to input
      await a.open("Local models");
      expect(a.frame()).toContain("Connect to"); // on the Local-models screen
      await a.key(ESC);
      expect(a.frame()).not.toContain("Connect to"); // back on the menu
      expect(a.frame()).toContain("MODELS & PROVIDERS");
      expect(a.exited()).toBe(false);
      await a.key(ESC);
      expect(a.exited()).toBe(true); // Esc on the menu leaves Settings
    } finally { a.unmount(); }
  }, 20_000);

  it("Local models: Back returns to the menu instead of probing the server", async () => {
    const a = app();
    try {
      await a.key("");
      await a.open("Local models");
      // the URL is display-only here, so Enter can't submit it — only the menu is live
      for (let i = 0; i < 6 && !(a.frame().split("\n").find((l) => l.includes("❯")) ?? "").includes("Back"); i++) await a.key(DOWN);
      await a.key(ENTER);
      expect(a.frame()).toContain("MODELS & PROVIDERS");
      expect(a.frame()).not.toMatch(/asking the server/); // never started a probe
    } finally { a.unmount(); }
  }, 20_000);
});
