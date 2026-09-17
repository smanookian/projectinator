// User data must live outside the installed package: `npm i -g projectinator@latest` replaces
// the package directory, so projects kept there were destroyed on every upgrade. Anything that
// was already written to the old location must be carried over, once, without loss.

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { dataHome, tuiRoot, projectRoot } from "../src/tui/engine.js";
import { configPath } from "../src/tui/config.js";

const realHome = process.env.PROJECTINATOR_HOME;
afterEach(() => { process.env.PROJECTINATOR_HOME = realHome; });

describe("user data location", () => {
  it("never sits inside the installed package", () => {
    delete process.env.PROJECTINATOR_HOME;
    expect(dataHome().startsWith(projectRoot())).toBe(false);
    expect(dataHome()).toMatch(/\.projectinator$/);
    process.env.PROJECTINATOR_HOME = realHome;
  });

  it("PROJECTINATOR_HOME wins, and projects hang off it", () => {
    const home = mkdtempSync(join(tmpdir(), "pi-home-"));
    process.env.PROJECTINATOR_HOME = home;
    try {
      expect(dataHome()).toBe(home);
      expect(tuiRoot()).toBe(join(home, "projects"));
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it("carries projects over from the old in-package location without clobbering newer ones", () => {
    const legacy = join(projectRoot(), ".workspace", "tui");
    const home = mkdtempSync(join(tmpdir(), "pi-home-"));
    process.env.PROJECTINATOR_HOME = home;
    mkdirSync(join(legacy, "test-migrate-me"), { recursive: true });
    writeFileSync(join(legacy, "test-migrate-me", "build-state.json"), '{"id":"test-migrate-me","tasks":[],"outcomes":[],"totalCost":0,"status":"complete"}');
    // a project that already exists at the destination must be left alone
    mkdirSync(join(home, "projects", "test-keep-mine"), { recursive: true });
    writeFileSync(join(home, "projects", "test-keep-mine", "marker"), "newer");
    mkdirSync(join(legacy, "test-keep-mine"), { recursive: true });
    writeFileSync(join(legacy, "test-keep-mine", "marker"), "older");
    try {
      const root = tuiRoot();
      expect(existsSync(join(root, "test-migrate-me", "build-state.json")), "legacy project was not carried over").toBe(true);
      expect(readFileSync(join(root, "test-keep-mine", "marker"), "utf8")).toBe("newer");
      // migration is a copy, so it must not re-run over later edits on every startup
      writeFileSync(join(root, "test-migrate-me", "build-state.json"), "edited-after-migration");
      expect(readFileSync(join(tuiRoot(), "test-migrate-me", "build-state.json"), "utf8"),
        "migration clobbered work on a later startup").toBe("edited-after-migration");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(join(legacy, "test-migrate-me"), { recursive: true, force: true });
      rmSync(join(legacy, "test-keep-mine"), { recursive: true, force: true });
    }
  });
});

describe("config location", () => {
  it("follows PROJECTINATOR_HOME, so a test run can't touch the real config", () => {
    const home = mkdtempSync(join(tmpdir(), "pi-home-"));
    process.env.PROJECTINATOR_HOME = home;
    try {
      expect(configPath()).toBe(join(home, "config.json"));
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it("carries a $HOME-pinned config across, keys and all, when PROJECTINATOR_HOME is set", () => {
    // Config used to ignore PROJECTINATOR_HOME; setting it must not orphan someone's API keys.
    const fakeHome = mkdtempSync(join(tmpdir(), "pi-fake-home-"));
    const home = mkdtempSync(join(tmpdir(), "pi-home-"));
    const realHomeEnv = process.env.HOME;
    process.env.HOME = fakeHome;
    process.env.PROJECTINATOR_HOME = home;
    mkdirSync(join(fakeHome, ".projectinator"), { recursive: true });
    writeFileSync(join(fakeHome, ".projectinator", "config.json"), '{"keys":{"openrouter":"sk-legacy"}}');
    try {
      const moved = JSON.parse(readFileSync(configPath(), "utf8"));
      expect(moved.keys.openrouter, "legacy keys were not carried over").toBe("sk-legacy");
    } finally {
      process.env.HOME = realHomeEnv;
      rmSync(fakeHome, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
