// Theme context wiring: ThemedApp primes the live palette from persisted config and its
// set() flips the palette + persists. HOME is redirected before the imports because
// theme-context reads config at module load.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "pi-theme-"));
process.env.HOME = home;

import React, { useEffect } from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { describe, it, expect, afterAll } from "vitest";
import { ThemedApp, useThemeCtx } from "../src/tui/theme-context.js";
import { activeTheme, C, DARK, LIGHT } from "../src/tui/theme.js";
import { getTheme, setTheme } from "../src/tui/config.js";

afterAll(() => {
  delete process.env.HOME;
  rmSync(home, { recursive: true, force: true });
});

function Probe(): React.ReactElement {
  const ctx = useThemeCtx();
  useEffect(() => {
    (globalThis as { __set?: (t: "dark" | "light") => void }).__set = ctx.setTheme;
  });
  return <Text>{ctx.id}</Text>;
}

describe("theme context", () => {
  it("primes from persisted config; set() flips the live palette and persists", async () => {
    setTheme("light");
    const { lastFrame, unmount } = render(<ThemedApp><Probe /></ThemedApp>);
    await new Promise((r) => setTimeout(r, 30));
    expect(lastFrame()).toContain("light");
    expect(activeTheme().id).toBe("light");
    expect(C.accent).toBe(LIGHT.accent);

    (globalThis as { __set?: (t: "dark" | "light") => void }).__set!("dark");
    await new Promise((r) => setTimeout(r, 30));
    expect(activeTheme().id).toBe("dark");
    expect(C.accent).toBe(DARK.accent);
    expect(getTheme()).toBe("dark");
    unmount();
  }, 15_000);
});