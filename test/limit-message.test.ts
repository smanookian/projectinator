// A per-task timeout below a minute reported "ran longer than 0 min" — and 0 means *unlimited*
// in the prefs, so the abort message contradicted the setting that caused it.

import { describe, it, expect } from "vitest";
import { formatLimit } from "../src/roles.js";

describe("task limit message", () => {
  it("never reports a real limit as 0", () => {
    expect(formatLimit(3_000)).toBe("3s");
    expect(formatLimit(30_000)).toBe("30s");
    expect(formatLimit(3_000)).not.toMatch(/\b0\b/);
  });
  it("uses minutes once there is a minute to report, keeping a fraction visible", () => {
    expect(formatLimit(60_000)).toBe("1 min");
    expect(formatLimit(600_000)).toBe("10 min");
    expect(formatLimit(90_000)).toBe("1.5 min");
  });
});
