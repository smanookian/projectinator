// The "slow" flag: never before 60 s; 2x the bucket's typical duration when history
// exists; half the timeout otherwise; never when there's nothing to compare against.
// HOME is redirected so the user's calibration.json is untouched.

import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "pi-stuck-"));
const realHome = process.env.HOME;
process.env.HOME = home;

const { recordActual } = await import("../src/calibration.js");
const { isStuck, stuckThresholdMs } = await import("../src/stuck.js");
const { Kanban } = await import("../src/tui/Kanban.js");

afterAll(() => { process.env.HOME = realHome; rmSync(home, { recursive: true, force: true }); });
beforeEach(() => rmSync(join(home, ".projectinator"), { recursive: true, force: true }));

const MIN = 60_000;

describe("stuck rule", () => {
  it("with no history and no timeout it never flags", () => {
    expect(stuckThresholdMs("code", "low", undefined, 0)).toBeUndefined();
    expect(isStuck(10 * MIN, "code", "low", undefined, 0)).toBe(false);
  });
  it("with only a timeout: half the timeout, but never under 60 s", () => {
    expect(stuckThresholdMs("code", "low", undefined, 10 * MIN)).toBe(5 * MIN);
    expect(stuckThresholdMs("code", "low", undefined, 40_000)).toBe(MIN);
    expect(isStuck(4 * MIN, "code", "low", undefined, 10 * MIN)).toBe(false);
    expect(isStuck(6 * MIN, "code", "low", undefined, 10 * MIN)).toBe(true);
  });
  it("with history: 2x the typical duration wins when it is the larger bound", () => {
    recordActual("code", "low", 1000, 500, 0.5, "m", 4 * MIN);
    expect(stuckThresholdMs("code", "low", "m", 10 * MIN)).toBe(8 * MIN); // 2×4 min > 10/2
    expect(isStuck(7 * MIN, "code", "low", "m", 10 * MIN)).toBe(false);
    expect(isStuck(9 * MIN, "code", "low", "m", 10 * MIN)).toBe(true);
  });
  it("a fast history does not drop the threshold below the 60 s floor", () => {
    recordActual("review", "trivial", 1000, 100, 0.5, "m", 5_000);
    expect(stuckThresholdMs("review", "trivial", "m", 0)).toBe(MIN);
  });
});

describe("live board card", () => {
  it("shows the elapsed clock and a slow badge", () => {
    const { lastFrame } = render(
      <Kanban compact maxPerCol={3} tasks={[
        { id: "C-1", capability: "code", title: "build", status: "running", elapsedSec: 83, stuck: true },
        { id: "C-2", capability: "code", title: "build", status: "running", elapsedSec: 5 },
      ]} />,
    );
    const f = lastFrame() ?? "";
    expect(f).toContain("1:23 slow");
    expect(f).toContain("0:05");
    expect(f.match(/slow/g)).toHaveLength(1);
  });
});
